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
import type { EvidenceGraph } from '../../types/analysis';
import type { DetectedEntrypoint } from '../entrypointDetector';
import type { DetectedSideEffect } from '../sideEffectDetector';

const SIMPLE_DIR = path.resolve(__dirname, '../../fixtures/simple');
const MIXED_DIR = path.resolve(__dirname, '../../fixtures/mixed');

async function buildFixtureGraph(dir: string): Promise<{
  graph: EvidenceGraph;
  entrypoints: DetectedEntrypoint[];
  sideEffects: DetectedSideEffect[];
}> {
  const records = await scanRepositoryFiles(dir);
  const inventory = await detectRepoInventory(dir, records);
  const index = await buildRepoIndex(dir);
  const ctx = await typescriptParser.createContext(index.files, dir);
  const fileAnalyses = index.files.map((f) => typescriptParser.parseFile(ctx, f));
  const entrypoints = detectEntrypoints(fileAnalyses);
  const sideEffects = detectSideEffects(fileAnalyses);
  const configNodes = scanConfigNodes(records, inventory);
  const docs = ingestDocs(records, new Set(records.map((r) => r.relativePath)));
  const graph = buildEvidenceGraph({
    fileAnalyses, fileRecords: records, entrypoints, sideEffects, configNodes, docs, rootPath: dir,
  });
  return { graph, entrypoints, sideEffects };
}

describe('workflowExtractor (call-graph traversal)', () => {
  let workflows: ExtractedWorkflow[];

  before(async () => {
    const { graph, entrypoints, sideEffects } = await buildFixtureGraph(SIMPLE_DIR);
    workflows = extractWorkflows({ graph, entrypoints, sideEffects });
  });

  it('extracts workflows from route entrypoints', () => {
    expect(workflows.length).to.be.greaterThan(0);
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'));
    expect(login, 'login workflow').to.exist;
  });

  it('first step of each workflow is a trigger with sequential step order', () => {
    for (const wf of workflows) {
      expect(wf.steps[0]!.stepKind).to.equal('trigger');
      wf.steps.forEach((s, i) => expect(s.stepOrder).to.equal(i + 1));
    }
  });

  it('traces the login flow through auth, persistence, schema, and response', () => {
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'))!;
    const kinds = login.steps.map((s) => s.stepKind);
    expect(kinds).to.include('auth_guard');    // AuthService.login
    expect(kinds).to.include('data_write');    // saveSession INSERT + sessions table
    expect(kinds[kinds.length - 1]).to.equal('response');

    const authStep = login.steps.find((s) => s.stepKind === 'auth_guard');
    expect(authStep!.symbolName).to.contain('login');
    const schemaStep = login.steps.find((s) => s.nodeStableKey.startsWith('schema:'));
    expect(schemaStep, 'schema table step').to.exist;
    expect(schemaStep!.deterministicDescription).to.contain('sessions');
  });

  it('collapses trivial helpers (signToken, formatLabel) out of the steps', () => {
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'))!;
    const symbols = login.steps.map((s) => s.symbolName ?? '');
    expect(symbols.join(' ')).to.not.contain('signToken');
    expect(symbols.join(' ')).to.not.contain('formatLabel');
  });

  it('classifies purpose deterministically from trigger and outcomes', () => {
    const login = workflows.find((w) => w.stableKey.endsWith(':loginHandler'))!;
    expect(login.purpose).to.contain('writes data');
    expect(login.purpose).to.contain('responds to the caller');
    expect(login.triggerType).to.contain('HTTP');
  });

  it('sorts workflows by importance score descending', () => {
    for (let i = 1; i < workflows.length; i++) {
      expect(workflows[i]!.importanceScore).to.be.at.most(workflows[i - 1]!.importanceScore);
    }
  });

  it('never invents workflows when no trace reaches an effect (mixed fixture)', async () => {
    const { graph, entrypoints, sideEffects } = await buildFixtureGraph(MIXED_DIR);
    const mixedWorkflows = extractWorkflows({ graph, entrypoints, sideEffects });
    expect(mixedWorkflows).to.deep.equal([]);
  });
});
