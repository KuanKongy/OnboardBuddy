import type { AnalysisSnapshot, FileAnalysis } from '../types/analysis.js';
import { buildRepoIndex, filterByLanguage } from './repoIngester.js';
import { createProgram, parseSourceFile } from './astParser.js';
import { extractFileAnalysis } from './symbolExtractor.js';
import { buildDependencyGraph, annotateResolvedImports } from './graphBuilder.js';

export interface RunAnalysisOptions {
  projectId: string;
  triggeredBy: string;
  repoPath: string;
}

export async function runAnalysis(opts: RunAnalysisOptions): Promise<AnalysisSnapshot> {
  const startMs = Date.now();
  const errors: string[] = [];

  // 1. Index repo files
  const repoIndex = await buildRepoIndex(opts.repoPath);
  const tsFiles = filterByLanguage(repoIndex, 'typescript');

  // 2. Create TS compiler program over all files at once (needed for cross-file type info)
  const program = createProgram(tsFiles, opts.repoPath);

  // 3. Extract symbols + imports from each file
  const fileAnalyses: FileAnalysis[] = [];
  for (const entry of tsFiles) {
    try {
      const parsed = parseSourceFile(program, entry.absolutePath);
      const analysis = extractFileAnalysis(parsed, opts.repoPath);
      if (analysis.hasParseErrors) {
        errors.push(...analysis.parseErrors.map((e) => `${entry.relativePath}: ${e}`));
      }
      fileAnalyses.push(analysis);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to parse ${entry.relativePath}: ${msg}`);
    }
  }

  // 4. Annotate resolved import paths
  annotateResolvedImports(fileAnalyses, opts.repoPath);

  // 5. Build dependency graph
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
  };
}
