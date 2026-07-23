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

// ─── Full repository inventory (all files, not just parseable source) ────────

export type FileCategory =
  | 'source' | 'test' | 'config' | 'schema' | 'migration' | 'doc' | 'script' | 'asset' | 'other';

export type TrustLevel = 'code' | 'config' | 'tests' | 'docs' | 'llm_inference';

export interface RepoFileRecord {
  relativePath: string;   // repo-local, '/' separated (stable key)
  absolutePath: string;
  language: string;       // 'typescript' | 'javascript' | 'json' | 'markdown' | 'yaml' | 'sql' | ...
  category: FileCategory;
  supported: boolean;     // parseable by a registered LanguageParser
  trustLevel: Exclude<TrustLevel, 'llm_inference'>;
  sizeBytes: number;
  lineCount: number | null;
  hash: string;           // sha256 of contents
}

export interface LanguageInventory {
  supported: Record<string, number>;
  unsupported: Record<string, number>;
  evidenceOnly: Record<string, number>;
  supportedFileCount: number;
  unsupportedFileCount: number;
}

export interface RepoPackage {
  root: string;                       // repo-relative dir ('' = repo root)
  packageJsonPath: string;
  name: string | null;
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
  workspaces: string[];
}

export interface RepoConfigFile {
  path: string;
  kind: 'package_json' | 'tsconfig' | 'vite' | 'docker' | 'compose' | 'github_actions'
    | 'env_example' | 'eslint' | 'deploy' | 'sql_migration' | 'other';
  facts: Record<string, unknown>;
}

export interface RepoInventory {
  packages: RepoPackage[];
  configs: RepoConfigFile[];
  dockerServices: Array<{ name: string; buildContext: string | null }>;
  detectedFrameworks: string[];
}

export interface ScopeProposal {
  pathPrefix: string;                 // '' = whole repo
  displayName: string;
  kind: 'whole_repo' | 'workspace_package' | 'docker_service' | 'directory' | 'manual';
  detectedFrom: string;
}

// ─── Evidence graph (persisted as graph_nodes / graph_edges) ─────────────────

export type EvidenceNodeType =
  | 'file' | 'module' | 'function' | 'method' | 'class' | 'interface' | 'type'
  | 'enum' | 'variable' | 'entrypoint' | 'schema' | 'test' | 'config' | 'doc' | 'external';

export interface EvidenceNode {
  stableKey: string;
  type: EvidenceNodeType;
  name: string;
  filePath: string | null;     // null for external nodes
  lineStart?: number | null;
  lineEnd?: number | null;
  hash?: string | null;
  signatureHash?: string | null;
  bodyHash?: string | null;
  trustLevel: TrustLevel;
  exported?: boolean;
  snippet?: string | null;
  metadata: Record<string, unknown>;
}

export type EvidenceEdgeType =
  | 'imports' | 'exports' | 'calls' | 'extends' | 'implements' | 'contains'
  | 'registers_callback' | 'handles_route' | 'touches_schema'
  | 'reads_env' | 'queries_database' | 'writes_database'
  | 'enqueues_job' | 'handles_job' | 'http_calls'
  | 'tests' | 'documents' | 'depends_on' | 'references_external';

export interface EvidenceEdge {
  sourceKey: string;
  targetKey: string;
  type: EvidenceEdgeType;
  confidence: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
}

export interface EvidenceGraph {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
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
  lineStart?: number;
  lineEnd?: number;
  callsSymbols?: string[];
  resolvedCalls?: ResolvedCall[];
  snippet?: string;
  signatureHash?: string;
  bodyHash?: string;
  isTrivial?: boolean;
}

/** A call whose target the TypeChecker resolved to a repo-local declaration. */
export interface ResolvedCall {
  /** Callee expression text as written, e.g. `queue.add` or `signToken`. */
  callee: string;
  /** Repo-relative path ('/'-separated) of the file declaring the target. */
  targetRelativePath: string;
  targetName: string;
  /** Set when the target is a class member. */
  targetParentName?: string;
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
  // evidence identity (doc/Pipeline.md "Symbol extraction")
  stableKey?: string;        // relative/path.ts#SymbolName
  signatureHash?: string;
  bodyHash?: string;
  snippet?: string;          // capped source snippet for prompts/receipts
  isTrivial?: boolean;       // deterministic facts-only candidate, no LLM call
  resolvedCalls?: ResolvedCall[];
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
  namespaceImport?: string;  // import * as X from '...'
  isTypeOnly: boolean;
}

export interface ExportRecord {
  fromFile: string;
  namedExports: string[];
  defaultExport?: string;
  isReExport: boolean;
  isDefault?: boolean;       // export default expression
  expression?: string;       // text of default export expression
  sourceSpecifier?: string;  // for re-exports: the specifier being re-exported
}

// ─── Per-file parse result ────────────────────────────────────────────────────

/** An HTTP route registration (`router.get('/x', handler)`) found in a file. */
export interface RouteRegistration {
  method: string;      // GET / POST / ...
  routePath: string;   // '/projects/:id'
  /** Symbol name of the handler in `handlerRelativePath` (synthesized for inline handlers). */
  handlerSymbolName?: string;
  /** Declaring class when the handler is a class method — method nodes are keyed `file#Class.method`. */
  handlerParentName?: string;
  /** Repo-relative file declaring the handler (this file for inline handlers). */
  handlerRelativePath?: string;
  line: number;
}

/** A sub-router mount (`app.use('/api', router)`) found in a file. */
export interface RouterMount {
  /** Mount path literal; '' when mounted without a path (`app.use(router)`). */
  prefix: string;
  /** Repo-relative file the mounted router identifier resolves to. */
  targetRelativePath: string;
  line: number;
}

export interface FileAnalysis {
  filePath: string;
  relativePath: string;
  symbols: SymbolInfo[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  /** HTTP route registrations found anywhere in the file (AST-detected). */
  routeRegistrations?: RouteRegistration[];
  /** Express-style sub-router mounts — lets route paths resolve to full paths. */
  routerMounts?: RouterMount[];
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
