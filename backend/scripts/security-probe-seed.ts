/**
 * Seeds the throwaway fixture projects that `security:probe` and
 * `frontend/e2e/xss-forms.spec.ts` run against, plus mints a fresh Supabase
 * session token for the test account.
 *
 * Why fixtures, not the team's real projects: the probes write ignored_paths,
 * pending invitations, and settings, so they need a project the test account
 * fully owns rather than mutating a teammate's real repo data.
 *
 * Safety: `OB_TEST_EMAIL` may be a real teammate's account (it authenticates
 * via a real magic link), so nothing here is scoped by user identity. Every
 * row this script creates is recorded by exact id in a manifest
 * (`doc/plans/.security-probe-fixture.json`, already git-excluded via
 * `.git/info/exclude`) that `security-probe-teardown.ts` deletes by id —
 * never by "everything this user owns". The teardown script never touches
 * the `users` row: that row can belong to a real person's real account.
 *
 * Usage:
 *   npm run security:probe:seed -w backend
 *   # prints OB_TOKEN / OB_PROJECT_ID / OB_DEVTIER_PROJECT_ID /
 *   # OB_FOREIGN_PROJECT_ID / OB_ASK_PROJECT_ID as shell export lines on
 *   # stdout — eval them, or copy into your shell.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

const backendEnv = loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const frontendEnv = loadEnvFile(fileURLToPath(new URL('../../frontend/.env', import.meta.url)));
const MANIFEST_PATH = fileURLToPath(new URL('../../doc/plans/.security-probe-fixture.json', import.meta.url));

const TEST_EMAIL = process.env.OB_TEST_EMAIL ?? 'ng.eugene2004@gmail.com';

const admin = createClient(backendEnv.SUPABASE_URL!, backendEnv.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(backendEnv.SUPABASE_URL!, frontendEnv.VITE_SUPABASE_ANON_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface FixtureManifest {
  userId: string;
  createdProjectIds: string[];
  readOnlyGrant: { projectId: string; userId: string } | null;
}

async function createThrowawayProject(
  pool: Pool,
  userId: string,
  repoName: string,
  tier: 'owner' | 'developer',
): Promise<string> {
  const proj = await pool.query<{ id: string }>(
    `INSERT INTO projects (repo_owner, repo_name, branch, user_id) VALUES ($1, $2, 'main', $3) RETURNING id`,
    ['ng-eugene', repoName, userId],
  );
  const projectId = proj.rows[0]!.id;
  await pool.query(
    `INSERT INTO project_settings (project_id, default_developer_role) VALUES ($1, 'general')`,
    [projectId],
  );
  await pool.query(
    `INSERT INTO project_members (project_id, user_id, permission_tier, developer_role) VALUES ($1, $2, $3, 'general')`,
    [projectId, userId, tier],
  );
  return projectId;
}

async function main(): Promise<void> {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: TEST_EMAIL,
  });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);

  const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);

  const userId = verifyData.user.id;
  const accessToken = verifyData.session.access_token;

  const pool = new Pool({ connectionString: backendEnv.DATABASE_URL });

  // Only create the public.users row if one doesn't already exist — if this
  // email belongs to a real account that has logged in before, that row is
  // real and teardown must never touch it either way (it doesn't).
  await pool.query(
    `INSERT INTO public.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [userId, TEST_EMAIL],
  );

  const ownerProjectId = await createThrowawayProject(pool, userId, 'security-probe-owner', 'owner');
  const devtierProjectId = await createThrowawayProject(pool, userId, 'security-probe-devtier', 'developer');

  // A project the test user is NOT a member of, for IDOR probes — reuse any
  // existing real project rather than creating one (there is nothing to grant).
  const foreign = await pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE user_id <> $1 ORDER BY created_at LIMIT 1`,
    [userId],
  );
  const foreignProjectId = foreign.rows[0]?.id;

  // A read-only grant on an already-analyzed ("complete") project, so the
  // graph/architecture search-box E2E cases have real rendered data to
  // filter. Never written to by the probes — see xss-forms.spec.ts's
  // READONLY_COMPLETE_PROJECT_ID. Recorded in the manifest so teardown
  // revokes exactly this one grant, not every membership this user holds.
  const analyzed = await pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE user_id <> $1 AND status = 'complete' ORDER BY created_at LIMIT 1`,
    [userId],
  );
  const askProjectId = analyzed.rows[0]?.id;
  if (askProjectId) {
    await pool.query(
      `INSERT INTO project_members (project_id, user_id, permission_tier, developer_role)
       VALUES ($1, $2, 'developer', 'general') ON CONFLICT (project_id, user_id) DO NOTHING`,
      [askProjectId, userId],
    );
  }

  await pool.end();

  const manifest: FixtureManifest = {
    userId,
    createdProjectIds: [ownerProjectId, devtierProjectId],
    readOnlyGrant: askProjectId ? { projectId: askProjectId, userId } : null,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`export OB_TOKEN='${accessToken}'`);
  console.log(`export OB_PROJECT_ID='${ownerProjectId}'`);
  console.log(`export OB_DEVTIER_PROJECT_ID='${devtierProjectId}'`);
  if (foreignProjectId) console.log(`export OB_FOREIGN_PROJECT_ID='${foreignProjectId}'`);
  if (askProjectId) console.log(`export OB_ASK_PROJECT_ID='${askProjectId}'`);
  console.error(`# seeded user_id=${userId}; manifest written to ${MANIFEST_PATH}`);
  console.error(`# run \`npm run security:probe:teardown -w backend\` when done`);
}

main().catch((err) => {
  console.error('security-probe-seed failed:', err);
  process.exitCode = 1;
});
