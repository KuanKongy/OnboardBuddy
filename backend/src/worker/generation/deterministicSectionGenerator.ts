/**
 * Deterministic section generation for `ai_disabled` mode (doc/Pipeline.md
 * "Privacy modes": ai_disabled = no LLM calls at all; deterministic-only
 * outputs). Renders each section's deterministic query result — the same
 * facts the LLM would receive as authoritative context — into readable
 * markdown, with the section's deterministic Mermaid diagrams. No receipts
 * are invented and no interpretation is added; sections state plainly that
 * AI explanations are off.
 */

import { query } from '../../lib/db.js';
import { SECTION_SPECS, SECTION_TITLES, type SectionType, type SectionDeps } from './sectionSpecs.js';

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

  const body = renderContext(context);
  const hasFacts = body.trim().length > 0;
  const content = [
    '> **AI explanations are off** (privacy mode: `ai_disabled`). This section lists the deterministic facts extracted by the analysis pipeline — no language model was involved. Switch the AI & privacy setting and regenerate to get narrated sections.',
    hasFacts ? body : '_No deterministic evidence was extracted for this section._',
  ].join('\n\n');

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

  return { sectionId: row.id, confidence };
}

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
};

function renderContext(context: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    const rendered = renderValue(value);
    if (!rendered) continue;
    parts.push(`### ${LABELS[key] ?? humanize(key)}\n\n${rendered}`);
  }
  return parts.join('\n\n');
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
