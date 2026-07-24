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
  { signal: 'auth_check', pattern: /jwt\.verify|jwtVerify|requireProjectAccess|verifyToken|authenticate/ },
  { signal: 'env_read', pattern: /process\.env\./ },
  { signal: 'response_output', pattern: /\bres\.(json|send|status)\b|Response\.json/ },
  { signal: 'filesystem', pattern: /\bfs\.|writeFile|readFile|createWriteStream/ },
  { signal: 'crypto', pattern: /crypto\.|createHash|createCipher|encrypt|decrypt/ },
  { signal: 'ast_parse', pattern: /createProgram|parseSourceFile|SourceFile|SyntaxKind/ },
];

const PURPOSE_RULES: Array<{ signal: string; pattern: RegExp }> = [
  { signal: 'authentication', pattern: /auth|login|signup|token|session/i },
  { signal: 'project_management', pattern: /project|invitation|member|team/i },
  { signal: 'repository_analysis', pattern: /analysis|analyz|ast|symbol|graph|ingest|parser/i },
  { signal: 'onboarding_generation', pattern: /onboarding|summary|section|package|walkthrough|tutorial/i },
  { signal: 'github_integration', pattern: /github|octokit|installation|zipball/i },
  { signal: 'ui', pattern: /component|page|view|render/i },
  { signal: 'configuration', pattern: /config|setting|env/i },
];

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

export function derivePurposeSignals(relativePath: string, symbol: Pick<SymbolInfo, 'name'>): string[] {
  const haystack = `${relativePath} ${symbol.name}`;
  return PURPOSE_RULES.filter((r) => r.pattern.test(haystack)).map((r) => r.signal);
}
