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
  importCount: number;
  dependentCount: number;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  metadata: GraphNodeMetadata;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryPoints: string[];
}

export interface AnalysisSnapshot {
  projectId: string;
  triggeredBy: string;
  repoIndex: RepoIndex;
  fileAnalyses: FileAnalysis[];
  graph: DependencyGraph;
  createdAt: string;
}
