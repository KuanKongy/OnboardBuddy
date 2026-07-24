import type { FileAnalysis } from '../types/analysis.js';
import { query } from '../../lib/db.js';

export interface DetectedSideEffect {
  /** File-level key (relative path) — used by workflow traversal. */
  nodeStableKey: string;
  kind:
    | 'database_write' | 'http_call' | 'file_write' | 'message_publish'
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

const PLAIN_FAMILIES: Array<{ kind: DetectedSideEffect['kind']; patterns: RegExp[] }> = [
  { kind: 'database_write', patterns: DB_WRITE_PATTERNS },
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

export function detectSideEffects(fileAnalyses: FileAnalysis[]): DetectedSideEffect[] {
  const effects: DetectedSideEffect[] = [];

  for (const fa of fileAnalyses) {
    const relativePath = fa.relativePath;
    // binding name -> external package, for the unknown-external fallback.
    const externalBindings = collectExternalBindings(fa);
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
            // journey composer stitches on.
            const enqueue = callsStr.match(ENQUEUE_CALL_RE);
            if (enqueue) {
              if (enqueue[2]) effect.target = enqueue[2];
              const hint = normalizeQueueToken(enqueue[1]!);
              if (hint) effect.queueHint = hint;
            }
          }
          if (family.kind === 'process_exec') effect.target = 'child_process';
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
    await query(
      `INSERT INTO side_effects (snapshot_id, node_id, type, target, confidence, evidence, metadata)
       VALUES ${tuples.join(', ')}`,
      values,
    );
  }
}
