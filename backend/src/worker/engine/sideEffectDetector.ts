import type { FileAnalysis } from '../types/analysis.js';
import { query } from '../../lib/db.js';
import { withStatementTimeoutRetry } from '../../lib/pgRetry.js';

export interface DetectedSideEffect {
  /** File-level key (relative path) — used by workflow traversal. */
  nodeStableKey: string;
  kind:
    | 'database_write' | 'database_read' | 'http_call' | 'file_write' | 'message_publish'
    | 'email_send' | 'cache_write'
    // Auth/identity SDK calls (supabase.auth, jwt, passport, bcrypt, …):
    // before these, an auth handler's only effects were invisible and the
    // whole User Auth journey traced to nothing (DETECTION_COVERAGE.md §2).
    | 'auth_call'
    // Named managed-service/LLM-provider SDK calls (openai, octokit, s3, …).
    | 'external_service'
    // child_process spawn/exec — flow- and security-relevant.
    | 'process_exec'
    // Honesty-rule fallback: a call into an external package no pattern
    // recognizes. Low confidence, one per (file, package) — an unknown is
    // findable work, never a silent hole.
    | 'unknown_external';
  target?: string;
  filePath: string;
  symbolName?: string;
  /** Symbol-level key (`path#Symbol`) of the symbol performing the effect. */
  symbolStableKey?: string;
  /** The matched call expression that triggered the detection */
  evidence?: string;
  /**
   * Normalized queue token for message_publish effects
   * (`getSummaryQueue().add(...)` -> 'summary'): journey composition matches
   * it against consumer entrypoints' queue constants ('SUMMARY_QUEUE').
   */
  queueHint?: string;
  /** Defaults to 'medium' at persist time; 'low' for unknown_external. */
  confidence?: 'high' | 'medium' | 'low';
}

const DB_WRITE_PATTERNS = [
  /\.query\s*\(\s*['"`]\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i,
  // Bare `query(` helper convention (`import { query } from db`) — the
  // dot-prefixed pattern missed every such call and their UPDATE/INSERTs
  // shipped as "Data Read" workflow steps (audit §5.4).
  /(?<![.\w])query\s*\(\s*['"`\s]*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)/i,
  // Raw SQL verbs in the symbol body (template literals built before the
  // call). Case-sensitive: `UPDATE x SET` is SQL, "update the … set" is prose.
  /\b(?:INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM|TRUNCATE\s+\w)/,
  /\.create\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(/,
  /\.save\s*\(/,
  /\.upsert\s*\(/,
  /\.destroy\s*\(/,
  // Document-store and client-SDK mutation verbs. Without these, an app whose
  // persistence is a driver or a BaaS client rather than an ORM measured as
  // writing NOTHING: `Jobs.insertOne(job)` and `supabase.from('x').insert(y)`
  // matched no pattern above, so the flows that ARE the product tiered
  // `supporting` and never bound a capability.
  /\.(?:insert|insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite|createMany|findOneAndUpdate|findOneAndDelete|findOneAndReplace|findByIdAndUpdate|findByIdAndDelete|findByIdAndRemove)\s*\(/,
  // Firestore modular SDK — free functions, so there is no receiver to key on.
  /(?<![.\w])(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/,
  // Browser-local persistence IS persistence: a client-only app that keeps its
  // state here changes something the user finds again on the next visit.
  /\b(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|removeItem|clear)\s*\(/,
];

/**
 * Reads against a named data resource. Deliberately narrow: a bare `.find(` is
 * `Array.prototype.find` far more often than it is a query, so only verbs that
 * belong to a data client are listed. A read is not a state change — it never
 * makes a flow `core` — but it IS evidence that the flow reaches a real
 * resource, which is the difference between a bound capability and silence for
 * every read-only view in the fleet.
 */
const DB_READ_PATTERNS = [
  /\bSELECT\s+[\w*.,"'`\s]+\s+FROM\b/,
  /\.(?:findOne|findMany|findUnique|findFirst|findById|countDocuments|estimatedDocumentCount|aggregate)\s*\(/,
  /(?<![.\w])(?:getDoc|getDocs|onSnapshot)\s*\(/,
  // `.select(` qualified by a resource call in the same expression — supabase,
  // knex and drizzle all read this way; an unqualified `.select(` is a DOM API.
  /\.(?:from|collection|table)\s*\(\s*['"`][\w.$-]+['"`]\s*\)[^;]{0,160}?\.select\s*\(/,
  /\b(?:localStorage|sessionStorage)\s*\.\s*getItem\s*\(/,
];

const HTTP_CALL_PATTERNS = [
  /fetch\s*\(/,
  /axios\./,
  /\.request\s*\(/,
  /http\./,
];

const FILE_WRITE_PATTERNS = [
  /fs\.(write|append|mkdir|rm|unlink)/,
  /writeFile/,
  /createWriteStream/,
];

const MESSAGE_PATTERNS = [
  /\.publish\s*\(/,
  // Bare `.send(` matched `res.send(...)` too, turning plain HTTP responses
  // into bogus async_work steps — require a messaging-shaped receiver.
  /(?:producer|publisher|sqs|sns|kafka|nats|amqp|channel|topic)\w*\.send\s*\(/i,
  /\.emit\s*\(/,
  // BullMQ enqueue: require a queue-shaped receiver (`frameworks.add('docker')`
  // is a Set) and allow a bare `.add` tail — callsSymbols entries carry the
  // callee expression without arguments (`getSummaryQueue().add`), which is
  // all that survives when a giant function's snippet is truncated at the cap.
  /(?:^|[^.\w])(?:get)?\w*[Qq]ueue\w*\s*(?:\(\s*\))?\s*\.add\b/,
  // Redis list/stream producers — the hand-off in every "API enqueues, worker
  // consumes" app that does not use a queue library.
  /\.(?:lPush|rPush|lpush|rpush|xAdd|xadd)\s*\(/,
];

const EMAIL_PATTERNS = [
  /sendMail/,
  /sendEmail/,
  /transporter\.send/,
];

const _CACHE_PATTERNS = [
  /\.set\s*\(/,
  /cache\./,
  /redis\./,
];

// Auth/identity SDK sinks (taint-sink modeling, DETECTION_COVERAGE.md §2).
// Target names the identity provider so workflow steps read
// "auth call → supabase.auth" instead of a bare category.
const AUTH_PATTERNS: Array<{ pattern: RegExp; target: string }> = [
  { pattern: /supabase\w*\.auth\.(?:admin\.)?\w+\s*\(/i, target: 'supabase.auth' },
  { pattern: /\.auth\.(?:signUp|signInWith\w+|signOut|getUser|getSession|exchangeCodeForSession|verifyOtp|refreshSession|setSession|resetPasswordForEmail|updateUser)\s*\(/, target: 'auth sdk' },
  { pattern: /\bjwt\.(?:sign|verify|decode)\s*\(|jsonwebtoken/, target: 'jwt' },
  { pattern: /passport\.(?:authenticate|use)\s*\(/, target: 'passport' },
  { pattern: /bcrypt\w*\.(?:hash|compare)\w*\s*\(/, target: 'bcrypt' },
  { pattern: /signInWithEmailAndPassword|createUserWithEmailAndPassword|signInWithPopup/, target: 'firebase.auth' },
  { pattern: /clerkClient\.|useClerk\s*\(/, target: 'clerk' },
];

// Named managed-service and LLM-provider SDK calls -> external_integration
// with a service target. Word-boundaried and member-shaped on purpose:
// breadth here must not tag every `.send(` in the repo.
const EXTERNAL_SERVICE_PATTERNS: Array<{ pattern: RegExp; target: string }> = [
  { pattern: /new\s+OpenAI\s*\(|openai\.(?:chat|embeddings|responses|images)\b/, target: 'openai' },
  { pattern: /openrouter/i, target: 'openrouter' },
  { pattern: /new\s+Anthropic\s*\(|anthropic\.(?:messages|beta)\b/, target: 'anthropic' },
  { pattern: /octokit\.(?:rest|request|graphql|paginate)\b|createAppAuth\s*\(/, target: 'github api' },
  { pattern: /\.storage\.from\s*\(/, target: 'object storage' },
  { pattern: /S3Client\b|new\s+AWS\.S3\b/, target: 's3' },
  { pattern: /stripe\.(?:charges|paymentIntents|customers|subscriptions|checkout)\b/, target: 'stripe' },
  { pattern: /resend\.emails\b|sgMail\.\w+\s*\(/, target: 'email service' },
  { pattern: /twilio\w*\.messages\b/, target: 'twilio' },
];

// `.exec(` is deliberately absent: `regex.exec(str)` is everywhere.
const PROCESS_EXEC_PATTERNS = [
  /child_process/,
  /(?<![.\w])(?:spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(/,
];

/**
 * Queue token from an enqueue call site: `getSummaryQueue().add(` /
 * `summaryQueue.add(` / `queue.add(` -> 'summary' / 'summary' / ''.
 * Consumers normalize the same way ('SUMMARY_QUEUE' -> 'summary'), which is
 * what lets journey composition stitch producer -> consumer without an
 * import-resolution pass.
 */
export function normalizeQueueToken(raw: string): string {
  return raw
    .replace(/^get/i, '')
    .replace(/queue/gi, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    // Producer variables are often singular where queue names are plural
    // (`reportQueue.add` vs queue 'reports') — both sides strip the same way,
    // so equality survives.
    .replace(/s$/, '');
}

// Job name (group 2) is optional: a truncated snippet leaves only the
// callee expression, and "we know the queue but not the job" beats silence.
const ENQUEUE_CALL_RE = /((?:get)?\w*[Qq]ueue\w*)\s*(?:\(\s*\))?\s*\.add\b(?:\s*\(\s*['"`]([\w:.-]+)['"`])?/;

/**
 * Packages whose calls are not observable side effects (rendering, styling,
 * pure data shaping). Declared here so the unknown-external fallback stays
 * honest about *services* without flooding on every React component.
 */
const PURE_PACKAGES = new Set([
  'react', 'react-dom', 'react-router-dom', 'react-router',
  'lodash', 'date-fns', 'dayjs', 'clsx', 'classnames', 'uuid', 'zod',
  'framer-motion', 'tailwind-merge', 'chai', 'mocha', 'vitest',
]);

/**
 * Names a data client binds to a resource: `db.collection("jobs")`,
 * `supabase.from('cards')`, `knex.table('users')`, `mongoose.model('Note')`.
 * Collected per file so a call site that only says `Jobs.insertOne(...)` can
 * still report WHICH resource it wrote — the difference between an effect
 * that binds a capability and one that is an anonymous "database write".
 */
function collectResourceBindings(fa: FileAnalysis): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const sym of fa.symbols) {
    const src = `${sym.initializer ?? ''} ${sym.snippet ?? ''}`;
    const m = src.match(/\b(?:collection|from|table|model)\s*\(\s*['"`]([\w.$-]+)['"`]/);
    if (m && sym.name && !bindings.has(sym.name)) bindings.set(sym.name, m[1]!);
  }
  return bindings;
}

/** Receiver-shaped mutation/read verbs, for resolving `X.insertOne(...)` -> X. */
const RESOURCE_CALL_RE =
  /([A-Za-z_$][\w$]*)\s*\.\s*(?:insert|insertOne|insertMany|update|updateOne|updateMany|upsert|replaceOne|delete|deleteOne|deleteMany|createMany|create|save|destroy|bulkWrite|findOne|findMany|findUnique|findFirst|findById|find|countDocuments|aggregate|findOneAnd\w+|findByIdAnd\w+)\s*\(/;

/**
 * The named data resource a call touches, resolved in precedence order:
 * inline (`from('x').insert`), through a file binding (`Jobs.insertOne` where
 * `Jobs = db.collection('jobs')`), through the ORM accessor shape
 * (`prisma.user.create`), then browser storage. Null when nothing names it —
 * an anonymous write is still a write, it just cannot identify a capability.
 */
export function resolveDataResource(callsStr: string, bindings: Map<string, string>): string | null {
  const inline = callsStr.match(/\.(?:from|collection|table|model)\s*\(\s*['"`]([\w.$-]+)['"`]/);
  if (inline) return inline[1]!;
  const receiver = callsStr.match(RESOURCE_CALL_RE);
  if (receiver) {
    const bound = bindings.get(receiver[1]!);
    if (bound) return bound;
  }
  const orm = callsStr.match(
    /\b(?:prisma|db|database|client|knex|supabase)\s*\.\s*([a-z][\w]*)\s*\.\s*(?:create|update|delete|upsert|findMany|findUnique|findFirst|createMany|updateMany|deleteMany)\s*\(/,
  );
  if (orm) return orm[1]!;
  if (/\blocalStorage\s*\./.test(callsStr)) return 'local storage';
  if (/\bsessionStorage\s*\./.test(callsStr)) return 'session storage';
  return null;
}

const PLAIN_FAMILIES: Array<{ kind: DetectedSideEffect['kind']; patterns: RegExp[] }> = [
  { kind: 'database_write', patterns: DB_WRITE_PATTERNS },
  { kind: 'database_read', patterns: DB_READ_PATTERNS },
  { kind: 'http_call', patterns: HTTP_CALL_PATTERNS },
  { kind: 'file_write', patterns: FILE_WRITE_PATTERNS },
  { kind: 'message_publish', patterns: MESSAGE_PATTERNS },
  { kind: 'email_send', patterns: EMAIL_PATTERNS },
  { kind: 'process_exec', patterns: PROCESS_EXEC_PATTERNS },
];

const TARGETED_FAMILIES: Array<{ kind: DetectedSideEffect['kind']; patterns: Array<{ pattern: RegExp; target: string }> }> = [
  { kind: 'auth_call', patterns: AUTH_PATTERNS },
  { kind: 'external_service', patterns: EXTERNAL_SERVICE_PATTERNS },
];

/**
 * Mutation of a store that lives in module scope.
 *
 * A client-side app whose data layer is an in-process array is still an app
 * with a data layer: `addItem` pushing onto a module-level list is the same
 * user-visible state change as an INSERT, and the reader needs to find it in
 * exactly the same way. Scoping to bindings DECLARED IN THIS FILE is what
 * keeps this from flagging every `results.push(x)` in a pure helper — a local
 * accumulator is not a store, and only a module-scope binding outlives the
 * call that touched it.
 */
function moduleStateWrite(callsStr: string, moduleBindings: Set<string>): { evidence: string; target: string } | null {
  if (moduleBindings.size === 0) return null;
  const re = /\b([A-Za-z_$][\w$]*)\s*(?:\.\s*(?:push|unshift|splice|pop|shift|fill|copyWithin)\s*\(|\[[^\]]{0,40}\]\s*=(?!=)|\s*=(?!=))/g;
  for (const m of callsStr.matchAll(re)) {
    if (moduleBindings.has(m[1]!)) return { evidence: m[0], target: m[1]! };
  }
  return null;
}

/**
 * Mutation of an instance field from inside a class method: `this.board = …`,
 * `this.clients.add(c)`, `this.rows[i] = …`.
 *
 * A class whose methods advance a long-lived object IS doing work — a game
 * loop, a session registry, a connection manager. None of it is a data client
 * and none of it is a module binding, so before this rule such a repo measured
 * as literally nothing happening, and its one workflow traced to an empty body.
 *
 * `this.` is what makes a wide verb list safe here. A bare `.add(`/`.set(`/
 * `.delete(` matches every Set, Map and DOM call in the repo; qualified by the
 * receiver `this.<field>` it can only be the object's own state. Reported
 * WITHOUT a target for the same reason the module-scope rule is — see the
 * comment at its call site: the field name is a variable, not a resource
 * anybody else can name, and letting it identify a capability groups unrelated
 * flows under whatever field a class happens to keep. Low confidence: enough to
 * make a game loop non-empty, never enough to invent a table.
 */
const INSTANCE_FIELD_WRITE_RE =
  /\bthis\s*\.\s*([A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?:\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|add|set|delete|clear)\s*\(|\[[^\]]{0,40}\]\s*=(?!=)|\+\+|--|(?:\*\*|[+\-*/%]|\|\||&&|\?\?)?=(?!=))/;

/** True when any modeled effect family already explains this body. */
function matchesAnyFamily(callsStr: string): boolean {
  for (const family of PLAIN_FAMILIES) {
    for (const pattern of family.patterns) if (pattern.test(callsStr)) return true;
  }
  for (const family of TARGETED_FAMILIES) {
    for (const { pattern } of family.patterns) if (pattern.test(callsStr)) return true;
  }
  return false;
}

/** Module-scope value bindings — candidate in-memory stores for the rule above. */
function collectModuleBindings(fa: FileAnalysis): Set<string> {
  const names = new Set<string>();
  for (const sym of fa.symbols) {
    if (sym.kind !== 'variable') continue;
    // Only bindings that hold data. A binding initialised from a call is a
    // client, a hook or a config object, not a store somebody mutates.
    if (!/^\s*[[{]|^\s*(?:new\s+(?:Map|Set)\b)/.test(sym.initializer ?? '')) continue;
    names.add(sym.name);
  }
  return names;
}

export function detectSideEffects(fileAnalyses: FileAnalysis[]): DetectedSideEffect[] {
  const effects: DetectedSideEffect[] = [];

  for (const fa of fileAnalyses) {
    const relativePath = fa.relativePath;
    // binding name -> external package, for the unknown-external fallback.
    const externalBindings = collectExternalBindings(fa);
    const resourceBindings = collectResourceBindings(fa);
    const moduleBindings = collectModuleBindings(fa);
    const unknownPackagesSeen = new Set<string>();

    for (const sym of fa.symbols) {
      // callsSymbols holds callee names only; the snippet carries argument
      // text (SQL strings, queue names), which several patterns match on.
      const callsStr = [...(sym.callsSymbols ?? []), sym.snippet ?? ''].join(' ');
      if (!callsStr.trim()) continue;

      const base = {
        nodeStableKey: relativePath,
        filePath: relativePath,
        symbolName: sym.name,
        symbolStableKey: `${relativePath}#${sym.name}`,
      };
      let matchedAny = false;

      for (const family of PLAIN_FAMILIES) {
        for (const pattern of family.patterns) {
          const match = callsStr.match(pattern);
          if (!match) continue;
          const effect: DetectedSideEffect = { ...base, kind: family.kind, evidence: match[0] };
          if (family.kind === 'message_publish') {
            // `getSummaryQueue().add('generate_summary', ...)` — the job name
            // is the target; the queue variable normalizes into the hint the
            // journey composer stitches on. callsSymbols entries carry the
            // callee WITHOUT arguments and sort before the snippet in
            // callsStr, so prefer the first match that captured a job name.
            let enqueue: RegExpMatchArray | null = null;
            for (const m of callsStr.matchAll(new RegExp(ENQUEUE_CALL_RE.source, 'g'))) {
              if (!enqueue) enqueue = m;
              if (m[2]) { enqueue = m; break; }
            }
            if (enqueue) {
              if (enqueue[2]) effect.target = enqueue[2];
              const hint = normalizeQueueToken(enqueue[1]!);
              if (hint) effect.queueHint = hint;
            }
          }
          if (family.kind === 'process_exec') effect.target = 'child_process';
          // Name the resource a data call touches. A capability needs a noun to
          // be about, and "database write" is not one.
          if (family.kind === 'database_write' || family.kind === 'database_read') {
            const resource = resolveDataResource(callsStr, resourceBindings);
            if (resource) effect.target = resource;
          }
          effects.push(effect);
          matchedAny = true;
          break;
        }
      }

      for (const family of TARGETED_FAMILIES) {
        for (const { pattern, target } of family.patterns) {
          const match = callsStr.match(pattern);
          if (!match) continue;
          effects.push({ ...base, kind: family.kind, target, evidence: match[0] });
          matchedAny = true;
          break;
        }
      }

      // In-memory store mutation, only when nothing stronger matched: a symbol
      // that already writes a database does not also need reporting for the
      // cache array it keeps beside it. Reported WITHOUT a target on purpose —
      // the binding name is a variable, not a resource anyone else can name, and
      // letting it identify a capability groups real flows under whatever array
      // a file happens to keep at the top (an event-listener list, a memo).
      if (!matchedAny) {
        const stateWrite = moduleStateWrite(callsStr, moduleBindings);
        if (stateWrite) {
          effects.push({
            ...base, kind: 'database_write',
            evidence: `Mutates module-scope state "${stateWrite.target}" (${stateWrite.evidence.trim()})`,
            confidence: 'low',
          });
          matchedAny = true;
        }
      }

      // Honesty rule (DETECTION_COVERAGE.md): a symbol that matched nothing
      // but calls into an unrecognized external package is an unknown, not a
      // no-op. One low-confidence effect per (file, package).
      if (!matchedAny && externalBindings.size > 0) {
        for (const callee of sym.callsSymbols ?? []) {
          const binding = callee.split('.')[0]!;
          const pkg = externalBindings.get(binding);
          if (!pkg || unknownPackagesSeen.has(pkg)) continue;
          unknownPackagesSeen.add(pkg);
          effects.push({
            ...base,
            kind: 'unknown_external',
            target: pkg,
            evidence: `Calls ${callee} from unmodeled package "${pkg}"`,
            confidence: 'low',
          });
          break;
        }
      }
    }

    // Instance-field mutation, at METHOD granularity: the graph already has a
    // `path#Class.method` node, and hanging this on the class would say the
    // class does something without saying which call does it. Constructors are
    // deliberately out of reach — they carry no body here, and initialising a
    // field is setup, not a state change. Skipped when a modeled family already
    // explains the method, so a method that writes a database is not relabeled
    // with the weaker fact about the field it cached the result in.
    for (const sym of fa.symbols) {
      if (sym.kind !== 'class') continue;
      for (const method of sym.methods ?? []) {
        const methodStr = [...(method.callsSymbols ?? []), method.snippet ?? ''].join(' ');
        if (!methodStr.trim() || matchesAnyFamily(methodStr)) continue;
        const write = methodStr.match(INSTANCE_FIELD_WRITE_RE);
        if (!write) continue;
        effects.push({
          nodeStableKey: relativePath,
          filePath: relativePath,
          symbolName: `${sym.name}.${method.name}`,
          symbolStableKey: `${relativePath}#${sym.name}.${method.name}`,
          kind: 'database_write',
          evidence: `Mutates instance state "${write[1]}" (${write[0].trim()})`,
          confidence: 'low',
        });
      }
    }
  }

  return effects;
}

/** Node builtins importable without the node: prefix. */
const NODE_BUILTINS = new Set([
  'path', 'fs', 'os', 'url', 'crypto', 'http', 'https', 'util', 'stream',
  'events', 'buffer', 'zlib', 'net', 'tls', 'dns', 'worker_threads',
  'perf_hooks', 'assert', 'querystring', 'readline', 'string_decoder',
  'timers', 'tty', 'v8', 'vm', 'child_process', 'module', 'process',
]);

/** Value bindings imported from bare-specifier (third-party) packages. */
function collectExternalBindings(fa: FileAnalysis): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const imp of fa.imports ?? []) {
    const spec = imp.toSpecifier;
    if (!spec || spec.startsWith('.') || spec.startsWith('/') || imp.isTypeOnly) continue;
    if (spec.startsWith('node:')) continue; // builtins are patterned explicitly
    // `@/components/x` is a tsconfig alias to repo code, not a package.
    if (spec.startsWith('@/') || spec.startsWith('~/') || spec.startsWith('#')) continue;
    const parts = spec.split('/');
    const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
    if (PURE_PACKAGES.has(pkg) || NODE_BUILTINS.has(pkg)) continue;
    for (const named of imp.namedImports ?? []) {
      if (!named.isTypeOnly) bindings.set(named.alias ?? named.name, pkg);
    }
    if (imp.defaultImport) bindings.set(imp.defaultImport, pkg);
    if (imp.namespaceImport) bindings.set(imp.namespaceImport, pkg);
  }
  return bindings;
}

// Maps detector kinds onto the side_effects.type enum. unknown_external
// reuses external_integration (metadata.detectorKind distinguishes it) so
// the honesty rule ships without a schema change.
const EFFECT_TYPE_BY_KIND: Record<DetectedSideEffect['kind'], string> = {
  database_write: 'database_write',
  database_read: 'database_read',
  http_call: 'http_request',
  file_write: 'filesystem_write',
  message_publish: 'queue_enqueue',
  email_send: 'external_integration',
  cache_write: 'external_integration',
  auth_call: 'auth_check',
  external_service: 'external_integration',
  process_exec: 'external_integration',
  unknown_external: 'external_integration',
};

export async function persistSideEffects(
  snapshotId: string,
  effects: DetectedSideEffect[],
  nodeIdMap: Map<string, string>,
): Promise<void> {
  // One multi-VALUES INSERT per chunk — the per-row loop cost a round trip
  // per effect against the remote pooler (latency overhaul Track C).
  const persistable = effects
    .map((eff) => ({
      eff,
      nodeId:
        (eff.symbolStableKey ? nodeIdMap.get(eff.symbolStableKey) : undefined) ??
        nodeIdMap.get(eff.nodeStableKey),
    }))
    .filter((e): e is { eff: DetectedSideEffect; nodeId: string } => e.nodeId !== undefined);

  const CHUNK = 500;
  for (let i = 0; i < persistable.length; i += CHUNK) {
    const part = persistable.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = part.map(({ eff, nodeId }, j) => {
      values.push(
        snapshotId, nodeId, EFFECT_TYPE_BY_KIND[eff.kind], eff.target ?? null,
        eff.confidence ?? 'medium',
        eff.evidence ?? `Detected ${eff.kind} pattern in ${eff.filePath}${eff.symbolName ? `::${eff.symbolName}` : ''}`,
        JSON.stringify({
          symbolName: eff.symbolName,
          detectorKind: eff.kind,
          ...(eff.queueHint ? { queueHint: eff.queueHint } : {}),
        }),
      );
      const base = j * 7;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    // Same reasoning as persistEntrypoints: autocommit, so a cancelled
    // statement leaves nothing behind and the retry cannot duplicate rows.
    await withStatementTimeoutRetry('persistSideEffects/insert', () => query(
      `INSERT INTO side_effects (snapshot_id, node_id, type, target, confidence, evidence, metadata)
       VALUES ${tuples.join(', ')}`,
      values,
    ));
  }
}
