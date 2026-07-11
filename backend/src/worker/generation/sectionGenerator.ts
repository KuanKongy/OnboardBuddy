/**
 * Section generator (doc/Pipeline.md "Generation"): one section per call —
 * deterministic query + semantic retrieval -> evidence bundle -> strong
 * tier structured output -> inline citation validation (one stricter
 * retry on hard failure) -> deterministic diagrams -> persisted
 * package_sections row with section-owned receipts and full
 * generation_context. Everything starts as draft.
 */

import { query } from '../../lib/db.js';
import type { AiClient } from '../ai/aiClient.js';
import { retrieve, type EvidenceBundleV2 } from '../../retrieval/retrievalService.js';
import type { DeveloperRole } from '../semantic/projections.js';
import { SECTION_SPECS, SECTION_TITLES, type SectionType, type SectionDeps } from './sectionSpecs.js';
import { validateGeneratedOutput, type GeneratedOutput, type ValidationOutcome } from './citationValidator.js';

export const SECTION_PROMPT_VERSION = 'section-v2';

const SECTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'contentMarkdown', 'confidence', 'claims', 'usedReceiptIds', 'unknowns'],
  properties: {
    title: { type: 'string' },
    contentMarkdown: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'receiptIds', 'confidence'],
        properties: {
          claim: { type: 'string' },
          receiptIds: { type: 'array', items: { type: 'string' } },
          confidence: { enum: ['high', 'medium', 'low'] },
        },
      },
    },
    usedReceiptIds: { type: 'array', items: { type: 'string' } },
    unknowns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'detail'],
        properties: { kind: { type: 'string' }, detail: { type: ['string', 'null'] } },
      },
    },
  },
};

export interface GenerateSectionParams {
  ai: AiClient;
  snapshotId: string;
  projectId: string;
  packageId: string;
  role: DeveloperRole;
  sectionType: SectionType;
  privacyMode: 'full_ai' | 'facts_only_ai';
  commitHash: string;
  deps: SectionDeps;
  /** Injectable for tests; passed through to the retrieval service. */
  embedQuery?: (text: string) => Promise<number[]>;
}

export interface GenerateSectionResult {
  sectionId: string;
  validation: ValidationOutcome;
  retried: boolean;
  runId: string | null;
}

export async function generateSection(params: GenerateSectionParams): Promise<GenerateSectionResult> {
  const spec = SECTION_SPECS[params.sectionType];
  const deterministicContext = await spec.deterministic(params.deps);
  const bundle = await retrieve({
    snapshotId: params.snapshotId,
    projectId: params.projectId,
    task: spec.retrievalTask(params.role),
    privacyMode: params.privacyMode,
    views: spec.views,
    role: params.role,
    sectionType: params.sectionType,
    deterministicContext,
    embedQuery: params.embedQuery,
  });

  // Strong-tier structured call + inline validation with one stricter retry.
  let { output, runId } = await callModel(params, bundle, null);
  let validation = await validateGeneratedOutput({ bundle, output, snapshotId: params.snapshotId });
  let retried = false;
  if (validation.hardFailure) {
    retried = true;
    const stricter = await callModel(params, bundle, validation.issues);
    output = stricter.output;
    runId = stricter.runId;
    validation = await validateGeneratedOutput({ bundle, output, snapshotId: params.snapshotId });
  }

  const diagrams = spec.diagrams ? await spec.diagrams(params.deps) : [];

  const sectionId = await persistSection(params, bundle, output, validation, diagrams, runId, retried);
  return { sectionId, validation, retried, runId };
}

async function callModel(
  params: GenerateSectionParams,
  bundle: EvidenceBundleV2,
  previousIssues: string[] | null,
): Promise<{ output: GeneratedOutput; runId: string | null }> {
  const prompt = renderPrompt(params, bundle, previousIssues);
  const response = await params.ai.call<GeneratedOutput>({
    tier: 'strong',
    targetType: 'section',
    sectionType: params.sectionType,
    packageId: params.packageId,
    promptVersion: SECTION_PROMPT_VERSION,
    schemaName: 'onboarding_section_v2',
    schema: SECTION_OUTPUT_SCHEMA,
    user: prompt,
  });
  return { output: response.value!, runId: response.runId };
}

function renderPrompt(params: GenerateSectionParams, bundle: EvidenceBundleV2, previousIssues: string[] | null): string {
  const spec = SECTION_SPECS[params.sectionType];
  const records = bundle.semanticContext.map(
    (r) => `- [${r.recordLevel}] ${r.stableKey} (confidence ${r.confidence}): ${r.summary.slice(0, 280)}`,
  );
  const receipts = bundle.receipts.map((r) => {
    const where = [r.filePath ?? r.nodeStableKey, r.lineStart ? `L${r.lineStart}-${r.lineEnd}` : null].filter(Boolean).join(' ');
    const snippet = r.snippet ? `\n  ${r.snippet.slice(0, 500).replace(/\n/g, '\n  ')}` : '';
    return `- receipt ${r.receiptId} [${r.receiptKind}, trust=${r.trustLevel}] ${where}${snippet}`;
  });
  return [
    `You are writing the "${params.sectionType}" onboarding section for a ${params.role} developer joining ${bundle.repo.owner}/${bundle.repo.name} (scope: ${bundle.scope.displayName}).`,
    spec.instructions.replace(/\bROLE\b/g, params.role),
    'Output rules: use ONLY the provided evidence; cite receipt ids (the exact UUIDs below) in claims and usedReceiptIds for every substantive claim; code receipts win over docs; state unknowns explicitly instead of guessing; contentMarkdown uses headers/bullets/`code` formatting.',
    previousIssues && previousIssues.length > 0
      ? `Your previous attempt FAILED validation. Fix these problems and cite only receipt ids that exist below:\n- ${previousIssues.join('\n- ')}`
      : null,
    `Deterministic facts (authoritative):\n${JSON.stringify(bundle.deterministicContext).slice(0, 8000)}`,
    `Semantic records:\n${records.join('\n') || '(none)'}`,
    `Receipts (cite by id):\n${receipts.join('\n') || '(none)'}`,
    bundle.unknowns.length > 0 ? `Known gaps: ${JSON.stringify(bundle.unknowns)}` : null,
  ].filter(Boolean).join('\n\n');
}

async function persistSection(
  params: GenerateSectionParams,
  bundle: EvidenceBundleV2,
  output: GeneratedOutput,
  validation: ValidationOutcome,
  diagrams: Array<{ kind: string; mermaid: string }>,
  runId: string | null,
  retried: boolean,
): Promise<string> {
  const generationContext = {
    prompt_version: SECTION_PROMPT_VERSION,
    views: SECTION_SPECS[params.sectionType].views,
    retrieval: bundle.deterministicContext.retrievalStats ?? null,
    validation: { issues: validation.issues, retried, hardFailure: validation.hardFailure },
    claims: validation.adjustedClaims,
  };

  // Replace the previous version of this section; generation runs stay for audit.
  await query(`DELETE FROM package_sections WHERE package_id = $1 AND type = $2`, [params.packageId, params.sectionType]);
  const sectionRow = (await query(
    `INSERT INTO package_sections
       (package_id, snapshot_id, generation_run_id, type, title, content, diagrams,
        confidence, review_status, analyzed_commit, role, unknowns, generation_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12)
     RETURNING id`,
    [params.packageId, params.snapshotId, runId, params.sectionType,
     SECTION_TITLES[params.sectionType] ?? output.title ?? params.sectionType, output.contentMarkdown ?? '',
     JSON.stringify(diagrams), validation.confidence, params.commitHash, params.role,
     JSON.stringify(validation.unknowns), JSON.stringify(generationContext)],
  )).rows[0] as { id: string };

  // Section-owned receipt copies for the receipts actually used — the API
  // serves receipts by section_id, and staleness tracking follows them.
  const used = new Set(validation.usedReceiptIds);
  for (const receipt of bundle.receipts) {
    if (!used.has(receipt.receiptId)) continue;
    await query(
      `INSERT INTO source_receipts
         (project_id, snapshot_id, receipt_kind, trust_level, section_id, node_stable_key,
          file_path, symbol_name, line_start, line_end, snippet, detection_expression,
          referenced_record_id, commit_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [params.projectId, params.snapshotId, receipt.receiptKind, receipt.trustLevel,
       sectionRow.id, receipt.nodeStableKey ?? null, receipt.filePath ?? null,
       receipt.symbolName ?? null, receipt.lineStart ?? null, receipt.lineEnd ?? null,
       receipt.snippet ?? null, receipt.detectionExpression ?? null,
       receipt.referencedRecordId ?? null, params.commitHash,
       JSON.stringify({ copiedFromReceiptId: receipt.receiptId })],
    );
  }
  return sectionRow.id;
}
