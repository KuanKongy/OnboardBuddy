/**
 * Trust-aware citation validation (doc/Pipeline.md "Citation validation").
 * Runs inline during generation (the generator retries once with a
 * stricter prompt on hard failure) and again as the `validation` phase.
 * Enforcement is mechanical: unknown receipts are dropped, uncited claims
 * are downgraded to low confidence and listed in unknowns, docs-only
 * support caps confidence at medium, and record_reference receipts must
 * resolve transitively to code-level evidence.
 */

import { query } from '../../lib/db.js';
import { hasKindPrefix } from '../engine/stableKeys.js';
import type { EvidenceBundleV2, TrustLevel } from '../../retrieval/retrievalService.js';

export interface GeneratedClaim {
  claim: string;
  receiptIds: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface GeneratedOutput {
  title: string;
  contentMarkdown: string;
  confidence: 'high' | 'medium' | 'low';
  claims: GeneratedClaim[];
  usedReceiptIds: string[];
  unknowns: Array<{ kind: string; detail?: string | null }>;
}

export interface ValidationOutcome {
  /** True = generator should retry once with a stricter prompt. */
  hardFailure: boolean;
  issues: string[];
  adjustedClaims: GeneratedClaim[];
  /** Valid cited receipt ids (unknown ids dropped). */
  usedReceiptIds: string[];
  confidence: 'high' | 'medium' | 'low';
  unknowns: Array<{ kind: string; detail?: string | null }>;
}

const CONFIDENCE_RANK: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };
const TRUST_RANK: Record<TrustLevel, number> = { code: 5, config: 4, tests: 3, docs: 2, llm_inference: 1 };
const FILE_TOKEN = /[\w@./-]+\.(?:tsx?|jsx?|mjs|cjs|sql|ya?ml|json)\b/g;
/**
 * Runtime/framework names that pattern-match as files: "runs on Node.js"
 * was downgraded for not citing a receipt from a file called Node.js,
 * turning whole stack-overview sections low-confidence.
 */
const NOT_A_FILE = /^(?:node|express|vue|react|next|nest|angular|ember|deno|bun|d3|three)\.js$/i;
const MAX_REFERENCE_DEPTH = 3;

export async function validateGeneratedOutput(params: {
  bundle: EvidenceBundleV2;
  output: GeneratedOutput;
  snapshotId: string;
  /**
   * Diátaxis mode of the section under validation. Reference sections carry
   * deterministic backbones — their claims LEGITIMATELY go uncited (the
   * facts are spliced in from SQL, not asserted by the model), so the
   * majority-uncited hard-fail and the empty-claims low grade don't apply.
   */
  mode?: 'explanation' | 'tutorial' | 'howto' | 'reference';
}): Promise<ValidationOutcome> {
  const { bundle, output } = params;
  const issues: string[] = [];
  const unknowns: Array<{ kind: string; detail?: string | null }> = [];
  const bundleReceipts = new Map(bundle.receipts.map((r) => [r.receiptId, r]));

  // 1. every cited receipt must exist in the bundle
  const citedIds = new Set<string>([...output.usedReceiptIds, ...output.claims.flatMap((c) => c.receiptIds)]);
  const unknownIds = [...citedIds].filter((id) => !bundleReceipts.has(id));
  if (unknownIds.length > 0) {
    issues.push(`${unknownIds.length} cited receipt id(s) not in the evidence bundle`);
  }
  const validCited = [...citedIds].filter((id) => bundleReceipts.has(id));

  // 2. snapshot lineage: cited node-backed receipts must still resolve to a
  // node in this snapshot (records are shared across snapshots; the node
  // presence is what ties evidence to this commit's code).
  const staleReceiptIds = await findStaleReceipts(params.snapshotId, validCited, bundleReceipts);
  if (staleReceiptIds.size > 0) {
    issues.push(`${staleReceiptIds.size} cited receipt(s) reference nodes missing from this snapshot`);
  }

  // 6. transitive resolution of record_reference receipts to code-level trust
  const trustById = new Map<string, TrustLevel>();
  let unresolvableChains = 0;
  for (const id of validCited) {
    const receipt = bundleReceipts.get(id)!;
    if (receipt.receiptKind === 'record_reference' && receipt.referencedRecordId) {
      const resolved = await resolveReferenceTrust(receipt.referencedRecordId, MAX_REFERENCE_DEPTH);
      if (resolved === null) {
        unresolvableChains += 1;
        issues.push(`record_reference receipt ${id} does not resolve to code-level evidence`);
        trustById.set(id, 'llm_inference');
      } else {
        trustById.set(id, resolved);
      }
    } else {
      trustById.set(id, receipt.trustLevel);
    }
  }

  // 3-5. per-claim checks
  const adjustedClaims: GeneratedClaim[] = [];
  let uncited = 0;
  for (const claim of output.claims) {
    const cited = claim.receiptIds.filter((id) => bundleReceipts.has(id) && !staleReceiptIds.has(id));
    let confidence = claim.confidence;

    if (cited.length === 0) {
      // 4. uncited claims -> low confidence + listed in unknowns
      uncited += 1;
      confidence = 'low';
      unknowns.push({ kind: 'uncited_claim', detail: claim.claim.slice(0, 160) });
    } else {
      // 3. claims naming files must cite receipts from those files
      const namedFiles = [...claim.claim.matchAll(FILE_TOKEN)]
        .map((m) => m[0])
        .filter((f) => !NOT_A_FILE.test(f));
      if (namedFiles.length > 0) {
        const citedFiles = cited
          .map((id) => bundleReceipts.get(id)!)
          .flatMap((r) => [r.filePath, r.nodeStableKey].filter((v): v is string => typeof v === 'string'));
        const matches = namedFiles.some((f) => citedFiles.some((cf) => cf.includes(f) || f.includes(cf)));
        if (!matches) {
          confidence = 'low';
          issues.push(`claim names ${namedFiles[0]} but cites no receipt from it`);
        }
      }
      // 5. trust threshold: best trust among cited receipts
      const bestTrust = Math.max(...cited.map((id) => TRUST_RANK[trustById.get(id) ?? 'llm_inference']));
      if (bestTrust <= TRUST_RANK.docs) {
        if (confidence === 'high') confidence = 'medium'; // docs-only support
        unknowns.push({ kind: 'docs_only_support', detail: claim.claim.slice(0, 160) });
        // Mechanical docs-vs-code proxy: code evidence for the same node was
        // available in the bundle but the claim rests on docs alone.
        const citedNodes = new Set(cited.map((id) => bundleReceipts.get(id)!.nodeStableKey).filter(Boolean));
        const codeExistsForNode = bundle.receipts.some(
          (r) => TRUST_RANK[r.trustLevel] >= TRUST_RANK.tests && r.nodeStableKey && citedNodes.has(r.nodeStableKey),
        );
        if (codeExistsForNode) {
          unknowns.push({ kind: 'docs_conflict_with_code', detail: claim.claim.slice(0, 160) });
        }
      }
      if (bestTrust === TRUST_RANK.llm_inference) confidence = 'low';
    }
    adjustedClaims.push({ ...claim, receiptIds: cited, confidence });
  }

  // 7. section confidence: distribution of claim confidences, capped by the
  // model's own self-assessment. The old rule took the MINIMUM over all
  // claims — one uncited claim among twenty branded the whole section low,
  // so every section read "low" regardless of quality. Weak claims keep
  // their individual downgrade and unknowns entry above; the section grade
  // now reflects how much of the section is well-supported.
  let confidence: 'high' | 'medium' | 'low';
  if (adjustedClaims.length === 0) {
    // Reference sections are graded on their deterministic backbone, not on
    // model claims — code-derived tables with no complaints are solid.
    confidence = params.mode === 'reference' ? (issues.length === 0 ? 'high' : 'medium') : 'low';
  } else {
    const lowShare = adjustedClaims.filter((c) => c.confidence === 'low').length / adjustedClaims.length;
    const highShare = adjustedClaims.filter((c) => c.confidence === 'high').length / adjustedClaims.length;
    confidence = lowShare > 0.3 ? 'low' : highShare >= 0.6 && lowShare === 0 ? 'high' : 'medium';
    if (CONFIDENCE_RANK[output.confidence] < CONFIDENCE_RANK[confidence]) confidence = output.confidence;
    // Reference floor: the spliced backbone is code-derived truth — a clean
    // validation never grades below medium just because annotations are thin.
    if (params.mode === 'reference' && issues.length === 0 && confidence === 'low') confidence = 'medium';
  }

  const hardFailure =
    unresolvableChains > 0 ||
    (citedIds.size > 0 && unknownIds.length * 2 > citedIds.size) ||
    // Reference mode: uncited claims are the contract (backbone facts), not
    // a failure signature.
    (params.mode !== 'reference' && output.claims.length > 0 && uncited * 2 > output.claims.length);

  return {
    hardFailure,
    issues,
    adjustedClaims,
    usedReceiptIds: validCited.filter((id) => !staleReceiptIds.has(id)),
    confidence,
    unknowns: [...output.unknowns, ...unknowns],
  };
}

/** Node-backed receipts whose stable key no longer exists in this snapshot. */
async function findStaleReceipts(
  snapshotId: string,
  receiptIds: string[],
  bundleReceipts: Map<string, { nodeStableKey?: string }>,
): Promise<Set<string>> {
  const keyed = receiptIds
    .map((id) => ({ id, key: bundleReceipts.get(id)?.nodeStableKey }))
    .filter((r): r is { id: string; key: string } => typeof r.key === 'string');
  if (keyed.length === 0) return new Set();
  const existing = new Set(
    ((await query(
      `SELECT stable_key FROM graph_nodes WHERE snapshot_id = $1 AND stable_key = ANY($2)`,
      [snapshotId, [...new Set(keyed.map((r) => r.key))]],
    )).rows as Array<{ stable_key: string }>).map((r) => r.stable_key),
  );
  // Kind-prefixed stable keys (clusters, workflows, docs, config) are not
  // plain graph keys; judged by prefix — a colon inside a route symbol
  // (`#POST /:id/analyze`) does not make a key synthetic.
  return new Set(keyed.filter((r) => !existing.has(r.key) && !hasKindPrefix(r.key)).map((r) => r.id));
}

/** Follows record_reference chains down to the referenced records' receipts. */
async function resolveReferenceTrust(recordId: string, depth: number): Promise<TrustLevel | null> {
  if (depth <= 0) return null;
  const record = (await query(
    `SELECT receipt_ids, facts_only FROM semantic_records WHERE id = $1`,
    [recordId],
  )).rows[0] as { receipt_ids?: string[]; facts_only?: boolean } | undefined;
  // Facts-only records ARE deterministic code extraction — they bottom out
  // at code trust by construction, without receipt rows of their own.
  if (record?.facts_only === true) return 'code';
  const receiptIds = record?.receipt_ids ?? [];
  if (receiptIds.length === 0) return null;
  const rows = (await query(
    `SELECT trust_level, receipt_kind, referenced_record_id FROM source_receipts WHERE id = ANY($1)`,
    [receiptIds],
  )).rows as Array<{ trust_level: TrustLevel; receipt_kind: string; referenced_record_id: string | null }>;

  let best: TrustLevel | null = null;
  for (const row of rows) {
    let trust: TrustLevel | null = row.trust_level;
    if (row.receipt_kind === 'record_reference' && row.referenced_record_id) {
      trust = await resolveReferenceTrust(row.referenced_record_id, depth - 1);
    }
    if (trust !== null && trust !== 'llm_inference' && (best === null || TRUST_RANK[trust] > TRUST_RANK[best])) {
      best = trust;
    }
  }
  return best;
}
