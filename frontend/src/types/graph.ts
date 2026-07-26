export interface RepoFile {
  relativePath: string;
  language: string;
  sizeBytes: number;
}

export interface RepoIndex {
  files: RepoFile[];
  detectedLanguage: string;
  scannedAt: string;
}

export interface SymbolParameter {
  name: string;
  type?: string;
  accessibility?: string;
}

export interface FileSymbol {
  name: string;
  kind: string;
  exported: boolean;
  signature?: string;
  initializer?: string;
  typeAnnotation?: string;
  definition?: string;
  isAsync?: boolean;
  parameters?: SymbolParameter[];
  callsSymbols?: string[];
  jsDoc?: string;
  [key: string]: unknown;
}

export interface FileImport {
  toSpecifier: string;
  namedImports: string[];
  isTypeOnly?: boolean;
}

export interface FileAnalysis {
  relativePath: string;
  symbols: FileSymbol[];
  imports: FileImport[];
}

export interface GraphNodeMetadata {
  exportedSymbols: string[];
  /** Distinct internal files this file imports (deduped edges). */
  importCount: number;
  /** Distinct third-party/boundary imports (not drawn as edges). */
  externalImportCount?: number;
  /** Distinct internal files importing this file (deduped edges). */
  dependentCount: number;
  /** Symbols this file declares. Context on the card, not a drill affordance. */
  symbolCount?: number;
  /** Symbol-level only: whether the symbol is part of the file's public surface. */
  exported?: boolean;
  /**
   * What this file does, one line, from the stored FILE semantic record.
   * Null when the analyzer produced no record for it — the card then says so
   * rather than inventing a description from the path.
   */
  summary?: string | null;
  /** The record's own classification: "route file", "service", "config glue". */
  role?: string | null;
  summaryConfidence?: string | null;
  /** Group nodes only: files folded into this group. */
  fileCount?: number;
  /** Group nodes only: what `fileCount` counts, when it is not files. */
  groupNoun?: string;
  /** Group nodes only: links whose two ends are both inside the group. */
  internalImportCount?: number;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  /**
   * The file this node lives in, when the id is not already that path. Set for
   * class/interface nodes, whose id is `<path>#<Name>` and whose label is the
   * bare name — without it the card can neither say where the class is nor
   * colour itself by the file's role.
   */
  filePath?: string;
  metadata: GraphNodeMetadata;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  /** Edge strength (repeat import statements); drives the "strongest edges" cap. */
  weight?: number;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryPoints: string[];
}

// The architecture map is modelled in `lib/architectureData.ts`
// (`ArchitectureCluster` / `ArchitectureEdge` / `ArchitectureResponse`), which
// is what the API actually returns and what every renderer imports. A second,
// never-imported `ArchitectureComponent` / `ArchitectureGraph` pair used to sit
// here describing a shape the server has never sent, with its own conflicting
// `ArchitectureEdge`.

export interface AnalysisSnapshot {
  projectId: string;
  triggeredBy: string;
  repoIndex: RepoIndex;
  fileAnalyses: FileAnalysis[];
  graph: DependencyGraph;
  createdAt: string;
}
