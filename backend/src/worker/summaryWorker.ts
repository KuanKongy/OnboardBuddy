import { Worker, Job } from 'bullmq';
import type { PoolClient } from 'pg';
import { SUMMARY_QUEUE, connection, getSummaryQueue } from '../lib/queue.js';
import type { SummaryJobData } from '../lib/queue.js';
import { query, pool } from '../lib/db.js';
import { chatCompletion, SUMMARY_MODEL } from '../lib/openrouter.js';
import { buildContext, DEFAULT_SECTION_REVIEW_STATUS, type EvidenceBundle } from './engine/evidenceContext.js';

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
  project_id: string;
  scope_id: string;
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

// ── Evidence bundle ──────────────────────────────────────────────────────────

async function buildEvidenceBundle(snapshotId: string): Promise<EvidenceBundle> {
  const empty = { rows: [] };
  const [snapRes, nodesRes, edgesRes, workflowsRes] = await Promise.all([
    query(
      `SELECT s.commit_hash, s.branch, s.file_count, s.symbol_count, s.workflow_count,
              s.project_id, s.scope_id,
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
       ORDER BY (n.metadata->>'importCount')::int DESC NULLS LAST`,
      [snapshotId],
    ).catch(() => empty),
    query(
      `SELECT sn.stable_key AS source_key, tn.stable_key AS target_key, e.type
       FROM graph_edges e
       JOIN graph_nodes sn ON sn.id = e.source_node_id
       JOIN graph_nodes tn ON tn.id = e.target_node_id
       WHERE e.snapshot_id = $1`,
      [snapshotId],
    ).catch(() => empty),
    query(
      `SELECT w.id, w.title, w.trigger_type, w.purpose, w.confidence,
              COALESCE((w.metadata->>'importance_score')::numeric, 0) AS importance_score,
              COALESCE(cs.score, (w.metadata->>'importance_score')::numeric, 0) AS composite_score,
              COALESCE(cs.reasons, '{}'::text[]) AS ranking_reasons
       FROM workflows w
       LEFT JOIN criticality_scores cs
         ON cs.snapshot_id = w.snapshot_id AND cs.phase = 'candidate' AND cs.view = 'candidate'
        AND cs.target_type = 'workflow' AND cs.stable_key = w.stable_key AND cs.role = 'general'
       WHERE w.snapshot_id = $1
       ORDER BY 7 DESC
       LIMIT 20`,
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

  // Fetch entrypoints, side effects, and critical rankings for richer context
  const [entrypointsRes, sideEffectsRes, rankingsRes] = await Promise.all([
    query(
      `SELECT e.trigger_type AS kind, e.method, e.route_path AS route_pattern, n.file_path, n.name
       FROM entrypoints e
       JOIN graph_nodes n ON n.id = e.node_id
       WHERE e.snapshot_id = $1
       ORDER BY e.trigger_type
       LIMIT 30`,
      [snapshotId],
    ).catch(() => empty),
    query(
      `SELECT s.type AS kind, s.target, n.file_path
       FROM side_effects s
       JOIN graph_nodes n ON n.id = s.node_id
       WHERE s.snapshot_id = $1
       LIMIT 20`,
      [snapshotId],
    ).catch(() => empty),
    query(
      `SELECT n.file_path, n.name, cs.score AS composite_score, cs.reasons AS ranking_reasons
       FROM criticality_scores cs
       JOIN graph_nodes n ON n.id = cs.target_node_id
       WHERE cs.snapshot_id = $1 AND cs.phase = 'candidate' AND cs.view = 'candidate'
         AND cs.role = 'general'
       ORDER BY cs.score DESC
       LIMIT 40`,
      [snapshotId],
    ).catch(() => empty),
  ]);

  const nodeIndex = new Map<string, NodeRow>();
  for (const n of nodes) {
    nodeIndex.set(n.stable_key, n);
    nodeIndex.set(n.file_path, n);
  }

  return {
    snap, nodes, edges, workflows, nodeIndex,
    entrypoints: entrypointsRes.rows as Array<{ kind: string; method: string | null; route_pattern: string | null; file_path: string; name: string }>,
    sideEffects: sideEffectsRes.rows as Array<{ kind: string; target: string | null; file_path: string }>,
    criticalRankings: (rankingsRes.rows ?? []) as EvidenceBundle['criticalRankings'],
  };
}

const SECTION_INSTRUCTIONS: Record<SectionType, string> = {
  start_here: `Write a focused orientation for a new developer joining this team. Include:
- What this system does in 2 sentences (business purpose, not tech stack)
- The 3-5 files they should read first and WHY (not just "important" — explain what understanding they unlock)
- A mental model: "Think of this codebase as..." that helps them reason about it
- Common first-day tasks and where to look
Target: 200-300 words. Be concrete — reference exact file paths from the data.`,

  entry_points: `List the 8-15 most important entry points a "${'{role}'}" developer must understand. For EACH entry point include:
- The exact file path and primary exported symbol
- What triggers it (HTTP request, cron, event, CLI command)
- What downstream systems it touches
- One sentence on its business purpose
Group them by category (API routes, background jobs, event handlers, etc). This is the "table of contents" for the codebase.`,

  critical_25: `Identify the critical ~25% of modules that deliver ~80% of the system's value. For EACH critical file include:
- File path and its role in one sentence
- Why it's critical: high fan-in? core business logic? single point of failure?
- What breaks if this file has a bug
- Related files that work with it
List at least 10-15 files. Sort by importance. Use the import counts and dependency edges provided to justify your choices.`,

  workflow_guide: `Document the 5-8 most important end-to-end workflows/request flows. For EACH workflow:
- Name it clearly (e.g., "User Registration Flow", "Payment Processing")
- Trace the full path: trigger → validation → business logic → persistence → response
- List each file touched in order with the key function/symbol
- Note side effects (DB writes, external API calls, events published)
- Call out error handling: what happens when it fails?
Use the workflow data provided. Reference specific file paths and symbols.`,

  data_schema: `Document the core data model and schemas. Include:
- Key entities/models and their relationships (1:many, many:many)
- Where schemas are defined (file paths)
- Important fields and their business meaning
- Data flow: where data is created, read, updated, deleted
- Any important constraints, validations, or invariants
- Database patterns used (transactions, soft deletes, audit trails)
Be thorough — a developer should understand the data layer after reading this.`,

  safety_rails: `Identify dangerous areas of the codebase that require extra caution. Include:
- Files/modules that should NEVER be modified without thorough review (and why)
- Common gotchas and mistakes new developers make
- Shared modules where a change ripples to many consumers
- Security-sensitive areas (auth, encryption, permissions)
- Performance-critical paths where naive changes cause outages
- Implicit contracts or assumptions in the code that aren't obvious
For each, explain the RISK: what goes wrong if someone makes a mistake here.`,

  architecture: `Provide a comprehensive architecture overview in 4-6 paragraphs covering:
1. High-level structure: layers, services, and their boundaries
2. Key patterns and conventions used (naming, file organization, module structure)
3. How data flows through the system end-to-end
4. Infrastructure and deployment model (as inferred from file structure)
5. Key architectural decisions and trade-offs visible in the structure
6. Where to look for different types of code (routes, business logic, data access, config)
Write for a developer who needs to understand the "big picture" before diving into specifics.`,

  dependency_graph: `Analyze the dependency structure and explain:
- The most central/connected modules (highest fan-in) and why they matter
- Key dependency chains: what depends on what, and the implications
- Potential coupling risks: circular dependencies, overly-connected modules
- Architectural boundaries visible in the dependency graph
- Modules that could be refactored or decoupled
- Import patterns: shared utilities, core libraries, domain modules
Reference specific file paths and their connection counts from the data above.`,

  doc_health: `Assess the project's documentation and knowledge capture:
- Which areas appear well-documented (config files, README patterns, structured code)
- Which areas are likely underdocumented (complex logic with no comments inferred from structure)
- Key files that should have documentation but might not
- Suggestions for documentation priorities based on the critical 25%
- Gaps between workflow complexity and available explanation
Be constructive — identify what's needed, not just what's missing.`,
};

function buildSectionPrompt(sectionType: SectionType, context: string): string {
  const instruction = SECTION_INSTRUCTIONS[sectionType].replace('{role}', 'this');

  return `You are an expert technical writer creating detailed onboarding documentation. Your goal is to help a new developer become productive quickly by understanding the critical 25% of the codebase that drives 80% of the value.

${context}

---

Generate the "${sectionType.replace(/_/g, ' ')}" section.

${instruction}

Respond with a JSON object in this exact shape (no markdown fences):
{
  "title": "<descriptive title for this section>",
  "content": "<detailed markdown content with headers, bullet points, and code references>",
  "confidence": "<high|medium|low — high if clearly evidenced by the graph data, medium if inferred from patterns, low if speculative>",
  "sources": [
    {
      "stable_key": "<exact file path from the data above>",
      "file_path": "<same as stable_key>",
      "symbol_name": "<optional: key function/class>",
      "snippet": "<optional: 1-2 line description of what this source proves>"
    }
  ]
}

Rules:
- Content should use markdown: headers (##, ###), bullet points, bold for emphasis, \`code\` for paths/symbols
- Be specific and actionable — reference exact file paths and symbol names from the data
- Minimum 3 sources required, aim for 5-10 for thorough sections
- Content length: aim for 300-600 words depending on section complexity
- Only reference file paths that appear in the data above
- Return ONLY the JSON object, no explanation`;
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
     VALUES ($1, $2, $3, $4, $5, $6, '${DEFAULT_SECTION_REVIEW_STATUS}', $7, $8, $9)
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
         (project_id, snapshot_id, receipt_kind, trust_level, section_id, node_id,
          node_stable_key, node_hash, file_path, symbol_name, snippet, commit_hash)
       VALUES ($1, $2, 'code_snippet', 'code', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        snap.project_id,
        snapshotId,
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

const ALL_ROLES = ['backend', 'frontend', 'devops', 'qa', 'general'] as const;

async function processSummaryJob(job: Job<SummaryJobData>): Promise<void> {
  const { jobId, snapshotId, projectId, triggeredBy, role: requestedRole } = job.data;

  const updateJob = (status: string, step: string, pct: number, errorMsg?: string) => {
    const finishedAt = status === 'complete' || status === 'failed' ? new Date() : null;
    return query(
      `UPDATE analysis_jobs
       SET status = $1, current_step = $2, progress_pct = $3,
           started_at = COALESCE(started_at, NOW()),
           error_message = $4,
           finished_at = $6,
           step_log = step_log || $7::jsonb
       WHERE id = $5`,
      [status, step, pct, errorMsg ?? null, jobId, finishedAt, JSON.stringify([{ step, pct, ts: new Date().toISOString() }])],
    );
  };

  try {
    await updateJob('running', 'Building evidence bundle', 5);
    const bundle = await buildEvidenceBundle(snapshotId);

    // Use requested role or default from project settings
    const primaryRole = requestedRole ?? bundle.snap.role;
    bundle.snap.role = primaryRole;
    const context = buildContext(bundle);

    await updateJob('running', 'Creating package', 8);
    const client = await pool.connect();
    let packageId: string;
    try {
      const pkgRes = await client.query<{ id: string }>(
        `INSERT INTO onboarding_packages
           (snapshot_id, project_id, scope_id, role, status, generated_by, analyzed_commit)
         VALUES ($1, $2, $3, $4, 'generating', $5, $6)
         ON CONFLICT (project_id, scope_id, role, analyzed_commit) DO UPDATE
           SET snapshot_id = EXCLUDED.snapshot_id, status = 'generating', updated_at = NOW()
         RETURNING id`,
        [snapshotId, projectId, bundle.snap.scope_id, bundle.snap.role, triggeredBy, bundle.snap.commit_hash],
      );
      packageId = pkgRes.rows[0]!.id;

      await client.query(`DELETE FROM package_sections WHERE package_id = $1`, [packageId]);
    } finally {
      client.release();
    }

    // Generate sections in parallel batches of 3 to reduce total time
    const BATCH_SIZE = 3;
    for (let batchStart = 0; batchStart < SECTION_TYPES.length; batchStart += BATCH_SIZE) {
      const batch = SECTION_TYPES.slice(batchStart, batchStart + BATCH_SIZE);
      const pct = 10 + Math.floor((batchStart / SECTION_TYPES.length) * 82);
      await updateJob('running', `Generating: ${batch.join(', ')}`, pct);

      const results = await Promise.all(
        batch.map((sectionType) => generateSection(sectionType, context)),
      );

      for (let j = 0; j < batch.length; j++) {
        const sectionClient = await pool.connect();
        try {
          await persistSection({
            client: sectionClient,
            packageId,
            snapshotId,
            sectionType: batch[j]!,
            section: results[j]!,
            snap: bundle.snap,
            nodeIndex: bundle.nodeIndex,
          });
        } finally {
          sectionClient.release();
        }
      }
    }

    // Enrich top workflows with LLM-generated step explanations
    if (bundle.workflows.length > 0) {
      await updateJob('running', 'Enriching workflow explanations', 93);
      const topWorkflows = bundle.workflows.slice(0, 10);
      for (const wf of topWorkflows) {
        if (!wf.steps || wf.steps.length === 0) continue;
        const stepsDescription = wf.steps
          .map((s) => `${s.step_order}. ${s.file_path}${s.symbol_name ? `::${s.symbol_name}` : ''} (${s.line_start ?? '?'}–${s.line_end ?? '?'})`)
          .join('\n');
        try {
          const prompt = `You are documenting a codebase workflow called "${wf.title}" (${wf.purpose}).
Here are the steps in order:
${stepsDescription}

For each step, write a concise 1-2 sentence explanation of what that step does from a developer's perspective. Return ONLY a JSON array of strings, one per step in order. No markdown fences.`;
          const raw = await chatCompletion([{ role: 'user', content: prompt }]);
          const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
          const explanations = JSON.parse(cleaned) as string[];
          for (let i = 0; i < Math.min(explanations.length, wf.steps.length); i++) {
            await query(
              `UPDATE workflow_steps SET explanation = $1
               WHERE workflow_id = $2 AND step_order = $3`,
              [explanations[i], wf.id, wf.steps[i]!.step_order],
            );
          }
        } catch (err) {
          console.warn(`[summaryWorker] Failed to enrich workflow ${wf.id}:`, err);
        }
      }
    }

    await query(
      `UPDATE onboarding_packages SET status = 'draft', updated_at = NOW() WHERE id = $1`,
      [packageId],
    );

    // NOTE: the old section-markdown embedding path (semantic_summaries +
    // evidence_embeddings) is deleted per doc/Pipeline.md; multi-view
    // embeddings over semantic_records replace it in the pipeline rework.

    // Enqueue generation for remaining roles (if this is the primary role job)
    if (!requestedRole) {
      const remainingRoles = ALL_ROLES.filter((r) => r !== primaryRole);
      for (const nextRole of remainingRoles) {
        const roleJobResult = await query(
          `INSERT INTO analysis_jobs (project_id, snapshot_id, requested_by, job_type, role, status, current_step)
           VALUES ($1, $2, $3, 'generate_package', $4, 'queued', 'Waiting for worker')
           RETURNING id`,
          [projectId, snapshotId, triggeredBy, nextRole],
        );
        const roleJobId = roleJobResult.rows[0]?.id;
        if (roleJobId) {
          await getSummaryQueue().add(`generate_summary_${nextRole}`, {
            jobId: roleJobId,
            snapshotId,
            projectId,
            triggeredBy,
            role: nextRole,
          } satisfies SummaryJobData, {
            attempts: 2,
            backoff: { type: 'fixed', delay: 3000 },
            removeOnComplete: { count: 10 },
            removeOnFail: { count: 10 },
          });
        }
      }
    }

    await updateJob('complete', 'Summary ready', 100);
    console.log(`[summary-worker] job ${job.id} complete — package=${packageId} (role=${primaryRole}) sections=${SECTION_TYPES.length}`);
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
    drainDelay: 5000,
    stalledInterval: 120_000,
    lockDuration: 600_000,
    removeOnComplete: { count: 5 },
    removeOnFail: { count: 5 },
  },
);

summaryWorker.on('completed', (job: Job<SummaryJobData>) => {
  console.log(`[summary-worker] completed job ${job.id}`);
});

summaryWorker.on('failed', (job: Job<SummaryJobData> | undefined, err: Error) => {
  console.error(`[summary-worker] failed job ${job?.id}:`, err.message);
});

console.log(`[summary-worker] listening on queue "${SUMMARY_QUEUE}"`);
