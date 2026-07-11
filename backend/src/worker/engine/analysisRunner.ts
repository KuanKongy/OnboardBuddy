import type {
  AnalysisSnapshot,
  FileAnalysis,
  RepoFileRecord,
  LanguageInventory,
  RepoInventory,
  ScopeProposal,
} from '../types/analysis.js';
import {
  buildRepoIndex,
  scanRepositoryFiles,
  buildLanguageInventory,
  detectRepoInventory,
} from './repoIngester.js';
import { proposeScopes } from './scopeProposal.js';
import { typescriptParser } from './parserInterface.js';
import { buildDependencyGraph, annotateResolvedImports } from './graphBuilder.js';

export interface RunAnalysisOptions {
  projectId: string;
  triggeredBy: string;
  repoPath: string;
  ignoredPaths?: string[];
  fileLimit?: number;
  /** Scope boundary ('' = whole repo). Only files under it are parsed. */
  pathPrefix?: string;
}

export interface ExtendedAnalysisSnapshot extends AnalysisSnapshot {
  fileRecords: RepoFileRecord[];
  languageInventory: LanguageInventory;
  inventory: RepoInventory;
  scopeProposals: ScopeProposal[];
}

/**
 * Deterministic analysis pass: inventory + language guardrail input + AST
 * parsing via the parser interface + dependency graph. Callers (worker,
 * preflight) check the language guardrail on `languageInventory` — this
 * function itself never bluffs about unsupported repos, it just reports.
 */
export async function runAnalysis(opts: RunAnalysisOptions): Promise<ExtendedAnalysisSnapshot> {
  const startMs = Date.now();
  const errors: string[] = [];

  // 1. Full file inventory (every file: source, configs, docs, schema)
  const fileRecords = await scanRepositoryFiles(opts.repoPath, {
    ignoredPaths: opts.ignoredPaths,
    pathPrefix: opts.pathPrefix,
  });
  const languageInventory = buildLanguageInventory(fileRecords);
  const inventory = await detectRepoInventory(opts.repoPath, fileRecords);
  const scopeProposals = proposeScopes(inventory, fileRecords);

  // 2. Index parseable source files (scope-bounded, privacy-filtered)
  const repoIndex = await buildRepoIndex(opts.repoPath, {
    ignoredPaths: opts.ignoredPaths,
    fileLimit: opts.fileLimit,
    pathPrefix: opts.pathPrefix,
  });
  const parseableFiles = repoIndex.files.filter((f) => typescriptParser.supports(f.absolutePath));

  // 3. One parser context per run (TS Program spans all files for cross-file
  //    call resolution through the TypeChecker)
  const parserCtx = await typescriptParser.createContext(parseableFiles, opts.repoPath);

  // 4. Extract symbols + imports from each file
  const fileAnalyses: FileAnalysis[] = [];
  for (const entry of parseableFiles) {
    try {
      const analysis = typescriptParser.parseFile(parserCtx, entry);
      if (analysis.hasParseErrors) {
        errors.push(...analysis.parseErrors.map((e) => `${entry.relativePath}: ${e}`));
      }
      fileAnalyses.push(analysis);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to parse ${entry.relativePath}: ${msg}`);
    }
  }

  // 5. Annotate resolved import paths
  annotateResolvedImports(fileAnalyses, opts.repoPath);

  // 6. Build file-level dependency graph (workflow traversal + interim UI)
  const graph = buildDependencyGraph(fileAnalyses, opts.repoPath);

  return {
    projectId: opts.projectId,
    triggeredBy: opts.triggeredBy,
    repoIndex,
    fileAnalyses,
    graph,
    createdAt: new Date(),
    durationMs: Date.now() - startMs,
    errors,
    fileRecords,
    languageInventory,
    inventory,
    scopeProposals,
  };
}
