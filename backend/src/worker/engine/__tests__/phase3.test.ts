import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, scanRepositoryFiles, detectRepoInventory } from '../repoIngester';
import { typescriptParser } from '../parserInterface';
import { detectEntrypoints } from '../entrypointDetector';
import { detectSideEffects } from '../sideEffectDetector';
import { scanConfigNodes } from '../configScanner';
import { ingestDocs } from '../docsIngester';
import { buildEvidenceGraph } from '../evidenceGraphBuilder';
import { extractWorkflows, type ExtractedWorkflow } from '../workflowExtractor';
import {
  rankCandidates,
  gateSymbolsForDepth,
  CANDIDATE_WEIGHTS,
  type CandidateRanking,
} from '../candidateRanker';
import { fetchChurnSignals, type ChurnStats } from '../churnService';
import { clusterArchitecture } from '../architectureClusterer';
import type { EvidenceGraph, RepoInventory } from '../../types/analysis';
import type { DetectedEntrypoint } from '../entrypointDetector';
import type { DetectedSideEffect } from '../sideEffectDetector';

const SIMPLE_DIR = path.resolve(__dirname, '../../fixtures/simple');

let graph: EvidenceGraph;
let inventory: RepoInventory;
let entrypoints: DetectedEntrypoint[];
let sideEffects: DetectedSideEffect[];
let workflows: ExtractedWorkflow[];
let rankings: CandidateRanking[];

before(async () => {
  const records = await scanRepositoryFiles(SIMPLE_DIR);
  inventory = await detectRepoInventory(SIMPLE_DIR, records);
  const index = await buildRepoIndex(SIMPLE_DIR);
  const ctx = await typescriptParser.createContext(index.files, SIMPLE_DIR);
  const fileAnalyses = index.files.map((f) => typescriptParser.parseFile(ctx, f));
  entrypoints = detectEntrypoints(fileAnalyses);
  sideEffects = detectSideEffects(fileAnalyses);
  const configNodes = scanConfigNodes(records, inventory);
  const docs = ingestDocs(records, new Set(records.map((r) => r.relativePath)));
  graph = buildEvidenceGraph({
    fileAnalyses, fileRecords: records, entrypoints, sideEffects, configNodes, docs, rootPath: SIMPLE_DIR,
  });
  workflows = extractWorkflows({ graph, entrypoints, sideEffects });
  rankings = rankCandidates({ graph, entrypoints, sideEffects, workflows });
});

describe('phase 3 — side effect detection over snippets', () => {
  it('detects the sessionStore INSERT as a database write', () => {
    const write = sideEffects.find(
      (se) => se.kind === 'database_write' && se.symbolStableKey === 'services/sessionStore.ts#saveSession',
    );
    expect(write, 'saveSession database_write').to.exist;
    expect(write!.evidence).to.match(/INSERT/i);
  });
});

describe('phase 3 — candidate ranker (Phase A)', () => {
  it('spec weights sum to 1', () => {
    const total = Object.values(CANDIDATE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(total * 1000) / 1000).to.equal(1);
  });

  it('every ranking has normalized breakdown values and reasons', () => {
    expect(rankings.length).to.be.greaterThan(0);
    for (const r of rankings) {
      expect(r.score).to.be.at.least(0).and.at.most(1);
      for (const v of Object.values(r.breakdown)) {
        expect(v).to.be.at.least(0).and.at.most(1);
      }
    }
    // Scores are never presented without reasons: everything scoring > 0.1
    // must carry at least one human-readable reason.
    for (const r of rankings.filter((x) => x.score > 0.1)) {
      expect(r.reasons.length, `${r.stableKey} reasons`).to.be.greaterThan(0);
    }
  });

  it('ranks workflow participants above unreferenced symbols', () => {
    const symbolRanks = rankings.filter((r) => r.targetType === 'symbol');
    const handler = symbolRanks.find((r) => r.stableKey === 'routes/authRoutes.ts#loginHandler')!;
    const bystander = symbolRanks.find((r) => r.stableKey === 'utils/jwtUtil.ts#TokenStatus')!;
    expect(handler.score).to.be.greaterThan(bystander.score);
    expect(handler.reasons.join(' ')).to.contain('workflow');
  });

  it('flags entry points in reasons for node targets', () => {
    const entryNodes = rankings.filter(
      (r) => r.targetType !== 'workflow' && r.breakdown.entrypointParticipation === 1,
    );
    expect(entryNodes.length).to.be.greaterThan(0);
    for (const r of entryNodes) expect(r.reasons).to.include('Entry point');
  });

  it('scores files and workflows as separate target types', () => {
    const file = rankings.find((r) => r.targetType === 'file' && r.stableKey === 'routes/authRoutes.ts');
    expect(file, 'routes file ranking').to.exist;
    expect(file!.reasons.join(' ')).to.contain('Entry point');

    const wf = rankings.filter((r) => r.targetType === 'workflow');
    expect(wf.length).to.equal(workflows.length);
  });

  it('churn raises a file score and lands in reasons', () => {
    const churn = new Map<string, ChurnStats>([
      ['services/sessionStore.ts', { commitCount90d: 30, lastTouchedAt: '2026-06-01T00:00:00Z', distinctAuthors: 4 }],
    ]);
    const withChurn = rankCandidates({ graph, entrypoints, sideEffects, workflows, churn });
    const before = rankings.find((r) => r.targetType === 'file' && r.stableKey === 'services/sessionStore.ts')!;
    const after = withChurn.find((r) => r.targetType === 'file' && r.stableKey === 'services/sessionStore.ts')!;
    expect(after.score).to.be.greaterThan(before.score);
    expect(after.reasons.join(' ')).to.contain('30 commits');
  });

  it('missing churn degrades to 0-weight without failing', () => {
    const none = rankCandidates({ graph, entrypoints, sideEffects, workflows });
    for (const r of none) expect(r.breakdown.churn).to.equal(0);
  });
});

describe('phase 3 — depth gating', () => {
  it('cheap selects a top-25% subset of exported/route symbols', () => {
    const gating = gateSymbolsForDepth('cheap', rankings, { graph, entrypoints, workflows });
    const symbolCount = gating.selected.length + gating.factsOnly.length;
    expect(gating.selected.length).to.be.greaterThan(0);
    expect(gating.selected.length).to.be.at.most(Math.ceil(symbolCount * 0.25));
    // Trivial symbols never make the cheap set
    expect(gating.selected).to.not.include('utils/jwtUtil.ts#signToken');
  });

  it('standard is a superset of cheap and includes workflow participants', () => {
    const cheap = gateSymbolsForDepth('cheap', rankings, { graph, entrypoints, workflows });
    const standard = gateSymbolsForDepth('standard', rankings, { graph, entrypoints, workflows });
    for (const key of cheap.selected) expect(standard.selected).to.include(key);
    expect(standard.selected).to.include('services/authService.ts#AuthService.login');
  });

  it('full selects every symbol including trivial ones', () => {
    const full = gateSymbolsForDepth('full', rankings, { graph, entrypoints, workflows });
    expect(full.factsOnly).to.deep.equal([]);
    expect(full.selected).to.include('utils/jwtUtil.ts#signToken');
  });
});

describe('phase 3 — churn service', () => {
  const fakeFetch = (payloadByPath: Record<string, unknown>, failPaths: string[] = []) =>
    (async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url));
      const p = parsed.searchParams.get('path')!;
      if (failPaths.includes(p)) return new Response('rate limited', { status: 403 });
      return new Response(JSON.stringify(payloadByPath[p] ?? []), { status: 200 });
    }) as typeof fetch;

  const commit = (date: string, login: string) => ({
    sha: 'x', commit: { author: { date, email: `${login}@x.dev` } }, author: { login },
  });

  it('aggregates commit count, last touch, and distinct authors per path', async () => {
    const churn = await fetchChurnSignals({
      token: 't', owner: 'o', repo: 'r', branch: 'main',
      topLevelDirs: ['services'],
      topFiles: ['services/sessionStore.ts'],
      fetchImpl: fakeFetch({
        services: [commit('2026-06-01T00:00:00Z', 'ana'), commit('2026-06-20T00:00:00Z', 'bob')],
        'services/sessionStore.ts': [commit('2026-06-20T00:00:00Z', 'bob')],
      }),
    });
    expect(churn.get('services')).to.deep.equal({
      commitCount90d: 2, lastTouchedAt: '2026-06-20T00:00:00Z', distinctAuthors: 2,
    });
    expect(churn.get('services/sessionStore.ts')!.commitCount90d).to.equal(1);
  });

  it('degrades per-path on API failure instead of throwing', async () => {
    const churn = await fetchChurnSignals({
      token: 't', owner: 'o', repo: 'r', branch: 'main',
      topLevelDirs: ['services', 'utils'],
      topFiles: [],
      fetchImpl: fakeFetch({ utils: [commit('2026-05-05T00:00:00Z', 'ana')] }, ['services']),
    });
    expect(churn.has('services')).to.be.false;
    expect(churn.get('utils')!.commitCount90d).to.equal(1);
  });

  it('respects the request budget', async () => {
    let calls = 0;
    const counting = (async () => { calls++; return new Response('[]', { status: 200 }); }) as typeof fetch;
    await fetchChurnSignals({
      token: 't', owner: 'o', repo: 'r', branch: 'main',
      topLevelDirs: ['a', 'b', 'c'],
      topFiles: ['d', 'e', 'f'],
      maxRequests: 4,
      fetchImpl: counting,
    });
    expect(calls).to.equal(4);
  });
});

describe('phase 3 — architecture clustering', () => {
  it('groups files into path-based clusters with schema evidence attached', () => {
    const map = clusterArchitecture({ graph, inventory, workflows, rankings });
    const byKind = new Map(map.clusters.map((c) => [c.kind, c]));

    expect(byKind.get('api_layer'), 'api cluster').to.exist;
    expect(byKind.get('auth_layer'), 'auth cluster').to.exist;
    expect(byKind.get('shared_module'), 'shared cluster').to.exist;
    expect(byKind.get('database_layer'), 'db schema cluster').to.exist;

    const api = byKind.get('api_layer')!;
    expect(api.members.map((m) => m.nodeStableKey)).to.include('routes/authRoutes.ts');
    const db = byKind.get('database_layer')!;
    expect(db.members.map((m) => m.nodeStableKey)).to.include('schema:migrations/001_sessions.sql#sessions');
  });

  it('collapses symbol edges into weighted cluster edges', () => {
    const map = clusterArchitecture({ graph, inventory, workflows, rankings });
    const apiKey = map.clusters.find((c) => c.kind === 'api_layer')!.stableKey;
    const authKey = map.clusters.find((c) => c.kind === 'auth_layer')!.stableKey;
    const calls = map.edges.find(
      (e) => e.sourceClusterKey === apiKey && e.targetClusterKey === authKey && e.type === 'calls',
    );
    expect(calls, 'api -> auth calls edge').to.exist;
    expect(calls!.weight).to.be.greaterThan(0);
    expect(calls!.evidence.length).to.be.greaterThan(0);

    const data = map.edges.find((e) => e.type === 'reads_writes_data');
    expect(data, 'reads_writes_data edge to schema cluster').to.exist;
  });

  it('aggregates member candidate scores and writes deterministic summaries', () => {
    const map = clusterArchitecture({ graph, inventory, workflows, rankings });
    const api = map.clusters.find((c) => c.kind === 'api_layer')!;
    expect(api.criticalScore).to.be.greaterThan(0);
    expect(api.deterministicSummary).to.match(/\d+ files?/);
    for (const c of map.clusters) {
      for (const m of c.members) expect(m.reason).to.be.a('string').and.not.empty;
    }
  });

  it('records workflow crossings on cluster edges', () => {
    const map = clusterArchitecture({ graph, inventory, workflows, rankings });
    const crossed = map.edges.filter((e) => e.workflowCrossings.length > 0);
    expect(crossed.length).to.be.greaterThan(0);
  });
});
