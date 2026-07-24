/**
 * Deterministic section generation for `ai_disabled` mode (doc/Pipeline.md
 * "Privacy modes": ai_disabled = no LLM calls at all; deterministic-only
 * outputs). Renders each section's deterministic query result — the same
 * facts the LLM would receive as authoritative context — into readable
 * markdown, with the section's deterministic Mermaid diagrams AND the same
 * kind of source_receipts evidence the AI path attaches (built straight from
 * graph_nodes snippets, see deterministicReceipts.ts). No interpretation is
 * invented; sections state plainly that AI explanations are off.
 */

import { query } from '../../lib/db.js';
import { SECTION_SPECS, SECTION_TITLES, type SectionType, type SectionDeps } from './sectionSpecs.js';
import { collectSectionReceipts, insertSectionReceipts } from './deterministicReceipts.js';

export interface DeterministicSectionResult {
  sectionId: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function generateDeterministicSection(params: {
  snapshotId: string;
  packageId: string;
  role: string;
  sectionType: SectionType;
  commitHash: string;
  deps: SectionDeps;
}): Promise<DeterministicSectionResult> {
  const spec = SECTION_SPECS[params.sectionType];
  const context = await spec.deterministic(params.deps);
  const diagrams = spec.diagrams ? await spec.diagrams(params.deps) : [];

  // ai_disabled-only enrichments (derived groupings, honesty notes). These
  // never touch spec.deterministic, so the AI prompts are unchanged.
  const extras = DETERMINISTIC_EXTRAS[params.sectionType];
  const enriched = extras ? { ...context, ...(await extras(params.deps, context)) } : context;

  // A `note` is explanation, not evidence — it must not lift an empty
  // section's grade or hide the honest "nothing extracted" state.
  const { note: _note, ...facts } = enriched as Record<string, unknown> & { note?: string };
  // CONSULT backbones ARE the deterministic content — with AI off they ship
  // verbatim (the AI path splices the same tables at [[backbone]]).
  const backbone = spec.backbone ? await spec.backbone(params.deps) : '';
  const factsBody = renderContext(facts);
  const hasFacts = factsBody.trim().length > 0 || backbone.trim().length > 0;
  const body = [backbone, factsBody.trim().length > 0 ? renderContext(enriched) : '']
    .filter((s) => s.trim().length > 0).join('\n\n');
  const preamble = SECTION_PREAMBLES[params.sectionType];
  const content = [
    '> **AI explanations are off** for this project (privacy mode: `ai_disabled`). Everything below was extracted directly from the code by static analysis — file paths, line numbers, and the receipts behind each item are exact; there is simply no AI narration on top. Turn AI on in Settings → AI & privacy and regenerate to add explanations.',
    preamble,
    hasFacts ? body : '_No deterministic evidence was extracted for this section._',
  ].filter(Boolean).join('\n\n');

  // Deterministic facts come straight from parsed code (code-level trust),
  // but without narration/citations we grade presence, not interpretation.
  const confidence: 'high' | 'medium' | 'low' = hasFacts ? 'medium' : 'low';

  await query(`DELETE FROM package_sections WHERE package_id = $1 AND type = $2`, [params.packageId, params.sectionType]);
  const row = (await query(
    `INSERT INTO package_sections
       (package_id, snapshot_id, generation_run_id, type, title, content, diagrams,
        confidence, review_status, analyzed_commit, role, unknowns, generation_context)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11)
     RETURNING id`,
    [params.packageId, params.snapshotId, params.sectionType,
     SECTION_TITLES[params.sectionType] ?? params.sectionType, content,
     JSON.stringify(diagrams), confidence, params.commitHash, params.role,
     JSON.stringify([{ kind: 'ai_disabled', detail: 'Generated without LLM assistance' }]),
     JSON.stringify({ mode: 'deterministic', prompt_version: null })],
  )).rows[0] as { id: string };

  // The same evidence drill-down the AI path gets: section-owned receipt
  // copies built from graph-node snippets (the old DELETE above cascaded the
  // previous version's receipts).
  const receipts = await collectSectionReceipts(params.sectionType, params.deps);
  if (receipts.length > 0) {
    await insertSectionReceipts({
      projectId: params.deps.projectId,
      snapshotId: params.snapshotId,
      sectionId: row.id,
      commitHash: params.commitHash,
      rows: receipts,
    });
  }

  return { sectionId: row.id, confidence };
}

// ─── ai_disabled prose: how to read each section ─────────────────────────────

const SECTION_PREAMBLES: Partial<Record<SectionType, string>> = {
  big_picture: 'The topology diagram and counts below describe what the analyzer found: runtime services parsed from compose files, external services from env names (never values), and the product journeys traced through the code.',
  concepts: 'The recurring nouns of this codebase — schema tables, capabilities, clusters, journeys, and env configuration. With AI off, definitions cannot be written; the receipts open the code where each concept lives.',
  architecture_deep: 'Clusters are directory/dependency groupings computed from the import graph; "relationships" are real typed edges between them. The diagram is authoritative — it is drawn from the same data as this list.',
  traced_flows: 'Each journey below was traced through real call edges and queue boundaries — every step is an actual file/symbol on the path, in execution order. Nothing here is inferred.',
  code_map: 'The files that matter, grouped by subsystem. The reasons column says why each item was selected (fan-in, workflow participation, churn) — read those, not scores.',
  capabilities: 'What the product does, grouped by the code that delivers it. With AI off, capability names cannot be inferred — the groupings below are derived from traced workflows and architecture clusters.',
  setup_run: 'Run facts parsed from compose files, package scripts, and env templates. With AI off, the tutorial narration is absent — the commands and services listed are exact.',
  first_change: 'Candidate areas for a safe first change (moderate rank, visible tests) with the tests that guard them. With AI off, the exercise itself cannot be authored; the receipts point at the code.',
  common_tasks: 'Task patterns detected in this repo with real exemplar files to copy from. With AI off, the step-by-step recipes are absent; the exemplars are exact.',
  routes_jobs: 'Every HTTP route (full mounted paths), queue, job type, and webhook detected — grouped for lookup. The workflow column links a route to its traced flow.',
  data_model: 'Schema objects detected in migrations/models with their parsed foreign-key references, plus the code observed reading or writing each table.',
  guardrails_ops: 'Environment variables (names and documented purposes only — values are never analyzed), guardrail code found by name, and external integrations detected in the code.',
};

/** Extra deterministic context only for ai_disabled rendering. */
const DETERMINISTIC_EXTRAS: Partial<Record<SectionType, (deps: SectionDeps, context: Record<string, unknown>) => Promise<Record<string, unknown>>>> = {
  capabilities: async (deps, context) => {
    const caps = context.capabilities;
    if (Array.isArray(caps) && caps.length > 0) return {};
    const groups = (await query(
      `SELECT w.trigger_type, json_agg(json_build_object('title', w.title, 'purpose', w.purpose)) AS flows
       FROM workflows w WHERE w.snapshot_id = $1 GROUP BY w.trigger_type`,
      [deps.snapshotId],
    )).rows;
    return {
      derivedGroups: groups,
      note: 'Capability names are normally inferred by AI. With AI off, the groups above are derived from traced workflows by trigger type — the underlying flows and receipts are exact.',
    };
  },
};

// ─── Markdown rendering ──────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  snapshot: 'Snapshot', topClusters: 'Top architecture clusters', entrypoints: 'Entry points',
  topForRole: 'Most relevant for your role', clusters: 'Architecture clusters',
  clusterEdges: 'Cluster relationships', critical25: 'Critical 25% by category',
  capabilities: 'Capabilities', workflows: 'Workflows', roleOrdering: 'Role-ranked targets',
  tutorials: 'Tutorials', schemaNodes: 'Schema objects', dbSideEffects: 'Database access',
  riskySideEffects: 'Detected side effects', testFiles: 'Test files', configFiles: 'Config & migrations',
  centralNodes: 'Highest fan-in modules', edgeCounts: 'Edge types', docFiles: 'Documentation files',
  flaggedRecords: 'Flagged records', topUndocumented: 'Top undocumented targets',
  derivedGroups: 'Workflow groups (derived without AI)', startingEntrypoints: 'Where execution starts',
  note: 'Note',
};

function renderContext(context: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    // Entry-point rows read far better as a table than as dot-joined lines.
    const rendered = key === 'entrypoints' && isEntrypointRows(value)
      ? renderEntrypointTable(value)
      : renderValue(value);
    if (!rendered) continue;
    parts.push(`### ${LABELS[key] ?? humanize(key)}\n\n${rendered}`);
  }
  return parts.join('\n\n');
}

type EntrypointRow = {
  trigger_type?: unknown; method?: unknown; route_path?: unknown;
  file_path?: unknown; symbol?: unknown; workflow_title?: unknown;
};

function isEntrypointRows(value: unknown): value is EntrypointRow[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every((v) => v !== null && typeof v === 'object' && 'trigger_type' in (v as object));
}

function renderEntrypointTable(rows: EntrypointRow[]): string {
  const cell = (v: unknown) => (v == null ? '' : inline(v).replace(/\|/g, '\\|'));
  const lines = [
    '| Trigger | Method | Route | File | Symbol | Workflow |',
    '|---|---|---|---|---|---|',
    ...rows.slice(0, 25).map((r) =>
      `| ${cell(r.trigger_type)} | ${cell(r.method)} | ${r.route_path ? `\`${cell(r.route_path)}\`` : ''} | ${r.file_path ? `\`${cell(r.file_path)}\`` : ''} | ${cell(r.symbol)} | ${cell(r.workflow_title)} |`),
  ];
  return lines.join('\n');
}

function renderValue(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.slice(0, 25).map((item) => `- ${renderItem(item)}`).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v != null);
    if (entries.length === 0) return null;
    // critical25-style maps of lists get one sub-block per category.
    if (entries.every(([, v]) => Array.isArray(v))) {
      return entries
        .map(([k, v]) => {
          const list = renderValue(v);
          return list ? `**${humanize(k)}**\n${list}` : null;
        })
        .filter(Boolean)
        .join('\n\n');
    }
    return entries.map(([k, v]) => `- **${humanize(k)}**: ${renderItem(v)}`).join('\n');
  }
  return String(value);
}

/** One list row: prefer path/name/title-style fields, keep it single-line. */
function renderItem(item: unknown): string {
  if (item == null) return '';
  if (typeof item !== 'object') return inline(item);
  const obj = item as Record<string, unknown>;

  // Workflow rows carry nested steps — render the trace inline.
  if (typeof obj.title === 'string' && Array.isArray(obj.steps)) {
    const steps = (obj.steps as Array<Record<string, unknown>>)
      .slice(0, 12)
      .map((s) => `${s.symbol ?? s.file ?? ''}`)
      .filter(Boolean)
      .join(' → ');
    return `**${obj.title}**${obj.confidence ? ` _(confidence: ${inline(obj.confidence)})_` : ''}${steps ? ` — ${steps}` : ''}`;
  }

  const fields = Object.entries(obj)
    .filter(([, v]) => v != null && typeof v !== 'object')
    .slice(0, 6)
    .map(([k, v]) => {
      const text = inline(v);
      return /path|file|key|route/i.test(k) ? `\`${text}\`` : text;
    });
  return fields.join(' · ') || inline(JSON.stringify(obj).slice(0, 120));
}

function inline(v: unknown): string {
  return String(v).replace(/\s+/g, ' ').slice(0, 160);
}

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
