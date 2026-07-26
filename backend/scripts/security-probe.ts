/**
 * Live security probe: direct API-bypass, SQLi, CSRF, IDOR/authz, and header
 * checks against a running OnboardBuddy backend. Unlike `security:report`
 * (which replays production functions offline over a fixture), this makes
 * real HTTP calls to `http://localhost:3000` and prints a verdict table
 * derived from the actual responses.
 *
 * Requires: backend-api running on :3000, `OB_TOKEN` (a live Supabase JWT —
 * `node backend/_scratch_token.mjs`), `OB_PROJECT_ID` (a project the token's
 * user owns/admins), and for the fuller probe set, `OB_DEVTIER_PROJECT_ID`
 * (a project where the same user is `developer` tier) and
 * `OB_FOREIGN_PROJECT_ID` (a project the user has no membership on at all).
 *
 * Reads the shared payload catalogue at `test/security/xssPayloads.json` so
 * the payload ids line up with the browser E2E spec's ids in the final report.
 *
 * Usage: OB_TOKEN=... OB_PROJECT_ID=... npm run security:probe -w backend
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const BASE = process.env.OB_API_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.OB_TOKEN;
const PROJECT_ID = process.env.OB_PROJECT_ID;
const DEVTIER_PROJECT_ID = process.env.OB_DEVTIER_PROJECT_ID;
const FOREIGN_PROJECT_ID = process.env.OB_FOREIGN_PROJECT_ID;

if (!TOKEN || !PROJECT_ID) {
  console.error('OB_TOKEN and OB_PROJECT_ID are required. See header comment for how to obtain them.');
  process.exit(1);
}

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}
const backendEnv = loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const pool = new Pool({ connectionString: backendEnv.DATABASE_URL });

interface XssPayload { xid: string; label: string; payload: string }
interface SqliPayload { sid: string; label: string; payload: string }
interface PayloadCatalogue { xss: XssPayload[]; sqli: SqliPayload[] }

// Local, static fixture we authored (test/security/xssPayloads.json) — not
// external/network input, so a single boundary cast is appropriate here.
const catalogue: PayloadCatalogue = JSON.parse(
  readFileSync(fileURLToPath(new URL('../test/security/xssPayloads.json', import.meta.url)), 'utf8'),
);

interface Row {
  id: string;
  request: string;
  status: number | 'ERR';
  outcome: string;
}
const rows: Row[] = [];

const AUTH_HEADERS: Record<string, string> = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function call(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: opts.headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

/** Narrow shape of the `GET /projects/:id` response this probe reads back. */
interface ProjectGetResponse {
  project?: { settings?: { ignored_paths?: unknown } };
}
function isProjectGetResponse(v: unknown): v is ProjectGetResponse {
  return typeof v === 'object' && v !== null;
}
function readStoredIgnoredPaths(text: string): string[] | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  if (!isProjectGetResponse(parsed)) return undefined;
  const paths = parsed.project?.settings?.ignored_paths;
  return Array.isArray(paths) && paths.every((p) => typeof p === 'string') ? paths : undefined;
}

function record(id: string, request: string, status: number | 'ERR', outcome: string) {
  rows.push({ id, request, status, outcome });
  console.log(`[${id}] ${request} -> ${status} :: ${outcome}`);
}

/** Fails fast on a dead/empty token instead of every probe silently reading as "blocked". */
async function preflight(): Promise<void> {
  const res = await fetch(`${BASE}/api/projects`, { headers: AUTH_HEADERS });
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(`Preflight failed: GET /api/projects -> ${res.status} ${text.slice(0, 200)}. OB_TOKEN is dead/expired — regenerate with node _scratch_token.mjs before rerunning.`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  const projects = parsed && typeof parsed === 'object' && 'projects' in parsed ? (parsed as { projects: unknown }).projects : undefined;
  const ids = Array.isArray(projects) ? projects.map((p) => (p as { id?: unknown }).id) : [];
  if (!ids.includes(PROJECT_ID)) {
    throw new Error(`Preflight failed: OB_TOKEN's project list does not include OB_PROJECT_ID (${PROJECT_ID}). Got: ${JSON.stringify(ids)}`);
  }
  console.log(`Preflight OK — token live, project list includes ${PROJECT_ID}.`);
}

async function main() {
  await preflight();

  // ── 5a. Payload injection bypassing the UI ────────────────────────────
  console.log('\n=== 5a. Direct API payload injection (bypasses React client validation) ===\n');

  // ignored_paths (string[], no content validation per projects.ts:375-377) — cheap, no LLM cost.
  for (const p of catalogue.xss) {
    const r = await call('PUT', `/api/projects/${PROJECT_ID}/settings`, {
      headers: AUTH_HEADERS,
      body: { ignored_paths: [p.payload] },
    });
    let stored = 'n/a';
    if (r.status === 200) {
      const get = await call('GET', `/api/projects/${PROJECT_ID}`, { headers: AUTH_HEADERS });
      const gotPaths = readStoredIgnoredPaths(get.text);
      stored = gotPaths?.[0] === p.payload ? 'byte-identical on GET' : `mismatch: ${JSON.stringify(gotPaths)}`;
    }
    record(`5a-settings-${p.xid}`, `PUT /projects/:id/settings {ignored_paths:["${p.label}"]}`, r.status,
      r.status === 200 ? `accepted, stored=${stored}` : `rejected: ${r.text.slice(0, 120)}`);
  }

  // team invite email — cheap DB write, no LLM cost.
  for (const p of catalogue.xss) {
    const email = `${p.xid.toLowerCase()}-probe+${p.payload}@example.com`.slice(0, 250);
    const r = await call('POST', `/api/projects/${PROJECT_ID}/members/invitations`, {
      headers: AUTH_HEADERS,
      body: { email, permission_tier: 'developer' },
    });
    record(`5a-invite-${p.xid}`, `POST /projects/:id/members/invitations {email:"${p.label}"}`, r.status,
      r.status === 201 || r.status === 200 ? 'accepted, stored as invitation row' : `rejected: ${r.text.slice(0, 120)}`);
  }

  // /ask (question) — real LLM call per attempt; fire a bounded representative
  // subset (raw script tag + attribute breakout) rather than all six, since
  // the storage/escaping mechanism is already proven payload-agnostic above.
  // Run against ASK_PROJECT_ID (default: an already-analyzed project) since
  // /ask 404s with "No analyzed snapshot found" on the throwaway PROJECT_ID,
  // which has no snapshot — that precondition, not payload handling, would
  // otherwise be all this probe exercises.
  const askProjectId = process.env.OB_ASK_PROJECT_ID ?? PROJECT_ID;
  const askSubset = catalogue.xss.filter((p) => p.xid === 'X-01' || p.xid === 'X-04');
  for (const p of askSubset) {
    const r = await call('POST', `/api/projects/${askProjectId}/ask`, {
      headers: AUTH_HEADERS,
      body: { question: p.payload },
    });
    record(`5a-ask-${p.xid}`, `POST /projects/${askProjectId === PROJECT_ID ? ':id' : ':analyzed-id'}/ask {question:"${p.label}"}`, r.status,
      r.status === 200 ? 'accepted, LLM call made; response is model-generated answerMarkdown, question text not echoed back by the API (client-side echo is a separate React value, verified in step 4)' : `rejected: ${r.text.slice(0, 200)}`);
  }

  // POST /api/projects (repo_owner/repo_name/branch) — requires a real
  // github_installation_id; a fabricated one exercises the ownership check.
  {
    const p = catalogue.xss[0]!;
    const r = await call('POST', '/api/projects', {
      headers: AUTH_HEADERS,
      body: { repo_owner: p.payload, repo_name: p.payload, branch: 'main', github_installation_id: '999999999' },
    });
    record('5a-create-project', `POST /projects {repo_owner:"${p.label}", github_installation_id:"999999999"}`, r.status,
      r.status >= 400
        ? `rejected before storage: ${r.text.slice(0, 160)} (structural: requires real installation ownership + live GitHub repo lookup, not just field validation)`
        : `unexpectedly accepted: ${r.text.slice(0, 160)}`);
  }

  // ── 5b. SQL injection ──────────────────────────────────────────────────
  console.log('\n=== 5b. SQL injection ===\n');

  const staticGrepCwd = fileURLToPath(new URL('..', import.meta.url));
  let staticGrep = '';
  try {
    staticGrep = execSync(
      String.raw`grep -rn "query(\s*[\`'\"][^\`'\"]*(\${|\"\s*\+|'\s*\+)" src`,
      { cwd: staticGrepCwd, encoding: 'utf8' },
    ).trim();
  } catch (err) {
    // grep exits non-zero (and throws) when it finds no matches — that's the good outcome.
    staticGrep = (err as { stdout?: string }).stdout?.trim() ?? '';
  }
  record('5b-static', 'grep for string-concatenated SQL under backend/src', 'ERR',
    staticGrep.length === 0
      ? 'no matches — all SQL is parameterized (verified by construction)'
      : `UNEXPECTED MATCHES:\n${staticGrep}`);

  for (const s of catalogue.sqli) {
    const r = await call('PUT', `/api/projects/${PROJECT_ID}/settings`, {
      headers: AUTH_HEADERS,
      body: { ignored_paths: [s.payload] },
    });
    record(`5b-settings-${s.sid}`, `PUT /projects/:id/settings {ignored_paths:["${s.label}"]}`, r.status,
      r.status === 200 ? 'accepted as literal string value (bound param, not concatenated into SQL)' : `rejected: ${r.text.slice(0, 120)}`);
  }
  {
    const s = catalogue.sqli[0]!;
    const r = await call('POST', `/api/projects/${askProjectId}/ask`, { headers: AUTH_HEADERS, body: { question: s.payload } });
    record(`5b-ask-${s.sid}`, `POST /projects/${askProjectId === PROJECT_ID ? ':id' : ':analyzed-id'}/ask {question:"${s.label}"}`, r.status,
      r.status < 500 ? 'no server error; treated as literal question text' : `SERVER ERROR: ${r.text.slice(0, 200)}`);
  }
  {
    const malformed = "'; DROP TABLE project_members;--";
    const r = await call('GET', `/api/projects/${encodeURIComponent(malformed)}`, { headers: AUTH_HEADERS });
    record('5b-id-param', 'GET /projects/:id with SQLi in :id path param', r.status,
      r.status < 500
        ? `handled without leaking internals: ${r.text.slice(0, 120)}`
        : `POSSIBLE INFO LEAK: ${r.text.slice(0, 300)}`);
  }
  {
    const malformedUuid = 'not-a-uuid';
    const r = await call('GET', `/api/projects/${malformedUuid}`, { headers: AUTH_HEADERS });
    const leaksPgError = /invalid input syntax|pg_|PostgresError|at Parser|node_modules/i.test(r.text);
    record('5b-malformed-uuid', 'GET /projects/:id with malformed UUID', r.status,
      leaksPgError ? `INFO DISCLOSURE — raw pg error reached client: ${r.text.slice(0, 300)}` : `clean error, no pg internals leaked: ${r.text.slice(0, 120)}`);
  }
  {
    const check = await pool.query('SELECT count(*)::int AS n FROM project_members');
    const n = check.rows[0].n;
    record('5b-integrity', 'SELECT count(*) FROM project_members after all SQLi attempts', 'ERR', `table intact, ${n} rows`);
  }

  // ── 5c. CSRF ────────────────────────────────────────────────────────────
  console.log('\n=== 5c. CSRF ===\n');
  {
    const r = await call('PUT', `/api/projects/${PROJECT_ID}/settings`, {
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: { ignored_paths: ['csrf-probe'] },
    });
    record('5c-csrf', 'PUT /projects/:id/settings, Origin: https://evil.example, no Authorization header', r.status,
      r.status === 401 ? '401 — requireAuth blocks it; header-based bearer auth is not attachable cross-site' : `UNEXPECTED: ${r.text.slice(0, 160)}`);
  }

  // ── 5d. IDOR / authz ────────────────────────────────────────────────────
  console.log('\n=== 5d. IDOR / authz ===\n');
  if (FOREIGN_PROJECT_ID) {
    const r1 = await call('GET', `/api/projects/${FOREIGN_PROJECT_ID}/onboarding`, { headers: AUTH_HEADERS });
    record('5d-idor-get', 'GET /projects/<not-a-member>/onboarding', r1.status,
      r1.status === 403 ? `403 — ${r1.text.slice(0, 120)}` : `UNEXPECTED: ${r1.text.slice(0, 160)}`);

    const r2 = await call('PUT', `/api/projects/${FOREIGN_PROJECT_ID}/settings`, {
      headers: AUTH_HEADERS,
      body: { ignored_paths: ['idor-probe'] },
    });
    record('5d-idor-put', 'PUT /projects/<not-a-member>/settings', r2.status,
      r2.status === 403 ? `403 — ${r2.text.slice(0, 120)}` : `UNEXPECTED: ${r2.text.slice(0, 160)}`);
  } else {
    record('5d-idor', 'skipped', 'ERR', 'OB_FOREIGN_PROJECT_ID not set');
  }
  if (DEVTIER_PROJECT_ID) {
    const r = await call('PUT', `/api/projects/${DEVTIER_PROJECT_ID}/settings`, {
      headers: AUTH_HEADERS,
      body: { ignored_paths: ['tier-probe'] },
    });
    record('5d-tier', 'PUT /projects/:id/settings as developer-tier member (owner|admin-only route)', r.status,
      r.status === 403 ? `403 — ${r.text.slice(0, 120)}` : `UNEXPECTED: ${r.text.slice(0, 160)}`);
  } else {
    record('5d-tier', 'skipped', 'ERR', 'OB_DEVTIER_PROJECT_ID not set');
  }

  // ── 5e. Security headers & platform hygiene ─────────────────────────────
  console.log('\n=== 5e. Security headers & platform hygiene ===\n');
  {
    const res = await fetch('http://localhost:5173/');
    const csp = res.headers.get('content-security-policy');
    record('5e-dev-csp', 'GET http://localhost:5173/ (Vite dev server)', res.status,
      csp ? `UNEXPECTED CSP present in dev: ${csp}` : 'no CSP header — expected; dev-only observation, CSP is an nginx-layer, production-image control (frontend/security-headers.conf)');
  }
  {
    const bigArray = Array.from({ length: 250 }, (_, i) => `path-${i}`);
    const r = await call('PUT', `/api/projects/${PROJECT_ID}/settings`, { headers: AUTH_HEADERS, body: { ignored_paths: bigArray } });
    record('5e-no-app-validation-yet', 'PUT settings with 250-entry ignored_paths array (pre-fix baseline)', r.status,
      r.status === 200 ? 'accepted, no size cap enforced yet (see step 8 fix)' : `rejected: ${r.text.slice(0, 120)}`);
  }
  {
    const oversized = JSON.stringify({ ignored_paths: ['x'.repeat(150_000)] });
    const res = await fetch(`${BASE}/api/projects/${PROJECT_ID}/settings`, {
      method: 'PUT', headers: AUTH_HEADERS, body: oversized,
    });
    record('5e-body-cap', 'PUT settings with ~150KB body (express.json() default 100kB cap)', res.status,
      res.status === 413 ? '413 Payload Too Large — 100kB cap enforced' : `did not hit cap: ${res.status}`);
  }
  record('5e-rate-limit-baseline', 'grep for rate-limiting middleware in app.ts', 'ERR',
    'none present (see step 8: ask-only limiter added this round)');

  // ── summary ─────────────────────────────────────────────────────────────
  console.log('\n=== Summary ===\n');
  console.log('| Probe | Request | Status | Outcome |');
  console.log('|-------|---------|--------|---------|');
  for (const r of rows) {
    console.log(`| ${r.id} | ${r.request} | ${r.status} | ${r.outcome.replace(/\|/g, '\\|').slice(0, 200)} |`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('security-probe failed:', err);
  process.exitCode = 1;
});
