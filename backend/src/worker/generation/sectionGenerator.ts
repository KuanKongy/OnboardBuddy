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
import {
  markUnverifiedClaims,
  rewriteInlineCitations,
  type RewriteResult,
  type UnverifiedMarkResult,
} from './citationMarkers.js';
import { lintVoice } from './voiceLint.js';

export const SECTION_PROMPT_VERSION = 'section-v4';

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

  // Receipts get short aliases (r1, r2, …) in the prompt — small models
  // mangle raw UUIDs, which used to surface as "unknown receipt id" hard
  // failures and dropped citations. Aliases map back to UUIDs before
  // validation; unknown aliases stay unknown for the validator to count.
  const aliasToId = new Map<string, string>();
  bundle.receipts.forEach((r, i) => aliasToId.set(`r${i + 1}`, r.receiptId));

  // Structured call + inline validation with one stricter retry. Voice lint
  // shares the retry: marketing filler is a quality failure the same way an
  // uncited claim is.
  let { output, runId } = await callModel(params, bundle, null, aliasToId);
  let validation = await validateGeneratedOutput({ bundle, output, snapshotId: params.snapshotId });
  let voice = lintVoice(output.contentMarkdown ?? '');
  let retried = false;
  if (validation.hardFailure || voice.issues.length > 0) {
    retried = true;
    const stricter = await callModel(params, bundle, [...validation.issues, ...voice.issues], aliasToId);
    output = stricter.output;
    runId = stricter.runId;
    validation = await validateGeneratedOutput({ bundle, output, snapshotId: params.snapshotId });
    voice = lintVoice(output.contentMarkdown ?? '');
  }

  // Prose aliases become inline [[receipt:<uuid>]] markers for persisted
  // receipts; the rest are stripped — never ship labels the reader can't
  // resolve.
  const inline = rewriteInlineCitations(
    output.contentMarkdown ?? '',
    aliasToId,
    new Set(validation.usedReceiptIds),
  );
  // Claims downgraded for citing nothing get flagged AT the claim, not only
  // in the Known Gaps footer — the reader sees "unverified" at the point of
  // doubt.
  const unverified = markUnverifiedClaims(
    inline.content,
    validation.adjustedClaims
      .filter((c) => c.confidence === 'low' && c.receiptIds.length === 0)
      .map((c) => c.claim),
  );
  output = { ...output, contentMarkdown: unverified.content };

  const diagrams = spec.diagrams ? await spec.diagrams(params.deps) : [];

  const sectionId = await persistSection(
    params, bundle, output, validation, diagrams, runId, retried, inline, unverified, voice.hits,
  );
  return { sectionId, validation, retried, runId };
}

async function callModel(
  params: GenerateSectionParams,
  bundle: EvidenceBundleV2,
  previousIssues: string[] | null,
  aliasToId: Map<string, string>,
): Promise<{ output: GeneratedOutput; runId: string | null }> {
  const prompt = renderPrompt(params, bundle, previousIssues, aliasToId);
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
  const raw = response.value!;
  const translate = (id: string) => aliasToId.get(id.trim()) ?? id;
  const output: GeneratedOutput = {
    ...raw,
    usedReceiptIds: (raw.usedReceiptIds ?? []).map(translate),
    claims: (raw.claims ?? []).map((c) => ({ ...c, receiptIds: (c.receiptIds ?? []).map(translate) })),
  };
  return { output, runId: response.runId };
}

function renderPrompt(
  params: GenerateSectionParams,
  bundle: EvidenceBundleV2,
  previousIssues: string[] | null,
  aliasToId: Map<string, string>,
): string {
  const spec = SECTION_SPECS[params.sectionType];
  const idToAlias = new Map([...aliasToId.entries()].map(([a, id]) => [id, a]));
  const records = bundle.semanticContext.map(
    (r) => `- [${r.recordLevel}] ${r.stableKey} (confidence ${r.confidence}): ${r.summary.slice(0, 280)}`,
  );
  const receipts = bundle.receipts.map((r) => {
    const where = [r.filePath ?? r.nodeStableKey, r.lineStart ? `L${r.lineStart}-${r.lineEnd}` : null].filter(Boolean).join(' ');
    const snippet = r.snippet ? `\n  ${r.snippet.slice(0, 500).replace(/\n/g, '\n  ')}` : '';
    return `- receipt ${idToAlias.get(r.receiptId) ?? r.receiptId} [${r.receiptKind}, trust=${r.trustLevel}] ${where}${snippet}`;
  });
  return [
    `You are writing the "${params.sectionType}" onboarding section for a ${params.role} developer joining ${bundle.repo.owner}/${bundle.repo.name} (scope: ${bundle.scope.displayName}).`,
    spec.instructions.replace(/\bROLE\b/g, params.role),
    'Output rules: use ONLY the provided evidence; cite receipt ids (the exact short ids below, e.g. "r3") in claims and usedReceiptIds for every substantive claim; when citing inside contentMarkdown use the same short ids in parentheses, e.g. "(r3)"; code receipts win over docs; state unknowns explicitly instead of guessing; contentMarkdown uses headers/bullets/`code` formatting. Internal identifiers (wf:…, cluster:…, docnode:…) are pipeline bookkeeping — never print them; use the human name or path they refer to.',
    'Voice: flat, declarative engineering prose for a skeptical senior engineer. FORBIDDEN: marketing adjectives (crucial, essential, seamless, vital, powerful, robust, comprehensive), "enhances user …", "user satisfaction/engagement/retention", invented consequences ("could lead to user frustration", "poor first impression"), and restating a name as its own purpose ("DELETE /x enables deletion of x"). Every sentence must state a fact from the evidence, a number from the deterministic facts, or an explicit unknown. Numbers (counts, totals) must come verbatim from the deterministic facts — never derive or estimate your own.',
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
  inline: RewriteResult,
  unverified: UnverifiedMarkResult,
  voiceHits: string[],
): Promise<string> {
  const generationContext = {
    prompt_version: SECTION_PROMPT_VERSION,
    views: SECTION_SPECS[params.sectionType].views,
    retrieval: bundle.deterministicContext.retrievalStats ?? null,
    validation: { issues: validation.issues, retried, hardFailure: validation.hardFailure },
    claims: validation.adjustedClaims,
    inline_citations: {
      resolved: inline.resolved.length,
      dropped: inline.dropped,
      unverified_marked: unverified.marked,
      unverified_unmatched: unverified.unmatched,
    },
    voice_lint: { remaining_hits: voiceHits },
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
  // Each copy carries the claim text it supports so the receipt viewer can
  // answer "what does this citation prove?" without spelunking context.
  const claimByReceiptId = new Map<string, string>();
  for (const claim of validation.adjustedClaims) {
    for (const id of claim.receiptIds) {
      if (!claimByReceiptId.has(id)) claimByReceiptId.set(id, claim.claim);
    }
  }
  const used = new Set(validation.usedReceiptIds);
  for (const receipt of bundle.receipts) {
    if (!used.has(receipt.receiptId)) continue;
    await query(
      `INSERT INTO source_receipts
         (project_id, snapshot_id, receipt_kind, trust_level, section_id, node_stable_key,
          file_path, symbol_name, line_start, line_end, snippet, detection_expression,
          referenced_record_id, commit_hash, claim, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [params.projectId, params.snapshotId, receipt.receiptKind, receipt.trustLevel,
       sectionRow.id, receipt.nodeStableKey ?? null, receipt.filePath ?? null,
       receipt.symbolName ?? null, receipt.lineStart ?? null, receipt.lineEnd ?? null,
       receipt.snippet ?? null, receipt.detectionExpression ?? null,
       receipt.referencedRecordId ?? null, params.commitHash,
       claimByReceiptId.get(receipt.receiptId) ?? null,
       JSON.stringify({
         copiedFromReceiptId: receipt.receiptId,
         ...(receipt.truncatedFromLineEnd != null
           ? { truncatedFromLineEnd: receipt.truncatedFromLineEnd }
           : {}),
       })],
    );
  }
  return sectionRow.id;
}
