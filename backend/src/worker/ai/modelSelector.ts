/**
 * Dynamic model selection (user directive, 2026-07-24): provider throughput
 * on OpenRouter swings by time of day, so instead of pinning one model, we
 * probe the endpoints API for each candidate before a job and pick the model
 * whose best *eligible* provider is fastest — privacy first, throughput
 * second:
 *
 *  - Privacy is enforced server-side: every chat request carries
 *    `provider.data_collection = 'deny'` (OPENROUTER_DATA_COLLECTION to
 *    override), which excludes providers that retain or train on prompts.
 *    Neither the endpoints nor the providers API exposes a machine-readable
 *    retention policy, so OpenRouter's own filter is the authoritative
 *    privacy signal — we sort by it by *requiring* it, not by guessing.
 *  - Throughput ranking is ours: per model, keep endpoints that support
 *    structured outputs (DeepSeek's fastest endpoint doesn't — exactly the
 *    malformed-JSON class the retry ladder exists for), have the context
 *    headroom our batches need, and are healthy; score = best p50 tok/s.
 *  - Stickiness: semantic records are content-addressed per model id, so a
 *    model flip invalidates the record cache. The incumbent (last complete
 *    snapshot's family) keeps winning unless a rival is ≥1.25× faster.
 *
 * Selection NEVER blocks a job: any API failure falls back to the env
 * default chain with a logged warning. Results cache in-process for 5 min.
 */

import { query } from '../../lib/db.js';
import { latestSnapshotOrderSql } from '../../lib/snapshotOrdering.js';
import { resolveApiKey } from './keyResolver.js';

export interface CandidateModel {
  id: string;
  label: string;
}

/** The three models the user chose for rotation. */
export const AUTO_CANDIDATES: CandidateModel[] = [
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout' },
];

/** Sentinel stored in model_tier_overrides when the project wants rotation. */
export const AUTO_MODEL_ID = 'auto';

// Eligibility floors for an endpoint to count toward a model's score.
const MIN_CONTEXT = 200_000;      // symbol batches run ~90k in + 60k out
const MIN_UPTIME_30M = 95;
const STICKINESS_RATIO = 1.25;    // rival must beat the incumbent by ≥25%
const CACHE_TTL_MS = 5 * 60_000;

export interface EndpointStat {
  tag: string;
  providerName: string;
  contextLength: number;
  throughputP50: number | null;
  uptime30m: number | null;
  status: number;
  structuredOutputs: boolean;
}

export interface ModelRanking {
  id: string;
  label: string;
  /** Best eligible endpoint's p50 tok/s; null = no eligible endpoint. */
  score: number | null;
  /** Eligible endpoint tags, fastest first (feeds provider.order). */
  providerOrder: string[];
  /** Why the model scored null, for the log line. */
  excludedReason?: string;
}

export interface ModelSelection {
  model: string;
  rankings: ModelRanking[];
  /** True when the incumbent kept the slot despite a faster rival. */
  sticky: boolean;
  /** Providers for the chosen model, fastest first. */
  providerOrder: string[];
  selectedAtMs: number;
}

let cached: ModelSelection | null = null;

/** Test seam + cache reset. */
export function __resetSelectionCacheForTests(): void {
  cached = null;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

async function fetchModelEndpoints(
  modelId: string,
  fetchImpl: FetchLike,
  apiKey: string,
): Promise<EndpointStat[]> {
  const res = await fetchImpl(`https://openrouter.ai/api/v1/models/${modelId}/endpoints`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`endpoints API ${res.status} for ${modelId}`);
  const body = (await res.json()) as {
    data?: { endpoints?: Array<Record<string, unknown>> };
  };
  return (body.data?.endpoints ?? []).map((e) => ({
    tag: String(e.tag ?? e.provider_name ?? 'unknown'),
    providerName: String(e.provider_name ?? 'unknown'),
    contextLength: Number(e.context_length ?? 0),
    throughputP50: (e.throughput_last_30m as { p50?: number } | undefined)?.p50 ?? null,
    uptime30m: typeof e.uptime_last_30m === 'number' ? e.uptime_last_30m : null,
    status: Number(e.status ?? 0),
    structuredOutputs: Array.isArray(e.supported_parameters)
      ? (e.supported_parameters as string[]).includes('structured_outputs')
      : false,
  }));
}

export function rankModel(candidate: CandidateModel, endpoints: EndpointStat[]): ModelRanking {
  const eligible = endpoints
    .filter((e) =>
      e.structuredOutputs
      && e.contextLength >= MIN_CONTEXT
      && e.status >= 0
      && (e.uptime30m == null || e.uptime30m >= MIN_UPTIME_30M)
      && e.throughputP50 != null && e.throughputP50 > 0)
    .sort((a, b) => (b.throughputP50 ?? 0) - (a.throughputP50 ?? 0));
  if (eligible.length === 0) {
    const reason = endpoints.length === 0 ? 'no endpoints'
      : !endpoints.some((e) => e.structuredOutputs) ? 'no structured-output provider'
      : !endpoints.some((e) => e.contextLength >= MIN_CONTEXT) ? `no provider with ≥${MIN_CONTEXT / 1000}k context`
      : 'no healthy provider';
    return { id: candidate.id, label: candidate.label, score: null, providerOrder: [], excludedReason: reason };
  }
  return {
    id: candidate.id,
    label: candidate.label,
    score: eligible[0]!.throughputP50,
    providerOrder: eligible.slice(0, 3).map((e) => e.tag),
  };
}

/** The last complete snapshot's model family — the record-cache incumbent. */
async function incumbentModelFor(projectId: string): Promise<string | null> {
  try {
    const row = (await query(
      `SELECT sr.model_family
       FROM analysis_snapshots s
       JOIN snapshot_semantic_records ssr ON ssr.snapshot_id = s.id
       JOIN semantic_records sr ON sr.id = ssr.record_id
       WHERE s.project_id = $1 AND s.status = 'complete'
       ORDER BY ${latestSnapshotOrderSql('s')} LIMIT 1`,
      [projectId],
    )).rows[0] as { model_family: string } | undefined;
    return row?.model_family ?? null;
  } catch {
    return null;
  }
}

export interface SelectModelOptions {
  projectId?: string;
  /** Injectable for tests. */
  fetchImpl?: FetchLike;
  /** Injectable for tests (skips the DB read). */
  incumbent?: string | null;
  now?: number;
}

/**
 * Ranks the candidates by live provider throughput and returns the winner
 * (with stickiness toward the incumbent's record cache). Throws never —
 * on any failure returns the env-default model with an empty ranking.
 */
export async function selectModel(opts: SelectModelOptions = {}): Promise<ModelSelection> {
  const now = opts.now ?? Date.now();
  if (cached && now - cached.selectedAtMs < CACHE_TTL_MS) return cached;

  const fallback: ModelSelection = {
    model: process.env.OPENROUTER_MODEL_CHEAP ?? 'google/gemini-2.5-flash-lite',
    rankings: [],
    sticky: false,
    providerOrder: [],
    selectedAtMs: now,
  };

  try {
    const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
    // The probe used to read OPENROUTER_API_KEY directly, so a project on its
    // own BYO key had its model chosen against an account that is not the one
    // paying for the calls — and on a deployment with no server key at all the
    // endpoints API saw `Bearer ` and every candidate was excluded.
    //
    // The selection cache below is module-global, so a selection probed with
    // one project's key can be served to another inside the 5 min TTL. That is
    // acceptable because selection is not billing: every chat call resolves its
    // own key (aiClient -> resolveApiKey) and stamps key_source on the run.
    //
    // resolveApiKey throws when neither key exists; the env fallback is what
    // keeps this function's "throws never" contract.
    let apiKey = process.env.OPENROUTER_API_KEY ?? '';
    if (opts.projectId) {
      try {
        apiKey = (await resolveApiKey(opts.projectId)).apiKey;
      } catch {
        apiKey = process.env.OPENROUTER_API_KEY ?? '';
      }
    }
    const rankings = await Promise.all(
      AUTO_CANDIDATES.map(async (c) => {
        try {
          return rankModel(c, await fetchModelEndpoints(c.id, fetchImpl, apiKey));
        } catch (err) {
          return {
            id: c.id, label: c.label, score: null, providerOrder: [],
            excludedReason: err instanceof Error ? err.message : 'probe failed',
          } satisfies ModelRanking;
        }
      }),
    );
    const scored = rankings.filter((r) => r.score != null).sort((a, b) => b.score! - a.score!);
    if (scored.length === 0) {
      console.warn('[model-selector] no candidate has an eligible provider — using env default');
      return fallback;
    }

    let winner = scored[0]!;
    let sticky = false;
    const incumbent = opts.incumbent !== undefined
      ? opts.incumbent
      : opts.projectId ? await incumbentModelFor(opts.projectId) : null;
    if (incumbent && incumbent !== winner.id) {
      const inc = scored.find((r) => r.id === incumbent);
      if (inc && winner.score! < inc.score! * STICKINESS_RATIO) {
        winner = inc;
        sticky = true;
      }
    }

    const selection: ModelSelection = {
      model: winner.id,
      rankings,
      sticky,
      providerOrder: winner.providerOrder,
      selectedAtMs: now,
    };
    cached = selection;
    console.log(`[model-selector] ${describeSelection(selection)}`);
    return selection;
  } catch (err) {
    console.warn('[model-selector] selection failed, using env default:', err instanceof Error ? err.message : err);
    return fallback;
  }
}

export function describeSelection(sel: ModelSelection): string {
  const parts = sel.rankings
    .map((r) => (r.score != null
      ? `${r.label} ${Math.round(r.score)}tps(${r.providerOrder[0] ?? '?'})`
      : `${r.label} excluded(${r.excludedReason})`))
    .join(' · ');
  return `chose ${sel.model}${sel.sticky ? ' (sticky: record cache)' : ''} — ${parts}`;
}

/**
 * True when the project's overrides pin an explicit model; 'auto', missing,
 * or malformed all mean rotation.
 */
export function isAutoSelection(modelTierOverrides: unknown): boolean {
  if (!modelTierOverrides || typeof modelTierOverrides !== 'object') return true;
  const cheap = (modelTierOverrides as Record<string, unknown>).cheap;
  if (!Array.isArray(cheap) || cheap.length === 0) return true;
  return cheap[0] === AUTO_MODEL_ID;
}

/**
 * Tier overrides for a selection: the winner primary on both chat tiers,
 * the remaining candidates as degrade fallbacks (ranked order).
 */
export function overridesForSelection(sel: ModelSelection): { cheap: string[]; strong: string[] } {
  const ranked = sel.rankings
    .filter((r) => r.score != null)
    .sort((a, b) => b.score! - a.score!)
    .map((r) => r.id);
  const chain = [sel.model, ...ranked.filter((id) => id !== sel.model)];
  return { cheap: chain, strong: chain };
}
