/**
 * Read-only latency/cost report for one analysis snapshot (latency
 * overhaul verification). Prints per-phase wall-clock from snapshot_phases
 * and per-call rollups from ai_generation_runs.
 *
 * Usage (inside a backend container, which has pg + DATABASE_URL):
 *   node scripts/latency-report.cjs <snapshot_id> [since_minutes]
 */
const { Pool } = require('pg');

const snapshotId = process.argv[2];
const sinceMinutes = Number(process.argv[3] ?? 0);
if (!snapshotId) {
  console.error('usage: node scripts/latency-report.cjs <snapshot_id> [since_minutes]');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const phases = (await pool.query(
    `SELECT phase, status,
            round(EXTRACT(EPOCH FROM (finished_at - started_at))::numeric, 1) AS seconds,
            metrics
     FROM snapshot_phases
     WHERE snapshot_id = $1
     ORDER BY started_at NULLS LAST`,
    [snapshotId],
  )).rows;
  console.log('── per-phase wall-clock ──');
  let total = 0;
  for (const p of phases) {
    total += Number(p.seconds ?? 0);
    console.log(
      `${String(p.phase).padEnd(18)} ${String(p.status).padEnd(9)} ${String(p.seconds ?? '—').padStart(8)}s  ${JSON.stringify(p.metrics)}`,
    );
  }
  console.log(`phase-seconds total: ${Math.round(total)}s`);

  const windowClause = sinceMinutes > 0 ? `AND created_at > now() - interval '${sinceMinutes} minutes'` : '';
  const calls = (await pool.query(
    `SELECT target_type, model_tier, model, status, count(*)::int AS calls,
            COALESCE(sum((token_usage->>'inputTokens')::bigint), 0)::bigint AS input_tokens,
            COALESCE(sum((token_usage->>'outputTokens')::bigint), 0)::bigint AS output_tokens,
            round(avg(latency_ms))::int AS avg_latency_ms,
            round(COALESCE(sum(estimated_cost_usd), 0)::numeric, 4) AS cost_usd
     FROM ai_generation_runs
     WHERE snapshot_id = $1 ${windowClause}
     GROUP BY 1, 2, 3, 4
     ORDER BY cost_usd DESC`,
    [snapshotId],
  )).rows;
  console.log('\n── per-call rollup ──');
  let totalCalls = 0;
  let totalCost = 0;
  for (const c of calls) {
    totalCalls += c.status === 'complete' ? Number(c.calls) : 0;
    totalCost += Number(c.cost_usd);
    console.log(
      `${String(c.target_type).padEnd(18)} ${String(c.model_tier ?? '—').padEnd(9)} ${String(c.status).padEnd(14)} ${String(c.calls).padStart(4)} calls  ${String(c.input_tokens).padStart(9)} in / ${String(c.output_tokens).padStart(8)} out  avg ${String(c.avg_latency_ms ?? '—').padStart(6)}ms  $${c.cost_usd}  ${c.model}`,
    );
  }
  console.log(`complete calls: ${totalCalls} · total cost: $${totalCost.toFixed(4)}`);
  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
