import { expect } from 'chai';
import { extractWorkflows } from '../engine/workflowExtractor.js';
import { buildEvidenceGraph } from '../engine/evidenceGraphBuilder.js';
import type { EvidenceGraph, EvidenceNode, FileAnalysis, ImportRecord } from '../types/analysis.js';
import type { DetectedEntrypoint } from '../engine/entrypointDetector.js';
import type { DetectedSideEffect } from '../engine/sideEffectDetector.js';

/**
 * Milestone 4 regression tests:
 *  - the synthetic final "response" step is tagged syntheticReturn (the graph
 *    route renders it as its own terminal node instead of a last→first cycle)
 *  - near-duplicate workflows (≥80% shared step nodes) are suppressed
 *  - UI-route traces rank below server flows of the same shape
 *  - import counts key on deduped edges (repeat/type-only imports strengthen
 *    edge weight, never inflate importCount / dependentCount)
 */

function fnNode(key: string, name: string, filePath: string, metadata: Record<string, unknown> = {}): EvidenceNode {
  return { stableKey: key, type: 'function', name, filePath, trustLevel: 'code', metadata };
}

function callEdge(sourceKey: string, targetKey: string): EvidenceGraph['edges'][number] {
  return { sourceKey, targetKey, type: 'calls', confidence: 'high', metadata: {} };
}

function httpEntrypoint(file: string, symbol: string): DetectedEntrypoint {
  return {
    nodeStableKey: file,
    kind: 'http_route',
    method: 'POST',
    routePattern: `/${symbol}`,
    filePath: file,
    symbolName: symbol,
    symbolStableKey: `${file}#${symbol}`,
  };
}

function dbWrite(file: string, symbol: string, target: string): DetectedSideEffect {
  return {
    nodeStableKey: file,
    symbolStableKey: `${file}#${symbol}`,
    kind: 'database_write',
    filePath: file,
    symbolName: symbol,
    target,
  };
}

describe('m4 — workflow extraction fixes', () => {
  it('tags the re-pushed response step syntheticReturn instead of looping to the trigger', () => {
    const handlerKey = 'src/api.ts#handler';
    const graph: EvidenceGraph = {
      nodes: [
        fnNode(handlerKey, 'handler', 'src/api.ts', { behaviorSignals: ['response_output'] }),
        fnNode('src/svc.ts#save', 'save', 'src/svc.ts'),
      ],
      edges: [callEdge(handlerKey, 'src/svc.ts#save')],
    };

    const workflows = extractWorkflows({
      graph,
      entrypoints: [httpEntrypoint('src/api.ts', 'handler')],
      sideEffects: [dbWrite('src/svc.ts', 'save', 'users')],
    });

    expect(workflows).to.have.length(1);
    const steps = workflows[0]!.steps;
    const last = steps[steps.length - 1]!;
    expect(last.stepKind).to.equal('response');
    expect(last.metadata?.syntheticReturn).to.equal(true);
    // The response step reuses the trigger node — without the tag the graph
    // route would draw an edge back to step 1.
    expect(last.nodeStableKey).to.equal(steps[0]!.nodeStableKey);
    // Non-synthetic steps carry no tag.
    expect(steps[0]!.metadata?.syntheticReturn).to.not.equal(true);
  });

  it('names the effect target in the deterministic step description', () => {
    const graph: EvidenceGraph = {
      nodes: [
        fnNode('src/api.ts#handler', 'handler', 'src/api.ts'),
        fnNode('src/svc.ts#save', 'save', 'src/svc.ts'),
      ],
      edges: [callEdge('src/api.ts#handler', 'src/svc.ts#save')],
    };
    const workflows = extractWorkflows({
      graph,
      entrypoints: [httpEntrypoint('src/api.ts', 'handler')],
      sideEffects: [dbWrite('src/svc.ts', 'save', 'users')],
    });
    const write = workflows[0]!.steps.find((s) => s.stepKind === 'data_write');
    expect(write?.deterministicDescription).to.contain('users');
  });

  it('suppresses workflows sharing ≥80% of step nodes with a higher-ranked one', () => {
    const shared = ['s1', 's2', 's3', 's4'].map((n) => fnNode(`src/shared.ts#${n}`, n, 'src/shared.ts'));
    const graph: EvidenceGraph = {
      nodes: [
        fnNode('src/a.ts#seedA', 'seedA', 'src/a.ts'),
        fnNode('src/b.ts#seedB', 'seedB', 'src/b.ts'),
        ...shared,
      ],
      edges: [
        callEdge('src/a.ts#seedA', 'src/shared.ts#s1'),
        callEdge('src/b.ts#seedB', 'src/shared.ts#s1'),
        callEdge('src/shared.ts#s1', 'src/shared.ts#s2'),
        callEdge('src/shared.ts#s2', 'src/shared.ts#s3'),
        callEdge('src/shared.ts#s3', 'src/shared.ts#s4'),
      ],
    };
    // Both traces are [seed, s1, s2, s3, s4]: 4 of 5 node keys shared = 0.8.
    const workflows = extractWorkflows({
      graph,
      entrypoints: [httpEntrypoint('src/a.ts', 'seedA'), httpEntrypoint('src/b.ts', 'seedB')],
      sideEffects: [dbWrite('src/shared.ts', 's4', 'orders')],
    });
    expect(workflows).to.have.length(1);
  });

  it('ranks ui_route traces below server flows of the same shape', () => {
    const graph: EvidenceGraph = {
      nodes: [
        fnNode('src/api.ts#post', 'post', 'src/api.ts'),
        fnNode('src/api-svc.ts#saveA', 'saveA', 'src/api-svc.ts'),
        fnNode('src/page.tsx#Page', 'Page', 'src/page.tsx'),
        fnNode('src/ui-svc.ts#saveB', 'saveB', 'src/ui-svc.ts'),
      ],
      edges: [
        callEdge('src/api.ts#post', 'src/api-svc.ts#saveA'),
        callEdge('src/page.tsx#Page', 'src/ui-svc.ts#saveB'),
      ],
    };
    const uiEntrypoint: DetectedEntrypoint = {
      nodeStableKey: 'src/page.tsx',
      kind: 'ui_route',
      routePattern: '/page',
      filePath: 'src/page.tsx',
      symbolName: 'Page',
      symbolStableKey: 'src/page.tsx#Page',
    };
    const workflows = extractWorkflows({
      graph,
      entrypoints: [uiEntrypoint, httpEntrypoint('src/api.ts', 'post')],
      sideEffects: [
        dbWrite('src/api-svc.ts', 'saveA', 'a'),
        dbWrite('src/ui-svc.ts', 'saveB', 'b'),
      ],
    });
    expect(workflows).to.have.length(2);
    expect(workflows[0]!.triggerType).to.contain('HTTP');
    expect(workflows[0]!.importanceScore).to.be.greaterThan(workflows[1]!.importanceScore);
    expect(workflows[1]!.importanceScore * 2).to.be.closeTo(workflows[0]!.importanceScore, 1e-9);
  });
});

describe('m4 — evidence graph count semantics', () => {
  function importRecord(fromFile: string, toSpecifier: string, isTypeOnly = false): ImportRecord {
    return { fromFile, toSpecifier, namedImports: [], isTypeOnly };
  }

  function analysis(relativePath: string, imports: ImportRecord[]): FileAnalysis {
    return { filePath: `/repo/${relativePath}`, relativePath, symbols: [], imports, exports: [], hasParseErrors: false, parseErrors: [] };
  }

  it('dedupes repeat imports into one weighted edge and distinct counts', () => {
    const graph = buildEvidenceGraph({
      fileAnalyses: [
        // a.ts imports b twice (value + type-only) and one third-party package.
        analysis('a.ts', [
          importRecord('a.ts', './b'),
          importRecord('a.ts', './b', true),
          importRecord('a.ts', 'lodash'),
        ]),
        analysis('b.ts', []),
      ],
      fileRecords: [],
      entrypoints: [],
      sideEffects: [],
      configNodes: [],
      docs: { nodes: [], edges: [] },
      rootPath: '/nonexistent-m4-count-test',
    });

    const importEdges = graph.edges.filter((e) => e.type === 'imports');
    expect(importEdges).to.have.length(1);
    // The duplicate statement strengthens the edge instead of duplicating it.
    expect(importEdges[0]!.metadata.weight).to.equal(2);

    const externalEdges = graph.edges.filter((e) => e.type === 'references_external');
    expect(externalEdges).to.have.length(1);

    const a = graph.nodes.find((n) => n.stableKey === 'a.ts')!;
    const b = graph.nodes.find((n) => n.stableKey === 'b.ts')!;
    // "1 imports · 1 imported by · 1 external" — never 2/3 from repeat statements.
    expect(a.metadata.importCount).to.equal(1);
    expect(a.metadata.externalImportCount).to.equal(1);
    expect(b.metadata.dependentCount).to.equal(1);
  });
});
