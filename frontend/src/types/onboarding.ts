export type PackageStatus = "missing" | "generating" | "draft" | "approved" | "stale" | "failed";
export type ConfidenceLevel = "high" | "medium" | "low";
export type SectionStatus = "complete" | "stale" | "missing";

export type SectionId =
  | "start-here"
  | "architecture"
  | "entry-points"
  | "critical-25"
  | "capability-map"
  | "workflows"
  | "role-path"
  | "data-schema"
  | "safety-rails"
  | "dependency-graph"
  | "doc-health";

/**
 * Receipt re-anchoring lifecycle (Swimm-style): where this evidence stands
 * against the latest complete analysis.
 */
export interface ReceiptVerification {
  status: "verified" | "re_anchored" | "changed" | "missing" | "unverifiable";
  /** Commit of the latest analysis the receipt was checked against. */
  checkedAgainstCommit: string | null;
  /** The receipt span in the latest analysis (shifted when re-anchored). */
  lineStart: number | null;
  lineEnd: number | null;
}

export interface SourceReceipt {
  /** source_receipts row id (present on reader receipts). */
  id?: string;
  /** Original evidence-bundle receipt id — the key inline [[receipt:…]] markers use. */
  bundleReceiptId?: string | null;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  /** Original lineEnd when the span was capped to stay spot-checkable. */
  truncatedFromLineEnd?: number | null;
  symbolName?: string;
  snippet?: string;
  /** Semantic summary of the cited symbol ("what this does"), when available. */
  summary?: string | null;
  claim?: string | null;
  commitHash?: string | null;
  nodeStableKey?: string | null;
  trustLevel?: string | null;
  /**
   * Re-verification result against the latest complete analysis:
   * fresh = symbol hash unchanged; stale = changed or removed;
   * unknown = not node-addressable (docs/synthesis) — never shown as "Current".
   */
  staleness: "fresh" | "stale" | "unknown";
  verification?: ReceiptVerification;
  confidence?: ConfidenceLevel;
  ageLabel?: string;
}

export interface ContentBlock {
  title: string;
  body: string;
  receipts: SourceReceipt[];
}

export interface SectionUnknown {
  kind: string;
  detail?: string | null;
  claim?: string;
}

export interface OnboardingSection {
  id: SectionId;
  sectionId?: string;
  label: string;
  type?: string;
  status: SectionStatus;
  reviewStatus?: string;
  confidence: ConfidenceLevel;
  /** Mechanical explanation of the grade ("7/9 tracked claims cite receipts · …"). */
  confidenceReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  blocks: ContentBlock[];
  /** Deterministic Mermaid diagrams embedded in this section. */
  diagrams?: Array<{ kind: string; mermaid: string }>;
  /** Honest unknowns: gaps the generator refused to invent content for. */
  unknowns?: SectionUnknown[];
  analyzedCommit?: string;
}

/** Honest denominators for the "critical 25%" story — counts over stored rows. */
export interface PackageCoverage {
  snapshotCreatedAt: string;
  files: { analyzed: number; unsupported: number | null; cited: number };
  symbols: { total: number; cited: number };
  workflows: { total: number; covered: number };
  tutorialCount: number;
  languages: Record<string, unknown> | null;
  rankingSignals: Array<{ signal: string; weight: number }>;
}

export interface OnboardingPackage {
  /** Absent only on the synthetic "missing" placeholder. */
  id?: string;
  projectId: string;
  role: string;
  status: PackageStatus;
  generatedAt: string;
  reviewedBy?: string;
  analyzedCommit?: string;
  coverage?: PackageCoverage | null;
  sections: OnboardingSection[];
}

/** POST /projects/:id/ask response (grounded Q&A with receipts). */
export interface AskAnswer {
  answerMarkdown: string;
  claims: Array<{ claim: string; receiptIds: string[]; confidence: ConfidenceLevel }>;
  receipts: Array<{
    receiptId: string;
    filePath?: string;
    symbolName?: string;
    lineStart?: number;
    lineEnd?: number;
    snippet?: string;
    trustLevel?: string;
  }>;
  confidence: ConfidenceLevel;
  unknowns: SectionUnknown[];
  meta: { snapshotId: string; role: string; intent?: string; validationIssues?: string[]; retried?: boolean };
}

/** GET /projects/:id/onboarding/provenance — "how this was made". */
export interface PackageProvenance {
  package: {
    id: string;
    role: string;
    analyzedCommit: string;
    branch: string;
    generatedAt: string;
    semanticDepth: string;
    privacyMode: string;
  };
  models: Array<{
    provider: string;
    model: string;
    tier: string | null;
    calls: number;
    cachedCalls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  sections: Array<{
    sectionId: string;
    type: string;
    title: string;
    confidence: ConfidenceLevel;
    confidenceReason: string;
    reviewStatus: string;
    receiptCount: number;
    promptVersion: string | null;
    retrieval: { seeds?: number; candidates?: number; selected?: number; views?: string[] } | null;
    validation: { issues: string[]; retried: boolean; hardFailure: boolean };
    voiceLintHits: string[];
    inlineCitations: {
      resolved?: number;
      dropped?: string[];
      unverified_marked?: number;
      unverified_unmatched?: number;
    } | null;
    claims: { total: number; cited: number; low: number };
    unknownsCount: number;
  }>;
}

/** One onboarding package card: (scope, role, commit, branch) with status rollups. */
export interface PackageCard {
  id: string;
  snapshot_id: string;
  role: string;
  status: PackageStatus;
  analyzed_commit: string;
  branch: string;
  created_at: string;
  updated_at: string;
  scope_name: string;
  path_prefix: string;
  scope_kind: string;
  semantic_depth: string;
  privacy_mode: string;
  section_count: number;
  stale_sections: number;
  approved_sections: number;
  low_confidence_sections: number;
  tutorial_count: number;
  is_latest_commit: boolean;
}
