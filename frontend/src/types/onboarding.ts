export type PackageStatus = "missing" | "generating" | "draft" | "approved" | "stale";
export type ConfidenceLevel = "high" | "medium" | "low";
export type SectionStatus = "complete" | "stale" | "missing";

export type SectionId =
  | "start-here"
  | "entry-points"
  | "critical-25"
  | "workflows"
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
}

export interface OnboardingPackage {
  projectId: string;
  role: string;
  status: PackageStatus;
  generatedAt: string;
  reviewedBy?: string;
  sections: OnboardingSection[];
}
