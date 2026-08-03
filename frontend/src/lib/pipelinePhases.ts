/**
 * The canonical pipeline phase list: order, labels, descriptions, and which
 * phases reach a model. Lives in lib so public pages (the landing) can import
 * it without pulling an authed component into their import graph, and so
 * marketing copy, the run panel and the overview can never drift apart.
 */
export interface PipelinePhase {
  key: string;
  label: string;
  desc: string;
  /**
   * Reaches a model (LLM or the embeddings endpoint) when the project's
   * privacy mode allows AI. Checked against the backend rather than inferred
   * from the label — the "AI:" prefix is not a reliable marker, and getting
   * this wrong on a transparency page is a false privacy claim.
   */
  ai: boolean;
  /**
   * `ai_disabled` skips the phase entirely — mirrors the backend's
   * SEMANTIC_PHASES (worker/semantic/semanticPipeline.ts:25, applied at
   * worker/index.ts). `embeddings` is in that list even though its label
   * doesn't say "AI". `generation` is the exception in the other direction:
   * it is NOT skipped but runs LLM-free (summaryWorker `mode: 'deterministic'`),
   * so it makes no model calls in that mode. `validation` only re-checks
   * citations against the source.
   */
  skippedWhenAiDisabled: boolean;
}

/** Pipeline order + labels; phases the backend hasn't reached yet render as upcoming. */
export const PHASE_ORDER: readonly PipelinePhase[] = [
  { key: "ingest", label: "Download & inventory", desc: "Clones the repo and inventories files; nothing is sent to any AI", ai: false, skippedWhenAiDisabled: false },
  { key: "parse", label: "Parse code (AST)", desc: "Builds a syntax tree per file to extract symbols deterministically", ai: false, skippedWhenAiDisabled: false },
  { key: "graph", label: "Build evidence graph", desc: "Links imports, calls and dependencies into an evidence graph", ai: false, skippedWhenAiDisabled: false },
  { key: "workflows", label: "Trace workflows", desc: "Traces end-to-end flows through the graph (routes, jobs, handlers)", ai: false, skippedWhenAiDisabled: false },
  { key: "candidate_ranking", label: "Rank critical code", desc: "Scores files/symbols on the seven criticality signals", ai: false, skippedWhenAiDisabled: false },
  { key: "clustering", label: "Cluster architecture", desc: "Groups modules into architecture components", ai: false, skippedWhenAiDisabled: false },
  { key: "incremental_diff", label: "Diff vs previous commit", desc: "Compares against the previous analyzed commit to find what changed", ai: false, skippedWhenAiDisabled: false },
  { key: "semantic_symbols", label: "AI: explain symbols", desc: "AI reads extracted facts (and code under Full AI) to explain symbols", ai: true, skippedWhenAiDisabled: true },
  { key: "synthesis", label: "AI: file → system synthesis", desc: "AI composes file-level explanations into a system narrative", ai: true, skippedWhenAiDisabled: true },
  { key: "capabilities", label: "AI: extract capabilities", desc: "AI names the product capabilities the code implements", ai: true, skippedWhenAiDisabled: true },
  { key: "refinement", label: "AI: refine top items", desc: "AI rewrites the highest-ranked explanations for clarity", ai: true, skippedWhenAiDisabled: true },
  { key: "critique", label: "AI: verify claims", desc: "AI cross-checks claims against the evidence graph", ai: true, skippedWhenAiDisabled: true },
  { key: "semantic_ranking", label: "AI: blend rankings", desc: "Blends AI judgment into the deterministic ranking", ai: true, skippedWhenAiDisabled: true },
  { key: "embeddings", label: "Index for retrieval", desc: "Indexes content for retrieval (OpenAI-compatible embeddings endpoint)", ai: true, skippedWhenAiDisabled: true },
  { key: "generation", label: "Generate onboarding", desc: "Assembles the onboarding package sections", ai: true, skippedWhenAiDisabled: false },
  { key: "validation", label: "Validate citations", desc: "Verifies every citation still points at real code", ai: false, skippedWhenAiDisabled: false },
];

/** The badge beside the label already says "AI"; drop the prefix PHASE_ORDER
 *  carries for the run panel, and recase what it left mid-sentence. */
export function stripAiPrefix(label: string): string {
  const stripped = label.replace(/^AI: /, "");
  return stripped === label ? label : stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
