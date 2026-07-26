/**
 * Reverses `security-probe-seed.ts` — and only what it created.
 *
 * Safety: this deletes by exact id from the manifest
 * (`doc/plans/.security-probe-fixture.json`), never by "everything this
 * user owns/is a member of". `OB_TEST_EMAIL` can be a real teammate's real
 * account (the seed script authenticates via a real magic link to it), so a
 * broad `WHERE user_id = $1` sweep across `projects`/`project_members`, or a
 * `DELETE FROM users`, would risk destroying that person's real data the
 * next time they have any. This script never deletes the `users` row.
 *
 * Usage: npm run security:probe:teardown -w backend
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

interface FixtureManifest {
  userId: string;
  createdProjectIds: string[];
  readOnlyGrant: { projectId: string; userId: string } | null;
}
function isFixtureManifest(v: unknown): v is FixtureManifest {
  return typeof v === 'object' && v !== null && 'userId' in v && 'createdProjectIds' in v;
}

const backendEnv = loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const MANIFEST_PATH = fileURLToPath(new URL('../../doc/plans/.security-probe-fixture.json', import.meta.url));

async function main(): Promise<void> {
  if (!existsSync(MANIFEST_PATH)) {
    console.log(`Nothing to tear down — no manifest at ${MANIFEST_PATH}`);
    return;
  }
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (!isFixtureManifest(parsed)) {
    throw new Error(`Manifest at ${MANIFEST_PATH} is not the expected shape — refusing to guess what to delete.`);
  }

  const pool = new Pool({ connectionString: backendEnv.DATABASE_URL });

  if (parsed.createdProjectIds.length > 0) {
    const dropped = await pool.query<{ repo_full_name: string }>(
      `DELETE FROM projects WHERE id = ANY($1) RETURNING repo_full_name`,
      [parsed.createdProjectIds],
    );
    console.log(`Deleted ${dropped.rows.length} throwaway project(s):`, dropped.rows.map((r) => r.repo_full_name));
  }

  if (parsed.readOnlyGrant) {
    const revoked = await pool.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING project_id`,
      [parsed.readOnlyGrant.projectId, parsed.readOnlyGrant.userId],
    );
    console.log(`Revoked ${revoked.rows.length} read-only grant on ${parsed.readOnlyGrant.projectId}.`);
  }

  console.log(`Left the users row for user_id=${parsed.userId} in place — it may be a real account.`);

  await pool.end();
  unlinkSync(MANIFEST_PATH);
}

main().catch((err) => {
  console.error('security-probe-teardown failed:', err);
  process.exitCode = 1;
});
