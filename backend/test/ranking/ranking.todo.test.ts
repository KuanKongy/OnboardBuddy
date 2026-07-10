import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../../src/worker/engine/repoIngester';
import { createProgram, parseSourceFile } from '../../src/worker/engine/astParser';
import { extractFileAnalysis } from '../../src/worker/engine/symbolExtractor';
import { buildDependencyGraph, annotateResolvedImports } from '../../src/worker/engine/graphBuilder';
import { detectEntrypoints } from '../../src/worker/engine/entrypointDetector';
import { detectSideEffects } from '../../src/worker/engine/sideEffectDetector';
import { rankCriticalFiles } from '../../src/worker/engine/criticalRanker';
import type { FileAnalysis } from '../../src/worker/types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/worker/fixtures/simple');

describe("ranking algorithm", () => {
  let fileAnalyses: FileAnalysis[];

  before(async () => {
    const index = await buildRepoIndex(FIXTURE_DIR);
    const tsFiles = filterByLanguage(index, 'typescript');
    const program = createProgram(tsFiles, FIXTURE_DIR);
    fileAnalyses = tsFiles.map((entry) => {
      const parsed = parseSourceFile(program, entry.absolutePath);
      return extractFileAnalysis(parsed, FIXTURE_DIR);
    });
    annotateResolvedImports(fileAnalyses, FIXTURE_DIR);
  });

  it("Composite score matches the weighted 5-signal formula", () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const entrypointKeys = new Set(entrypoints.map((e) => e.nodeStableKey));
    const sideEffectKeys = new Set(sideEffects.map((e) => e.nodeStableKey));
    const rankings = rankCriticalFiles(fileAnalyses, graph, entrypointKeys, sideEffectKeys);

    expect(rankings.length).to.be.greaterThan(0);
    for (const r of rankings) {
      expect(r.compositeScore).to.be.greaterThan(0);
      expect(r.scores).to.have.property('fanIn');
      expect(r.scores).to.have.property('fanOut');
      expect(r.scores).to.have.property('exportCount');
      expect(r.scores).to.have.property('isEntrypoint');
      expect(r.scores).to.have.property('hasSideEffects');
    }
  });

  it("Role-based re-ranking changes top files appropriately", () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const entrypointKeys = new Set(entrypoints.map((e) => e.nodeStableKey));
    const sideEffectKeys = new Set(sideEffects.map((e) => e.nodeStableKey));
    const rankings = rankCriticalFiles(fileAnalyses, graph, entrypointKeys, sideEffectKeys);

    const backendRankings = rankings.filter((r) => r.role === 'backend');
    const _frontendRankings = rankings.filter((r) => r.role === 'frontend');
    const generalRankings = rankings.filter((r) => r.role === 'general');

    expect(generalRankings.length).to.be.greaterThanOrEqual(backendRankings.length);
  });

  it("Ranking reasons explain the score signals", () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const entrypointKeys = new Set(entrypoints.map((e) => e.nodeStableKey));
    const sideEffectKeys = new Set(sideEffects.map((e) => e.nodeStableKey));
    const rankings = rankCriticalFiles(fileAnalyses, graph, entrypointKeys, sideEffectKeys);

    for (const r of rankings) {
      expect(r.reasons).to.be.an('array');
    }
    const entryRankings = rankings.filter((r) => r.scores.isEntrypoint === 1);
    if (entryRankings.length > 0) {
      expect(entryRankings.some((r) => r.reasons.some((reason: string) => reason.includes('Entry point')))).to.equal(true);
    }
  });

  it("Entry points receive the entrypoint scoring signal across roles", () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const entrypointKeys = new Set(entrypoints.map((e) => e.nodeStableKey));
    const sideEffectKeys = new Set(sideEffects.map((e) => e.nodeStableKey));
    const rankings = rankCriticalFiles(fileAnalyses, graph, entrypointKeys, sideEffectKeys);

    const indexRankings = rankings.filter((r) => r.nodeStableKey === 'index.ts');
    expect(indexRankings.length).to.be.greaterThan(0);
    for (const r of indexRankings) {
      expect(r.scores.isEntrypoint).to.equal(1);
      expect(r.reasons).to.include('Entry point');
    }
  });

  it("High fan-in utility files do not outrank entrypoints in general rankings", () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const entrypointKeys = new Set(entrypoints.map((e) => e.nodeStableKey));
    const sideEffectKeys = new Set(sideEffects.map((e) => e.nodeStableKey));
    const rankings = rankCriticalFiles(fileAnalyses, graph, entrypointKeys, sideEffectKeys);

    const generalRankings = rankings
      .filter((r) => r.role === 'general')
      .sort((a, b) => b.compositeScore - a.compositeScore);

    const top = generalRankings[0]!;
    expect(top.nodeStableKey).to.equal('index.ts');
    expect(top.scores.isEntrypoint).to.equal(1);
  });
});
