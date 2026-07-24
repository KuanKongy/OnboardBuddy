/**
 * Section generator (doc/Pipeline.md "Generation"): one section per call —
 * deterministic query + semantic retrieval -> evidence bundle -> strong
 * tier structured output -> inline citation validation (one stricter
 * retry on hard failure) -> deterministic diagrams -> persisted
 * package_sections row with section-owned receipts and full
 * generation_context. Everything starts as draft.
 */

import { createHash } from 'node:crypto';
import { query } from '../../lib/db.js';
import type { AiClient } from '../ai/aiClient.js';
import { retrieve, type EvidenceBundleV2 } from '../../retrieval/retrievalService.js';
import type { DeveloperRole } from '../semantic/projections.js';
import { SECTION_SPECS, SECTION_TITLES, type SectionType, type SectionDeps } from './sectionSpecs.js';
import { collectSectionReceipts } from './deterministicReceipts.js';
import { validateGeneratedOutput, type GeneratedOutput, type ValidationOutcome } from './citationValidator.js';
import {
  markUnverifiedClaims,
  rewriteInlineCitations,
  type RewriteResult,
  type UnverifiedMarkResult,
} from './citationMarkers.js';
import { lintVoice } from './voiceLint.js';

export const SECTION_PROMPT_VERSION = 'section-v5';

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
  /** True when the section was reused byte-identically from the cache. */
  cached?: boolean;
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

  // Deterministic receipts join the bundle: the section's own evidence rows
  // (journey step nodes, mapped files, config files) become citable — the
  // prose narrates deterministic facts, so the receipts must cover them or
  // every file mention validates as "cites no receipt from it".
  const detReceipts = await collectSectionReceipts(params.sectionType, params.deps);
  const seenKeys = new Set(bundle.receipts.map((r) => r.nodeStableKey ?? r.filePath ?? r.receiptId));
  let detIdx = 0;
  for (const det of detReceipts) {
    const key = det.nodeStableKey ?? det.filePath ?? '';
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    detIdx += 1;
    bundle.receipts.push({
      receiptId: `det-${detIdx}`,
      receiptKind: det.receiptKind,
      trustLevel: det.trustLevel,
      nodeStableKey: det.nodeStableKey ?? undefined,
      filePath: det.filePath ?? undefined,
      symbolName: det.symbolName ?? undefined,
      lineStart: det.lineStart ?? undefined,
      lineEnd: det.lineEnd ?? undefined,
      snippet: params.privacyMode === 'facts_only_ai' ? undefined : det.snippet ?? undefined,
    });
    if (detIdx >= 28) break;
  }

  // Section cache (plan step 5): key = the DETERMINISTIC inputs that shape
  // the output — spec prompt + mode, role, depth budget, deterministic
  // facts, and the spliced backbone. Retrieval (records/receipts) is
  // deliberately EXCLUDED: its top-K set wobbles run-to-run (measured: even
  // byte-stable data_model missed the cache on set churn alone), which
  // would turn the cache into a coin flip. Consequence, accepted and
  // documented: a section regenerates when its facts or the prompt change —
  // which is when re-analysis actually moved the ground truth — not when
  // similarity search reshuffles. Unchanged facts ⇒ byte-identical reuse at
  // zero LLM cost (the M4 stochasticity complaint, answered mechanically).
  const backboneMarkdown = spec.backbone ? await spec.backbone(params.deps) : null;
  const evidenceHash = createHash('sha256').update(JSON.stringify({
    v: SECTION_PROMPT_VERSION,
    type: params.sectionType,
    role: params.role,
    mode: spec.mode,
    budget: spec.outputBudget[params.deps.sizeClass],
    instructions: spec.instructions,
    deterministic: deterministicContext,
    backbone: backboneMarkdown,
  })).digest('hex');

  const cachedRow = (await query(
    `SELECT id, content, diagrams, confidence, unknowns
     FROM package_sections
     WHERE snapshot_id = $1 AND type = $2 AND role = $3
       AND generation_context->>'evidence_hash' = $4
       AND COALESCE(generation_context->'validation'->>'hardFailure', 'false') <> 'true'
     ORDER BY created_at DESC LIMIT 1`,
    [params.snapshotId, params.sectionType, params.role, evidenceHash],
  )).rows[0] as { id: string; content: string; diagrams: unknown; confidence: 'high' | 'medium' | 'low'; unknowns: unknown } | undefined;
  if (cachedRow) {
    const sectionId = await persistCachedSection(params, cachedRow, evidenceHash);
    return {
      sectionId,
      validation: {
        hardFailure: false, issues: [], adjustedClaims: [], usedReceiptIds: [],
        confidence: cachedRow.confidence,
        unknowns: Array.isArray(cachedRow.unknowns) ? cachedRow.unknowns as ValidationOutcome['unknowns'] : [],
      },
      retried: false,
      runId: null,
      cached: true,
    };
  }

  // Receipts get short aliases (r1, r2, …) in the prompt — small models
  // mangle raw UUIDs, which used to surface as "unknown receipt id" hard
  // failures and dropped citations. Aliases map back to UUIDs before
  // validation; unknown aliases stay unknown for the validator to count.
  const aliasToId = new Map<string, string>();
  bundle.receipts.forEach((r, i) => aliasToId.set(`r${i + 1}`, r.receiptId));

  // Structured call + inline validation with one stricter retry. Voice lint
  // and the deterministic completeness check share the retry: marketing
  // filler and a section that ships its TL;DR then stops are quality
  // failures the same way an uncited claim is.
  const completeness = (o: GeneratedOutput) =>
    spec.completenessCheck?.(o.contentMarkdown ?? '', deterministicContext) ?? [];
  let { output, runId } = await callModel(params, bundle, null, aliasToId);
  let validation = await validateGeneratedOutput({ bundle, output, snapshotId: params.snapshotId, mode: spec.mode });
  let voice = lintVoice(output.contentMarkdown ?? '');
  let coverage = completeness(output);
  let retried = false;
  if (validation.hardFailure || voice.issues.length > 0 || coverage.length > 0) {
    retried = true;
    const stricter = await callModel(params, bundle, [...validation.issues, ...voice.issues, ...coverage], aliasToId);
    output = stricter.output;
    runId = stricter.runId;
    validation = await validateGeneratedOutput({ bundle, output, snapshotId: params.snapshotId, mode: spec.mode });
    voice = lintVoice(output.contentMarkdown ?? '');
    coverage = completeness(output);
  }
  if (coverage.length > 0) {
    // Still under-covered after the retry: recorded as an honest unknown,
    // never silently shipped as if complete.
    validation = {
      ...validation,
      issues: [...validation.issues, ...coverage],
      unknowns: [...validation.unknowns, { kind: 'incomplete_coverage', detail: coverage[0] ?? null }],
    };
  }

  // Section critique (plan step 5): a cheap-tier judge reads each claim
  // against its cited receipts — exactly the record-critique pattern at the
  // section level. Contradicted/mostly-unsupported output gets ONE more
  // regeneration with the judge's reasons attached; whatever remains
  // downgrades confidence and lands in generation_context, never silently.
  let critique = await runSectionCritique(params, output, bundle, aliasToId);
  if (critique && (critique.contradicted > 0 || critique.unsupported * 2 > critique.judged)) {
    retried = true;
    const issues = critique.verdicts
      .filter((v) => v.verdict !== 'supported')
      .map((v) => `CRITIQUE ${v.verdict}: "${v.claim.slice(0, 140)}" — ${v.reason}`);
    const rewritten = await callModel(params, bundle, issues, aliasToId);
    output = rewritten.output;
    runId = rewritten.runId;
    validation = await validateGeneratedOutput({ bundle, output, snapshotId: params.snapshotId, mode: spec.mode });
    voice = lintVoice(output.contentMarkdown ?? '');
    coverage = completeness(output);
    critique = await runSectionCritique(params, output, bundle, aliasToId);
    if (critique && critique.contradicted > 0) {
      const order: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'low'];
      const downgraded = order[Math.min(order.indexOf(validation.confidence) + 1, 2)]!;
      validation = {
        ...validation,
        confidence: downgraded,
        unknowns: [...validation.unknowns, {
          kind: 'critique_contradiction',
          detail: critique.verdicts.find((v) => v.verdict === 'contradicted')?.claim.slice(0, 160) ?? null,
        }],
      };
    }
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

  // CONSULT backbones: deterministic tables spliced in where the model wrote
  // [[backbone]] — the model annotates around the facts but never writes
  // them, so regenerations stay byte-stable where facts are unchanged. A
  // missing marker appends the backbone after the intro: facts are never
  // lost to a model that forgot the marker.
  if (spec.backbone) {
    const content = output.contentMarkdown ?? '';
    if (backboneMarkdown) {
      output = {
        ...output,
        contentMarkdown: content.includes('[[backbone]]')
          ? content.replace(/\[\[backbone\]\]/g, backboneMarkdown)
          : `${content}\n\n${backboneMarkdown}`,
      };
    } else {
      output = { ...output, contentMarkdown: content.replace(/\[\[backbone\]\]/g, '').trim() };
    }
  }

  const diagrams = spec.diagrams ? await spec.diagrams(params.deps) : [];

  const sectionId = await persistSection(
    params, bundle, output, validation, diagrams, runId, retried, inline, unverified, voice.hits,
    evidenceHash, critique,
  );
  return { sectionId, validation, retried, runId };
}

// ─── Section critique (cheap tier) ───────────────────────────────────────────

interface CritiqueOutcome {
  judged: number;
  supported: number;
  unsupported: number;
  contradicted: number;
  verdicts: Array<{ claim: string; verdict: 'supported' | 'unsupported' | 'contradicted'; reason: string }>;
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'verdict', 'reason'],
        properties: {
          claim: { type: 'string' },
          verdict: { enum: ['supported', 'unsupported', 'contradicted'] },
          reason: { type: 'string' },
        },
      },
    },
  },
};

/** Judges each cited claim against its receipts. Null when nothing to judge. */
async function runSectionCritique(
  params: GenerateSectionParams,
  output: GeneratedOutput,
  bundle: EvidenceBundleV2,
  aliasToId: Map<string, string>,
): Promise<CritiqueOutcome | null> {
  const cited = (output.claims ?? []).filter((c) => c.receiptIds.length > 0).slice(0, 20);
  if (cited.length === 0) return null;
  const idToAlias = new Map([...aliasToId.entries()].map(([a, id]) => [id, a]));
  const byId = new Map(bundle.receipts.map((r) => [r.receiptId, r]));
  const lines = cited.map((c, i) => {
    const evidence = c.receiptIds.map((id) => {
      const r = byId.get(id);
      if (!r) return `  (${idToAlias.get(id) ?? id}: not in bundle)`;
      const where = [r.filePath ?? r.nodeStableKey, r.lineStart ? `L${r.lineStart}-${r.lineEnd}` : null].filter(Boolean).join(' ');
      return `  [${idToAlias.get(id) ?? id}] ${where}: ${(r.snippet ?? '(no snippet)').slice(0, 500)}`;
    }).join('\n');
    return `CLAIM ${i + 1}: ${c.claim}\n${evidence}`;
  });
  try {
    const response = await params.ai.call<{ verdicts: CritiqueOutcome['verdicts'] }>({
      tier: 'cheap',
      targetType: 'section_critique',
      sectionType: params.sectionType,
      packageId: params.packageId,
      promptVersion: SECTION_PROMPT_VERSION,
      schemaName: 'section_critique_v1',
      schema: CRITIQUE_SCHEMA,
      system: 'You are a strict fact-checker. For each claim, judge STRICTLY against the quoted receipt evidence only: "supported" (the evidence shows it), "unsupported" (the evidence neither shows nor denies it), "contradicted" (the evidence shows otherwise). One verdict per claim, same order. Reasons are one short sentence naming what the evidence does or does not show.',
      user: lines.join('\n\n'),
      maxOutputTokens: 2_000 + 120 * cited.length,
    });
    const verdicts = (response.value?.verdicts ?? []).slice(0, cited.length);
    return {
      judged: verdicts.length,
      supported: verdicts.filter((v) => v.verdict === 'supported').length,
      unsupported: verdicts.filter((v) => v.verdict === 'unsupported').length,
      contradicted: verdicts.filter((v) => v.verdict === 'contradicted').length,
      verdicts,
    };
  } catch (err) {
    // Critique is a quality layer, not a gate — its own failure never blocks
    // the section.
    console.warn(`[sectionGenerator] critique failed for ${params.sectionType}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Byte-identical reuse: clone the cached row and its receipt copies. */
async function persistCachedSection(
  params: GenerateSectionParams,
  cached: { id: string; content: string; diagrams: unknown; confidence: 'high' | 'medium' | 'low'; unknowns: unknown },
  evidenceHash: string,
): Promise<string> {
  await query(`DELETE FROM package_sections WHERE package_id = $1 AND type = $2`, [params.packageId, params.sectionType]);
  const row = (await query(
    `INSERT INTO package_sections
       (package_id, snapshot_id, generation_run_id, type, title, content, diagrams,
        confidence, review_status, analyzed_commit, role, unknowns, generation_context)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11)
     RETURNING id`,
    [params.packageId, params.snapshotId, params.sectionType,
     SECTION_TITLES[params.sectionType] ?? params.sectionType, cached.content,
     JSON.stringify(cached.diagrams ?? []), cached.confidence, params.commitHash, params.role,
     JSON.stringify(cached.unknowns ?? []),
     JSON.stringify({
       prompt_version: SECTION_PROMPT_VERSION,
       evidence_hash: evidenceHash,
       cached_from_section_id: cached.id,
       mode: 'cache_hit',
     })],
  )).rows[0] as { id: string };
  // Receipt copies follow the content — the receipt viewer and staleness
  // tracking work identically on a cache hit.
  await query(
    `INSERT INTO source_receipts
       (project_id, snapshot_id, receipt_kind, trust_level, section_id, node_id, workflow_id,
        node_stable_key, file_path, symbol_name, line_start, line_end, snippet,
        detection_expression, referenced_record_id, commit_hash, claim, metadata)
     SELECT project_id, snapshot_id, receipt_kind, trust_level, $2, node_id, workflow_id,
            node_stable_key, file_path, symbol_name, line_start, line_end, snippet,
            detection_expression, referenced_record_id, commit_hash, claim, metadata
     FROM source_receipts WHERE section_id = $1`,
    [cached.id, row.id],
  );
  return row.id;
}

async function callModel(
  params: GenerateSectionParams,
  bundle: EvidenceBundleV2,
  previousIssues: string[] | null,
  aliasToId: Map<string, string>,
): Promise<{ output: GeneratedOutput; runId: string | null }> {
  const spec = SECTION_SPECS[params.sectionType];
  const prompt = renderPrompt(params, bundle, previousIssues, aliasToId);
  const response = await params.ai.call<GeneratedOutput>({
    tier: 'strong',
    targetType: 'section',
    sectionType: params.sectionType,
    packageId: params.packageId,
    promptVersion: SECTION_PROMPT_VERSION,
    schemaName: 'onboarding_section_v2',
    schema: SECTION_OUTPUT_SCHEMA,
    // Static rules + the section's Diátaxis mode voice — byte-identical per
    // mode, so the prefix still prompt-caches across sections (Track B).
    system: `${SECTION_BASE_PROMPT}\n\n${MODE_VOICES[spec.mode] ?? ''}`,
    user: prompt,
    // Depth contract (plan rule 7): output scales with repo size class.
    maxOutputTokens: spec.outputBudget[params.deps.sizeClass],
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

/** Static rules + voice contract — byte-identical per mode (prompt caching). */
const SECTION_BASE_PROMPT = [
  'Output rules: use ONLY the provided evidence; cite receipt ids (the exact short ids below, e.g. "r3") in claims and usedReceiptIds — but ONLY ids that literally appear in the receipt list; a claim grounded in the deterministic facts (counts, steps, tables, journeys) carries an EMPTY receiptIds array rather than an invented id. When citing inside contentMarkdown use the same short ids in parentheses, e.g. "(r3)"; code receipts win over docs; state unknowns explicitly instead of guessing; contentMarkdown uses headers/bullets/`code` formatting. Internal identifiers (wf:…, cluster:…, docnode:…) are pipeline bookkeeping — never print them; use the human name or path they refer to.',
  'Open contentMarkdown with a TL;DR block: "**TL;DR:** " + 2-3 sentences on what this section covers, ending with one sentence of the form "After reading you can …". Then the body.',
  'Voice: flat, declarative engineering prose for a skeptical senior engineer. FORBIDDEN: marketing adjectives (crucial, essential, seamless, vital, powerful, robust, comprehensive), "enhances user …", "user satisfaction/engagement/retention", invented consequences ("could lead to user frustration", "poor first impression"), and restating a name as its own purpose ("DELETE /x enables deletion of x"). Every sentence must state a fact from the evidence, a number from the deterministic facts, or an explicit unknown. Numbers (counts, totals) must come verbatim from the deterministic facts — never derive or estimate your own.',
].join('\n\n');

/**
 * Diátaxis mode scaffolds (doc/DIATAXIS_NOTES.md per-mode rules) — one
 * documentation mode per section; blending modes serves none.
 */
const MODE_VOICES: Record<string, string> = {
  explanation: [
    'MODE: explanation — understanding-oriented, read away from the keyboard.',
    'Write discursive prose that says WHY: design decisions, constraints, trade-offs, connections between parts. Weighing alternatives is proper here when the evidence shows them; inventing them is not.',
    'Never give step-by-step instructions and never dump reference tables — link the reader to the Do/Consult sections instead. Each header should survive the prefix "About …".',
  ].join(' '),
  tutorial: [
    'MODE: tutorial — a lesson where the reader learns by doing and MUST succeed.',
    'Write in first-person plural ("we") with unambiguous imperatives. Numbered steps, ONE action per step, a verify checkpoint after every step ("You should see …") grounded in evidence. A single unbranching path: no options, no alternatives, no "you could also".',
    'Explanation is capped at one sentence per step — link out for theory. Close by naming what the reader just accomplished.',
  ].join(' '),
  howto: [
    'MODE: how-to — recipes for a competent practitioner already at work.',
    'Goal-first titles ("How to add an API route"). Assume competence: never explain basics, never teach, never motivate. Conditional imperatives where reality branches ("If the route needs auth, …"). Practical usability over completeness — link to the Consult tables for full option lists.',
  ].join(' '),
  reference: [
    'MODE: reference — austere and uncompromising. Describe; never instruct, never opine, never market.',
    'Neutral one-liners and tables only. Structure mirrors the product (group by how the code itself is organized). Consistency over elegance: same fields, same order, every entry. Warnings in directive language only where the evidence shows a real hazard.',
    'Citation rule for this mode: statements that restate the deterministic facts or the spliced tables are already grounded — leave them UNCITED (no claims entry) rather than inventing receipt ids. Cite a receipt ONLY when you used one from the receipt list, with its exact short id.',
  ].join(' '),
};

function renderPrompt(
  params: GenerateSectionParams,
  bundle: EvidenceBundleV2,
  previousIssues: string[] | null,
  aliasToId: Map<string, string>,
): string {
  const spec = SECTION_SPECS[params.sectionType];
  const idToAlias = new Map([...aliasToId.entries()].map(([a, id]) => [id, a]));
  // Evidence budgets sized for the 1M-context tier (Track B): summaries,
  // snippets, and deterministic facts were truncated for small windows.
  const records = bundle.semanticContext.map(
    (r) => `- [${r.recordLevel}] ${r.stableKey} (confidence ${r.confidence}): ${r.summary.slice(0, 400)}`,
  );
  const receipts = bundle.receipts.map((r) => {
    const where = [r.filePath ?? r.nodeStableKey, r.lineStart ? `L${r.lineStart}-${r.lineEnd}` : null].filter(Boolean).join(' ');
    const snippet = r.snippet ? `\n  ${r.snippet.slice(0, 1_500).replace(/\n/g, '\n  ')}` : '';
    return `- receipt ${idToAlias.get(r.receiptId) ?? r.receiptId} [${r.receiptKind}, trust=${r.trustLevel}] ${where}${snippet}`;
  });
  return [
    `You are writing the "${params.sectionType}" onboarding section for a ${params.role} developer joining ${bundle.repo.owner}/${bundle.repo.name} (scope: ${bundle.scope.displayName}).`,
    spec.instructions.replace(/\bROLE\b/g, params.role),
    previousIssues && previousIssues.length > 0
      ? `Your previous attempt FAILED validation. Fix these problems and cite only receipt ids that exist below:\n- ${previousIssues.join('\n- ')}`
      : null,
    `Deterministic facts (authoritative):\n${JSON.stringify(bundle.deterministicContext).slice(0, 24_000)}`,
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
  evidenceHash: string,
  critique: CritiqueOutcome | null,
): Promise<string> {
  const generationContext = {
    prompt_version: SECTION_PROMPT_VERSION,
    evidence_hash: evidenceHash,
    views: SECTION_SPECS[params.sectionType].views,
    retrieval: bundle.deterministicContext.retrievalStats ?? null,
    validation: { issues: validation.issues, retried, hardFailure: validation.hardFailure },
    claims: validation.adjustedClaims,
    critique: critique
      ? {
          judged: critique.judged,
          supported: critique.supported,
          unsupported: critique.unsupported,
          contradicted: critique.contradicted,
          rejected: critique.verdicts.filter((v) => v.verdict !== 'supported').slice(0, 6),
        }
      : null,
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
  const usedReceipts = bundle.receipts.filter((r) => used.has(r.receiptId));
  // One multi-VALUES INSERT — with 40-receipt evidence budgets a per-row
  // loop would cost 40 round trips per section (Track C).
  if (usedReceipts.length > 0) {
    const values: unknown[] = [];
    const tuples = usedReceipts.map((receipt, i) => {
      values.push(
        params.projectId, params.snapshotId, receipt.receiptKind, receipt.trustLevel,
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
        }),
      );
      const base = i * 16;
      return `(${Array.from({ length: 16 }, (_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    await query(
      `INSERT INTO source_receipts
         (project_id, snapshot_id, receipt_kind, trust_level, section_id, node_stable_key,
          file_path, symbol_name, line_start, line_end, snippet, detection_expression,
          referenced_record_id, commit_hash, claim, metadata)
       VALUES ${tuples.join(', ')}`,
      values,
    );
  }
  return sectionRow.id;
}
