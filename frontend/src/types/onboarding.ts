export type PackageStatus = "missing" | "generating" | "draft" | "approved" | "stale";
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

export interface SourceReceipt {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  symbolName?: string;
  snippet?: string;
  /** Semantic summary of the cited symbol ("what this does"), when available. */
  summary?: string | null;
  claim?: string;
  commitHash?: string;
  nodeStableKey?: string;
  staleness: "fresh" | "stale";
  confidence: ConfidenceLevel;
  ageLabel: string;
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
  reviewedBy?: string;
  reviewedAt?: string;
  blocks: ContentBlock[];
  /** Deterministic Mermaid diagrams embedded in this section. */
  diagrams?: Array<{ kind: string; mermaid: string }>;
  /** Honest unknowns: gaps the generator refused to invent content for. */
  unknowns?: SectionUnknown[];
  analyzedCommit?: string;
}

export interface OnboardingPackage {
  /** Absent only on the synthetic "missing" placeholder. */
  id?: string;
  projectId: string;
  role: string;
  status: PackageStatus;
  generatedAt: string;
  reviewedBy?: string;
  sections: OnboardingSection[];
}

/** One onboarding package card: (scope, role, commit) with status rollups. */
export interface PackageCard {
  id: string;
  role: string;
  status: PackageStatus;
  analyzed_commit: string;
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
