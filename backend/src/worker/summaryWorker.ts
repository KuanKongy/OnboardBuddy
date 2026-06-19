import { Worker, Job } from 'bullmq';
import type { PoolClient } from 'pg';
import { SUMMARY_QUEUE, connection } from '../lib/queue.js';
import type { SummaryJobData } from '../lib/queue.js';
import { query, pool } from '../lib/db.js';
import { chatCompletion, SUMMARY_MODEL } from '../lib/openrouter.js';

// ── Types ────────────────────────────────────────────────────────────────────

const SECTION_TYPES = [
  'start_here',
  'entry_points',
  'critical_25',
  'workflow_guide',
  'data_schema',
  'safety_rails',
  'architecture',
  'dependency_graph',
  'doc_health',
] as const;

type SectionType = typeof SECTION_TYPES[number];

interface SnapRow {
  commit_hash: string;
  branch: string;
  file_count: number;
  symbol_count: number;
  workflow_count: number;
  repo_owner: string;
  repo_name: string;
  role: string;
}

interface NodeRow {
  id: string;
  stable_key: string;
  type: string;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  hash: string;
  import_count: number;
  metadata: { exportedSymbols?: string[]; importCount?: number };
  exported_symbols: string[];
}

interface EdgeRow {
  source_key: string;
  target_key: string;
  type: string;
}

interface WorkflowRow {
  id: string;
  title: string;
  trigger_type: string;
  purpose: string;
  importance_score: number;
  confidence: string;
  composite_score: number;
  ranking_reasons: string[];
  steps: Array<{
    step_order: number;
    file_path: string;
    symbol_name: string | null;
    line_start: number | null;
    line_end: number | null;
    explanation: string | null;
  }>;
}

interface AiSectionResponse {
  title: string;
  content: string;
  confidence: 'high' | 'medium' | 'low';
  sources: Array<{
    stable_key: string;
    file_path: string;
    symbol_name?: string;
    snippet?: string;
  }>;
}

interface EvidenceBundle {
  snap: SnapRow;
  nodes: NodeRow[];
  edges: EdgeRow[];
  workflows: WorkflowRow[];
  nodeIndex: Map<string, NodeRow>;
}

// ── Evidence bundle ──────────────────────────────────────────────────────────

async function buildEvidenceBundle(snapshotId: string): Promise<EvidenceBundle> {
  const empty = { rows: [] };
  const [snapRes, nodesRes, edgesRes, workflowsRes] = await Promise.all([
    query(
      `SELECT s.commit_hash, s.branch, s.file_count, s.symbol_count, s.workflow_count,
              p.repo_owner, p.repo_name,
              COALESCE(ps.default_developer_role, 'general') AS role
       FROM analysis_snapshots s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN project_settings ps ON ps.project_id = s.project_id
       WHERE s.id = $1`,
      [snapshotId],
    ),
    query(
      `SELECT n.id, n.stable_key, n.type, n.name, n.file_path, n.line_start, n.line_end, n.hash,
              COALESCE((n.metadata->>'importCount')::int, 0) AS import_count,
              n.metadata
       FROM graph_nodes n
       WHERE n.snapshot_id = $1
       ORDER BY (n.metadata->>'importCount')::int DESC NULLS LAST
       LIMIT 30`,
      [snapshotId],
    ).catch(() => empty),
    query(
      `SELECT sn.stable_key AS source_key, tn.stable_key AS target_key, e.type
       FROM graph_edges e
       JOIN graph_nodes sn ON sn.id = e.source_node_id
       JOIN graph_nodes tn ON tn.id = e.target_node_id
       WHERE e.snapshot_id = $1
       LIMIT 50`,
      [snapshotId],
    ).catch(() => empty),
    query(
      `SELECT w.id, w.title, w.trigger_type, w.purpose, w.importance_score, w.confidence,
              COALESCE(ws.composite_score, 0) AS composite_score,
              COALESCE(ws.ranking_reasons, '{}'::text[]) AS ranking_reasons
       FROM workflows w
       LEFT JOIN workflow_scores ws ON ws.workflow_id = w.id
       WHERE w.snapshot_id = $1
       ORDER BY COALESCE(ws.composite_score, 0) DESC
       LIMIT 10`,
      [snapshotId],
    ).catch(() => empty),
  ]);

  const snap = snapRes.rows[0] as SnapRow | undefined;
  if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

  const nodes = ((nodesRes.rows ?? []) as Omit<NodeRow, 'exported_symbols'>[]).map((n) => ({
    ...n,
    exported_symbols: Array.isArray(n.metadata?.exportedSymbols) ? n.metadata.exportedSymbols : [],
  })) as NodeRow[];

  const edges = (edgesRes.rows ?? []) as EdgeRow[];

  const workflows: WorkflowRow[] = [];
  for (const wf of (workflowsRes.rows ?? []) as Omit<WorkflowRow, 'steps'>[]) {
    const stepsRes = await query(
      `SELECT step_order, file_path, symbol_name, line_start, line_end, explanation
       FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_order`,
      [wf.id],
    ).catch(() => ({ rows: [] }));
    workflows.push({ ...wf, steps: stepsRes.rows as WorkflowRow['steps'] });
  }

  const nodeIndex = new Map<string, NodeRow>();
  for (const n of nodes) {
    nodeIndex.set(n.stable_key, n);
    nodeIndex.set(n.file_path, n);
  }

  return { snap, nodes, edges, workflows, nodeIndex };
}

// ── Per-section prompts ──────────────────────────────────────────────────────

function buildContext(bundle: EvidenceBundle): string {
  const { snap, nodes, edges, workflows } = bundle;

  const nodesList = nodes.slice(0, 20)
    .map((n) => `  ${n.file_path} [${n.type}] imports:${n.import_count} exports:[${n.exported_symbols.slice(0, 5).join(',')}]`)
    .join('\n') || '  (none)';

  const edgesList = edges.slice(0, 30)
    .map((e) => `  ${e.source_key} -[${e.type}]-> ${e.target_key}`)
    .join('\n') || '  (none)';

  const workflowsList = workflows.length > 0
    ? workflows.map((w) =>
        `  [${w.trigger_type}] "${w.title}" — ${w.purpose} (score:${w.composite_score})\n` +
        w.steps.map((s) => `    ${s.step_order}. ${s.file_path}${s.symbol_name ? `::${s.symbol_name}` : ''}`).join('\n'),
      ).join('\n\n')
    : '  (none detected)';

  return `Repository: ${snap.repo_owner}/${snap.repo_name} (branch: ${snap.branch}, commit: ${snap.commit_hash.slice(0, 8)})
Stats: ${snap.file_count} files, ${snap.symbol_count} symbols, ${snap.workflow_count} CI workflows
Role: ${snap.role}

TOP MODULES:
${nodesList}

DEPENDENCY EDGES:
${edgesList}

WORKFLOWS:
${workflowsList}`;
}

const SECTION_INSTRUCTIONS: Record<SectionType, string> = {
  start_here: 'Write 2-3 sentences: what this codebase does and where a new developer should start reading. Be direct and specific.',
  entry_points: 'List the 5-10 most important files/symbols a new developer in this role must understand first. For each, one sentence on why it matters.',
  critical_25: 'Identify the ~25% of files that deliver ~80% of the value. List each with a one-line explanation of its role. Focus on files with high import counts.',
  workflow_guide: 'Describe the key end-to-end request/data flows through the system. Trace how a request enters, gets processed, and exits. Reference specific files.',
  data_schema: 'Describe the key data models, types, and schemas. What are the core entities and how do they relate? Reference specific files/types.',
  safety_rails: 'What should a new developer NOT touch without deep understanding? Identify fragile areas, critical shared modules, or common gotchas from the structure.',
  architecture: 'Describe the overall architecture: layers, patterns, conventions, and how the codebase is organized. 3-5 paragraphs.',
  dependency_graph: 'Summarize the key dependency relationships. Which modules are most central? What depends on what? Identify potential coupling risks.',
  doc_health: 'Assess documentation coverage based on what can be inferred from the structure. What appears well-structured vs. potentially underdocumented?',
};

function buildSectionPrompt(sectionType: SectionType, context: string): string {
  return `You are writing onboarding documentation for a new developer.

${context}

---

Generate the "${sectionType}" section.

Task: ${SECTION_INSTRUCTIONS[sectionType]}

Respond with a JSON object in this exact shape (no markdown fences):
{
  "title": "<short descriptive title for this section>",
  "content": "<markdown content>",
  "confidence": "<high|medium|low — high if clearly evidenced, medium if inferred, low if speculative>",
  "sources": [
    {
      "stable_key": "<exact file path from the data above>",
      "file_path": "<same as stable_key>",
      "symbol_name": "<optional>",
      "snippet": "<1-2 line hint optional>"
    }
  ]
}

Rules:
- Only reference file paths that appear in the data above
- At least 1 source required
- Return ONLY the JSON object`;
}

// ── Generate one section ─────────────────────────────────────────────────────

async function generateSection(
  sectionType: SectionType,
  context: string,
): Promise<AiSectionResponse> {
  const prompt = buildSectionPrompt(sectionType, context);
  const raw = await chatCompletion([{ role: 'user', content: prompt }]);
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  try {
    return JSON.parse(cleaned) as AiSectionResponse;
  } catch {
    return {
      title: sectionType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      content: cleaned,
      confidence: 'low',
      sources: [],
    };
  }
}

// ── Persist one section ──────────────────────────────────────────────────────

async function persistSection(params: {
  client: PoolClient;
  packageId: string;
  snapshotId: string;
  sectionType: SectionType;
  section: AiSectionResponse;
  snap: SnapRow;
  nodeIndex: Map<string, NodeRow>;
}): Promise<void> {
  const { client, packageId, snapshotId, sectionType, section, snap, nodeIndex } = params;

  const validConf = ['high', 'medium', 'low'].includes(section.confidence) ? section.confidence : 'low';
  const sourceStableKeys = (section.sources ?? []).map((s) => s.stable_key);

  const genContext = {
    model: SUMMARY_MODEL,
    node_stable_keys: sourceStableKeys,
    file_count: snap.file_count,
  };

  const secRes = await client.query<{ id: string }>(
    `INSERT INTO package_sections
       (package_id, snapshot_id, type, title, content, confidence,
        review_status, analyzed_commit, role, generation_context)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9)
     RETURNING id`,
    [
      packageId, snapshotId, sectionType,
      section.title || sectionType, section.content || '',
      validConf, snap.commit_hash, snap.role,
      JSON.stringify(genContext),
    ],
  );
  const sectionId = secRes.rows[0]!.id;

  for (const src of section.sources ?? []) {
    const node = nodeIndex.get(src.stable_key) ?? nodeIndex.get(src.file_path);
    await client.query(
      `INSERT INTO source_receipts
         (section_id, node_id, node_stable_key, node_hash, file_path, symbol_name, snippet, commit_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        sectionId,
        node?.id ?? null,
        src.stable_key,
        node?.hash ?? null,
        src.file_path,
        src.symbol_name ?? null,
        src.snippet ?? null,
        snap.commit_hash,
      ],
    );
  }
}

// ── Worker ───────────────────────────────────────────────────────────────────

async function processSummaryJob(job: Job<SummaryJobData>): Promise<void> {
  const { jobId, snapshotId, projectId, triggeredBy } = job.data;

  const updateJob = (status: string, step: string, pct: number, errorMsg?: string) => {
    const finishedAt = status === 'complete' || status === 'failed' ? new Date() : null;
    return query(
      `UPDATE analysis_jobs
       SET status = $1, current_step = $2, progress_pct = $3,
           started_at = COALESCE(started_at, NOW()),
           error_message = $4,
           finished_at = $6
       WHERE id = $5`,
      [status, step, pct, errorMsg ?? null, jobId, finishedAt],
    );
  };

  try {
    await updateJob('running', 'Building evidence bundle', 5);
    const bundle = await buildEvidenceBundle(snapshotId);
    const context = buildContext(bundle);

    await updateJob('running', 'Creating package', 8);
    const client = await pool.connect();
    let packageId: string;
    try {
      const pkgRes = await client.query<{ id: string }>(
        `INSERT INTO onboarding_packages
           (snapshot_id, project_id, role, status, generated_by, analyzed_commit)
         VALUES ($1, $2, $3, 'generating', $4, $5)
         ON CONFLICT (project_id, role, analyzed_commit) DO UPDATE
           SET snapshot_id = EXCLUDED.snapshot_id, status = 'generating', updated_at = NOW()
         RETURNING id`,
        [snapshotId, projectId, bundle.snap.role, triggeredBy, bundle.snap.commit_hash],
      );
      packageId = pkgRes.rows[0]!.id;

      await client.query(`DELETE FROM package_sections WHERE package_id = $1`, [packageId]);
    } finally {
      client.release();
    }

    const pctPerSection = Math.floor(82 / SECTION_TYPES.length);
    for (let i = 0; i < SECTION_TYPES.length; i++) {
      const sectionType = SECTION_TYPES[i]!;
      const pct = 10 + i * pctPerSection;
      await updateJob('running', `Generating: ${sectionType}`, pct);

      const section = await generateSection(sectionType, context);

      const sectionClient = await pool.connect();
      try {
        await persistSection({
          client: sectionClient,
          packageId,
          snapshotId,
          sectionType,
          section,
          snap: bundle.snap,
          nodeIndex: bundle.nodeIndex,
        });
      } finally {
        sectionClient.release();
      }
    }

    await query(
      `UPDATE onboarding_packages SET status = 'draft', updated_at = NOW() WHERE id = $1`,
      [packageId],
    );

    await updateJob('complete', 'Summary ready', 100);
    console.log(`[summary-worker] job ${job.id} complete — package=${packageId} sections=${SECTION_TYPES.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJob('failed', 'Failed', 0, message).catch(() => {});
    await query(
      `UPDATE onboarding_packages SET status = 'failed', updated_at = NOW()
       WHERE project_id = $1 AND analyzed_commit = (
         SELECT commit_hash FROM analysis_snapshots WHERE id = $2
       )`,
      [projectId, snapshotId],
    ).catch(() => {});
    console.error(`[summary-worker] job ${job.id} failed:`, message);
    throw err;
  }
}

export const summaryWorker = new Worker<SummaryJobData>(
  SUMMARY_QUEUE,
  processSummaryJob,
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  },
);

summaryWorker.on('completed', (job) => {
  console.log(`[summary-worker] completed job ${job.id}`);
});

summaryWorker.on('failed', (job, err) => {
  console.error(`[summary-worker] failed job ${job?.id}:`, err.message);
});

console.log(`[summary-worker] listening on queue "${SUMMARY_QUEUE}"`);
