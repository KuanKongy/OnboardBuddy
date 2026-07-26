import type { SymbolInfo } from '../types/analysis.js';

/**
 * Deterministic behavior/purpose signal detection. Signals are cheap
 * lower-trust hints stamped into graph node metadata: they feed candidate
 * ranking and semantic-pass prompts, never claims on their own.
 */

const BEHAVIOR_RULES: Array<{ signal: string; pattern: RegExp }> = [
  { signal: 'http_route', pattern: /\b(router|app)\.(get|post|put|patch|delete|all|use)\b/ },
  // Bare `query(` covers db-helper conventions (`import { query } from db`);
  // requiring `.query(` missed every route handler in repos built that way
  // and their writes shipped as "Data Read" steps (audit §5.4).
  { signal: 'database_read', pattern: /(?<![.\w])query\s*\(|\.query\s*\(|\.(select|findMany|findOne|findFirst)\b|supabase\.from|\bSELECT\s/ },
  // SQL verbs are matched case-sensitively: lowercase "update the … set"
  // is prose, `UPDATE projects SET` is a write.
  { signal: 'database_write', pattern: /\.(insert|update|delete|upsert|create|save|destroy)\b|\b(?:INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM|TRUNCATE\s+\w)/ },
  // `(\(\s*\))?` covers factory conventions — `getAnalysisQueue().add(...)`.
  { signal: 'queue_enqueue', pattern: /(queue|Queue)\w*\s*(\(\s*\))?\s*\.add\b/ },
  { signal: 'queue_consume', pattern: /new Worker\b|\.process\s*\(/ },
  { signal: 'http_request', pattern: /\bfetch\s*\(|axios\b|octokit\b/ },
  { signal: 'auth_check', pattern: /jwt\.verify|jwtVerify|requireProjectAccess|verifyToken|authenticate|supabase\w*\.auth\.|\.signUp\s*\(|\.signInWith\w+\s*\(|\.signOut\s*\(|bcrypt\w*\.(hash|compare)/ },
  { signal: 'env_read', pattern: /process\.env\./ },
  { signal: 'response_output', pattern: /\bres\.(json|send|status)\b|Response\.json/ },
  { signal: 'filesystem', pattern: /\bfs\.|writeFile|readFile|createWriteStream/ },
  { signal: 'crypto', pattern: /crypto\.|createHash|createCipher|encrypt|decrypt/ },
  { signal: 'ast_parse', pattern: /createProgram|parseSourceFile|SourceFile|SyntaxKind/ },
];

/*
 * There is deliberately no purpose/domain rule table here.
 *
 * There used to be one: seven regexes mapping a path or symbol substring onto a
 * domain phrase — `onboarding_generation`, `project_management`,
 * `repository_analysis`, `github_integration`. Those are THIS product's
 * vocabulary, and `derivePurposeSignals` stamped them onto every repo we
 * analyse. Measured consequences, all live:
 *
 *   - a student club's marketing site had `src/components/sections/About.tsx`
 *     described as "Handles ui route via About (onboarding generation)", and
 *     the package's opening paragraph then said the site exists "for onboarding
 *     and project management purposes";
 *   - `src/components/sections/Team.tsx` became "(project management)";
 *   - `Toaster` became "(repository analysis)" on every repo in the fleet,
 *     because `/ast/` has no word boundary and matches to·ast·er.
 *
 * The failure is not the missing `\b`. A phrase table keyed on path substrings
 * can only ever describe the domain of whoever wrote the table, and every
 * unseen repo pays for it. Purpose is now derived where the evidence is —
 * `workflowExtractor.classifyPurpose` reads the tables, resources and services
 * a flow's own steps reach, so a repo is described in its own nouns or in none.
 *
 * BEHAVIOR_RULES above stay: they name a MECHANISM ("this calls a query", "this
 * registers a worker"), which is a property of the code in front of us and
 * carries no claim about what the product is for.
 */

/** Accepts top-level symbols and class methods alike — both carry calls + snippet. */
type SignalSource = Pick<SymbolInfo, 'callsSymbols' | 'initializer' | 'snippet' | 'methods'>;

export function deriveBehaviorSignals(symbol: SignalSource): string[] {
  const haystack = [
    ...(symbol.callsSymbols ?? []),
    ...(symbol.methods?.flatMap((m) => m.callsSymbols ?? []) ?? []),
    symbol.initializer ?? '',
    // Argument-shaped patterns (e.g. `.query('INSERT`) only occur in source
    // text, never in callee names.
    symbol.snippet ?? '',
  ].join(' ');
  if (!haystack.trim()) return [];

  const signals = BEHAVIOR_RULES.filter((r) => r.pattern.test(haystack)).map((r) => r.signal);
  const callCount = symbol.callsSymbols?.length ?? 0;
  if (callCount >= 8) signals.push('orchestration');
  return signals;
}
