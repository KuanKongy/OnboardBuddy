// ─── File-level index ────────────────────────────────────────────────────────

export type SupportedLanguage = 'typescript' | 'javascript';

export interface FileEntry {
  relativePath: string;
  absolutePath: string;
  language: SupportedLanguage;
  sizeBytes: number;
}

export interface RepoIndex {
  rootPath: string;
  files: FileEntry[];
  detectedLanguage: SupportedLanguage;
  scannedAt: Date;
}

// ─── Symbol types ─────────────────────────────────────────────────────────────

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'arrow-function'
  | 'method'
  | 'variable'
  | 'enum';

export interface SourceLocation {
  line: number;
  column: number;
}

// ─── Rich symbol sub-types ────────────────────────────────────────────────────

export interface NamedImportItem {
  name: string;
  isTypeOnly: boolean;
  alias: string | null;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  default: string | null;
  accessibility?: 'public' | 'private' | 'protected';
}

export interface PropertyInfo {
  name: string;
  type: string;
  optional?: boolean;
  readonly?: boolean;
  accessibility?: 'public' | 'private' | 'protected';
  static?: boolean;
}

export interface MethodInfo {
  name: string;
  signature: string;
  parameters: ParameterInfo[];
  returnType: string;
  accessibility: 'public' | 'private' | 'protected';
  static: boolean;
  isAsync: boolean;
}

export interface ConstructorInfo {
  parameters: ParameterInfo[];
}

export interface EnumMember {
  name: string;
  value: string;
}

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  filePath: string;
  start: SourceLocation;
  end: SourceLocation;
  exported: boolean;
  isDefault: boolean;
  jsDoc?: string;
  // variables
  typeAnnotation?: string;
  initializer?: string;
  // functions / arrow-functions
  signature?: string;
  parameters?: ParameterInfo[];
  returnType?: string;
  isAsync?: boolean;
  callsSymbols?: string[];
  // interfaces
  properties?: PropertyInfo[];
  extends?: string[];
  // classes (extends reused from interfaces)
  extendsClass?: string | null;
  implements?: string[];
  constructors?: ConstructorInfo[];
  methods?: MethodInfo[];
  // type aliases
  definition?: string;
  // enums
  members?: EnumMember[];
}

// ─── Import / export edges ────────────────────────────────────────────────────

export interface ImportRecord {
  fromFile: string;
  toSpecifier: string;       // raw specifier as written in source
  resolvedPath?: string;     // absolute path if resolvable
  namedImports: NamedImportItem[];
  defaultImport?: string;
  isTypeOnly: boolean;
}

export interface ExportRecord {
  fromFile: string;
  namedExports: string[];
  defaultExport?: string;
  isReExport: boolean;
  sourceSpecifier?: string;  // for re-exports: the specifier being re-exported
}

// ─── Per-file parse result ────────────────────────────────────────────────────

export interface FileAnalysis {
  filePath: string;
  relativePath: string;
  symbols: SymbolInfo[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  hasParseErrors: boolean;
  parseErrors: string[];
}

// ─── Dependency graph ─────────────────────────────────────────────────────────

export type NodeKind = 'module' | 'class' | 'function' | 'interface';

export interface GraphNode {
  id: string;                // unique: relativePath or relativePath#SymbolName
  label: string;
  kind: NodeKind;
  filePath: string;
  metadata: {
    exportedSymbols: string[];
    importCount: number;
    dependentCount: number;
    lineCount?: number;
  };
}

export interface GraphEdge {
  id: string;
  source: string;            // GraphNode.id
  target: string;            // GraphNode.id
  kind: 'imports' | 'extends' | 'implements' | 'calls' | 're-exports';
  weight: number;            // 1 for import, higher for call-graph edges
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryPoints: string[];     // GraphNode.ids identified as entry points
}

// ─── Slim output types ───────────────────────────────────────────────────────

export interface SlimParameter {
  name: string;
  type: string;
  optional?: true;
  default?: string;
  accessibility?: 'public' | 'private' | 'protected';
}

export interface SlimMethod {
  name: string;
  signature: string;
  parameters: SlimParameter[];
  isAsync: boolean;
  accessibility: string;
}

export interface SlimSymbol {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  jsDoc?: string;
  typeAnnotation?: string;
  initializer?: string;
  signature?: string;
  parameters?: SlimParameter[];
  isAsync?: boolean;
  callsSymbols?: string[];
  properties?: { name: string; type: string }[];
  extends?: string[];
  extendsClass?: string;
  implements?: string[];
  constructors?: { parameters: SlimParameter[] }[];
  methods?: SlimMethod[];
  definition?: string;
  members?: EnumMember[];
}

export interface SlimImport {
  toSpecifier: string;
  namedImports: string[];
  isTypeOnly?: true;
}

export interface SlimFileAnalysis {
  relativePath: string;
  symbols: SlimSymbol[];
  imports: SlimImport[];
}

export interface SlimRepoIndex {
  files: { relativePath: string; language: SupportedLanguage; sizeBytes: number }[];
  detectedLanguage: SupportedLanguage;
  scannedAt: Date;
}

export interface SlimGraph {
  nodes: { id: string; label: string; kind: NodeKind; metadata: { exportedSymbols: string[]; importCount: number; dependentCount: number } }[];
  edges: { id: string; source: string; target: string; kind: string }[];
  entryPoints: string[];
}

export interface SlimSnapshot {
  projectId: string;
  triggeredBy: string;
  repoIndex: SlimRepoIndex;
  fileAnalyses: SlimFileAnalysis[];
  graph: SlimGraph;
  createdAt: Date;
}

// ─── Analysis snapshot (stored in DB) ────────────────────────────────────────

export interface AnalysisSnapshot {
  projectId: string;
  triggeredBy: string;       // userId
  repoIndex: RepoIndex;
  fileAnalyses: FileAnalysis[];
  graph: DependencyGraph;
  createdAt: Date;
  durationMs: number;
  errors: string[];
}
