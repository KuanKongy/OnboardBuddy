/**
 * One-off maintenance for snapshots analyzed before mount-chain resolution
 * (entrypointDetector.buildMountPrefixes) and fixture exclusion existed:
 *
 *  1. entrypoints.route_path: sub-router path -> full mounted path
 *     ("GET /" in onboarding.ts -> "GET /api/projects/:id/onboarding").
 *  2. workflows.title for http workflows: rebuilt from the full path — the
 *     Workflows rail showed "GET /" seven times for seven different routers.
 *  3. Workflows seeded from fixture/test files are deleted (they were never
 *     product flows; new analyses can't produce them anymore). Steps cascade;
 *     tutorial/receipt links are ON DELETE SET NULL — the script aborts if
 *     any tutorial actually references one.
 *
 * The mount map is the repo's static router table (backend/src/api/app.ts +
 * routes/index.ts). Usage from repo root (reads backend/.env):
 *   node --import tsx backend/scripts/backfill-route-paths.ts            # dry run
 *   node --import tsx backend/scripts/backfill-route-paths.ts --apply
 */
import 'dotenv/config';
import { query, pool } from '../src/lib/db.js';
import { joinRoutePaths } from '../src/worker/engine/entrypointDetector.js';
import { isTestOrFixturePath } from '../src/worker/engine/testPaths.js';

const apply = process.argv.includes('--apply');

/** Router file -> full mount prefix (app.use('/api', …) already included). */
const MOUNT_PREFIX: Record<string, string> = {
  'backend/src/api/routes/health.ts': '/api/health',
  'backend/src/api/routes/auth.ts': '/api/auth',
  'backend/src/api/routes/github.ts': '/api/github',
  'backend/src/api/routes/projects.ts': '/api/projects',
  'backend/src/api/routes/invitations.ts': '/api/invitations',
  'backend/src/api/routes/members.ts': '/api/projects/:id/members',
  'backend/src/api/routes/graph.ts': '/api/projects/:id/graph',
  'backend/src/api/routes/onboarding.ts': '/api/projects/:id/onboarding',
  'backend/src/api/routes/workflows.ts': '/api/projects/:id/workflows',
  'backend/src/api/routes/capabilities.ts': '/api/projects/:id/capabilities',
  'backend/src/api/routes/tutorials.ts': '/api/projects/:id/tutorials',
  'backend/src/api/routes/progress.ts': '/api/projects/:id/progress',
  'backend/src/api/routes/llmKeys.ts': '/api/projects/:id/llm-key',
  'backend/src/api/routes/ask.ts': '/api/projects/:id/ask',
  'backend/src/api/routes/internalChat.ts': '/api/internal/chat',
  'backend/src/api/routes/githubWebhook.ts': '/api/webhooks/github',
};

async function main(): Promise<void> {
  const eps = (await query(
    `SELECT e.id, e.snapshot_id, e.method, e.route_path, gn.file_path
     FROM entrypoints e JOIN graph_nodes gn ON gn.id = e.node_id
     WHERE e.trigger_type = 'http_route' AND e.route_path IS NOT NULL`,
  )).rows as Array<{ id: string; snapshot_id: string; method: string | null; route_path: string; file_path: string | null }>;

  const epUpdates: Array<{ id: string; from: string; to: string }> = [];
  for (const ep of eps) {
    const prefix = ep.file_path ? MOUNT_PREFIX[ep.file_path] : undefined;
    if (!prefix || ep.route_path.startsWith('/api/')) continue;
    epUpdates.push({ id: ep.id, from: ep.route_path, to: joinRoutePaths(prefix, ep.route_path) });
  }

  const wfs = (await query(
    `SELECT w.id, w.title, w.trigger_type, e.method, e.route_path, e.id AS ep_id, gn.file_path
     FROM workflows w
     LEFT JOIN entrypoints e ON e.id = w.entrypoint_id
     LEFT JOIN graph_nodes gn ON gn.id = e.node_id`,
  )).rows as Array<{ id: string; title: string; trigger_type: string; method: string | null; route_path: string | null; ep_id: string | null; file_path: string | null }>;

  const epNewPath = new Map(epUpdates.map((u) => [u.id, u.to]));
  const titleUpdates: Array<{ id: string; from: string; to: string }> = [];
  const fixtureWorkflows: Array<{ id: string; title: string; file: string }> = [];
  for (const wf of wfs) {
    if (wf.file_path && isTestOrFixturePath(wf.file_path)) {
      fixtureWorkflows.push({ id: wf.id, title: wf.title, file: wf.file_path });
      continue;
    }
    if (!wf.ep_id || !wf.route_path) continue;
    const full = epNewPath.get(wf.ep_id) ?? wf.route_path;
    const to = `${wf.method ?? 'HTTP'} ${full}`;
    if (to !== wf.title) titleUpdates.push({ id: wf.id, from: wf.title, to });
  }

  const tutRefs = fixtureWorkflows.length
    ? ((await query(
        `SELECT id, workflow_id FROM tutorials WHERE workflow_id = ANY($1)`,
        [fixtureWorkflows.map((w) => w.id)],
      )).rows as Array<{ id: string }>)
    : [];
  if (tutRefs.length > 0) {
    throw new Error(`${tutRefs.length} tutorial(s) reference fixture workflows — aborting, resolve manually.`);
  }

  console.error(`entrypoint route_path updates: ${epUpdates.length}`);
  for (const u of epUpdates.slice(0, 12)) console.error(`  ${u.from} -> ${u.to}`);
  if (epUpdates.length > 12) console.error(`  … ${epUpdates.length - 12} more`);
  console.error(`workflow title updates: ${titleUpdates.length}`);
  for (const u of titleUpdates.slice(0, 12)) console.error(`  "${u.from}" -> "${u.to}"`);
  if (titleUpdates.length > 12) console.error(`  … ${titleUpdates.length - 12} more`);
  console.error(`fixture workflows to delete: ${fixtureWorkflows.length}`);
  for (const w of fixtureWorkflows) console.error(`  "${w.title}" (${w.file})`);

  if (!apply) {
    console.log(JSON.stringify({ epUpdates, titleUpdates, fixtureWorkflows }, null, 1));
    console.error('(dry run — pass --apply to write)');
  } else {
    for (const u of epUpdates) await query(`UPDATE entrypoints SET route_path = $1 WHERE id = $2`, [u.to, u.id]);
    for (const u of titleUpdates) await query(`UPDATE workflows SET title = $1 WHERE id = $2`, [u.to, u.id]);
    for (const w of fixtureWorkflows) await query(`DELETE FROM workflows WHERE id = $1`, [w.id]);
    console.error('Applied.');
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
