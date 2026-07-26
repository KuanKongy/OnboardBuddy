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

  it('composite score is the weighted sum over the signals that APPLY', () => {
    // Signals that cannot be measured for a target type are excluded from the
    // denominator rather than scored as zero. Scoring them as zero silently
    // capped every workflow at 0.55 (fan-in .15 + exports .15 + tests .05 +
    // config .05 + churn .05 unreachable) while a file could reach 1.0, so a
    // top-ranked flow displayed as 55 with nothing explaining the ceiling.
    expect(rankings.length).to.be.greaterThan(0);
    for (const r of rankings) {
      const inapplicable = new Set(r.inapplicableSignals);
      const signals = (Object.keys(CANDIDATE_WEIGHTS) as Array<keyof typeof CANDIDATE_WEIGHTS>)
        .filter((s) => !inapplicable.has(s));
      const applicableWeight = signals.reduce((sum, s) => sum + CANDIDATE_WEIGHTS[s], 0);
      const recomputed =
        signals.reduce((sum, s) => sum + r.breakdown[s] * CANDIDATE_WEIGHTS[s], 0) / applicableWeight;
      expect(Math.abs(recomputed - r.score), r.stableKey).to.be.lessThan(0.01);
    }
  });

  it('every target type can reach the full 0–1 range', () => {
    // The regression guard for the ceiling: whatever ranks top of its type
    // should read as ~100, not as an unexplained fraction of it.
    const byType = new Map<string, number>();
    for (const r of rankings) {
      byType.set(r.targetType, Math.max(byType.get(r.targetType) ?? 0, r.score));
    }
    expect(byType.size).to.be.greaterThan(0);
    for (const [type, best] of byType) {
      expect(best, `${type} tops out at ${best}`).to.be.greaterThan(0.6);
      expect(best).to.be.at.most(1);
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
