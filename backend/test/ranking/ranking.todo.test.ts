import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, scanRepositoryFiles, detectRepoInventory } from '../../src/worker/engine/repoIngester';
import { typescriptParser } from '../../src/worker/engine/parserInterface';
import { detectEntrypoints } from '../../src/worker/engine/entrypointDetector';
import { detectSideEffects } from '../../src/worker/engine/sideEffectDetector';
import { scanConfigNodes } from '../../src/worker/engine/configScanner';
import { ingestDocs } from '../../src/worker/engine/docsIngester';
import { buildEvidenceGraph } from '../../src/worker/engine/evidenceGraphBuilder';
import { extractWorkflows } from '../../src/worker/engine/workflowExtractor';
import { rankCandidates, CANDIDATE_WEIGHTS, type CandidateRanking } from '../../src/worker/engine/candidateRanker';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/worker/fixtures/simple');

describe('ranking algorithm (Phase A candidate ranker)', () => {
  let rankings: CandidateRanking[];

  before(async () => {
    const records = await scanRepositoryFiles(FIXTURE_DIR);
    const inventory = await detectRepoInventory(FIXTURE_DIR, records);
    const index = await buildRepoIndex(FIXTURE_DIR);
    const ctx = await typescriptParser.createContext(index.files, FIXTURE_DIR);
    const fileAnalyses = index.files.map((f) => typescriptParser.parseFile(ctx, f));
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const configNodes = scanConfigNodes(records, inventory);
    const docs = ingestDocs(records, new Set(records.map((r) => r.relativePath)));
    const graph = buildEvidenceGraph({
      fileAnalyses, fileRecords: records, entrypoints, sideEffects, configNodes, docs, rootPath: FIXTURE_DIR,
    });
    const workflows = extractWorkflows({ graph, entrypoints, sideEffects });
    rankings = rankCandidates({ graph, entrypoints, sideEffects, workflows });
  });

  it('composite score is the weighted sum of the spec signals', () => {
    expect(rankings.length).to.be.greaterThan(0);
    for (const r of rankings) {
      const recomputed = (Object.keys(CANDIDATE_WEIGHTS) as Array<keyof typeof CANDIDATE_WEIGHTS>)
        .reduce((sum, signal) => sum + r.breakdown[signal] * CANDIDATE_WEIGHTS[signal], 0);
      expect(Math.abs(recomputed - r.score)).to.be.lessThan(0.01);
    }
  });

  it('ranking reasons explain the score signals', () => {
    const entryRankings = rankings.filter(
      (r) => r.targetType !== 'workflow' && r.breakdown.entrypointParticipation === 1,
    );
    expect(entryRankings.length).to.be.greaterThan(0);
    for (const r of entryRankings) {
      expect(r.reasons).to.include('Entry point');
    }
  });

  it('entry point files receive the entrypoint signal', () => {
    const routesFile = rankings.find((r) => r.targetType === 'file' && r.stableKey === 'routes/authRoutes.ts')!;
    expect(routesFile.breakdown.entrypointParticipation).to.equal(1);
  });

  it('workflow-participating handlers outrank passive utility files', () => {
    const files = rankings.filter((r) => r.targetType === 'file');
    const routes = files.find((r) => r.stableKey === 'routes/authRoutes.ts')!;
    const util = files.find((r) => r.stableKey === 'utils/textUtil.ts')!;
    expect(routes.score).to.be.greaterThan(util.score);
  });
});
