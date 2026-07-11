import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import {
  architectureDiagram, workflowSequenceDiagram, workflowDataflowDiagram,
  workflowDiagramKind, schemaDiagram, type DiagramStep,
} from '../diagrams.js';
import { critical25, type ProjectedTarget } from '../roleProjection.js';
import { SECTION_SPECS, SECTION_TYPES } from '../sectionSpecs.js';
import { validateGeneratedOutput, type GeneratedOutput } from '../citationValidator.js';
import type { EvidenceBundleV2 } from '../../../retrieval/retrievalService.js';

describe('phase 7 — deterministic diagrams', () => {
  it('architecture diagram renders clusters and typed edges, skipping unknown endpoints', () => {
    const mermaid = architectureDiagram(
      [
        { stableKey: 'cluster:api-routes', label: 'API Routes', kind: 'api_layer' },
        { stableKey: 'cluster:database', label: 'Database', kind: 'database_layer' },
      ],
      [
        { sourceClusterKey: 'cluster:api-routes', targetClusterKey: 'cluster:database', type: 'reads_writes_data', weight: 3 },
        { sourceClusterKey: 'cluster:ghost', targetClusterKey: 'cluster:database', type: 'calls', weight: 1 },
      ],
    );
    expect(mermaid).to.match(/^flowchart TD/);
    expect(mermaid).to.include('cluster_api_routes["API Routes"]');
    expect(mermaid).to.include('-->|reads_writes_data|');
    expect(mermaid).to.not.include('ghost');
  });

  const steps: DiagramStep[] = [
    { stepOrder: 1, filePath: 'routes/auth.ts', symbolName: 'loginHandler', stepKind: 'trigger', description: 'handles POST' },
    { stepOrder: 2, filePath: 'services/auth.ts', symbolName: 'login', stepKind: 'auth_guard', description: 'validates' },
    { stepOrder: 3, filePath: 'services/store.ts', symbolName: 'saveSession', stepKind: 'data_write', description: 'writes' },
  ];

  it('sequence diagram declares one participant per file and one arrow per step', () => {
    const mermaid = workflowSequenceDiagram('Login', steps);
    expect(mermaid).to.match(/^sequenceDiagram/);
    expect(mermaid.match(/participant /g)).to.have.length(3);
    expect(mermaid.match(/->>/g)).to.have.length(3);
    expect(mermaid).to.include('2. login');
  });

  it('data-heavy workflows switch to dataflow', () => {
    const dataSteps: DiagramStep[] = [
      { stepOrder: 1, filePath: 'a.ts', symbolName: 'read', stepKind: 'data_read', description: '' },
      { stepOrder: 2, filePath: 'b.ts', symbolName: 'write', stepKind: 'data_write', description: '' },
      { stepOrder: 3, filePath: 'c.ts', symbolName: null, stepKind: 'transform', description: '' },
    ];
    expect(workflowDiagramKind(steps)).to.equal('sequence');
    expect(workflowDiagramKind(dataSteps)).to.equal('dataflow');
    const mermaid = workflowDataflowDiagram('ETL', dataSteps);
    expect(mermaid).to.match(/^flowchart LR/);
    expect(mermaid).to.include('[('); // database shape for data steps
  });

  it('schema diagram links accessors to tables with access mode', () => {
    const mermaid = schemaDiagram(
      [{ name: 'sessions' }],
      [{ table: 'sessions', accessor: 'services/sessionStore.ts', mode: 'touches_schema' }],
    );
    expect(mermaid).to.include('t_sessions[("sessions")]');
    expect(mermaid).to.include('-->|touches_schema| t_sessions');
  });
});

describe('phase 7 — critical 25% projection', () => {
  it('takes the top 25% per target type with a floor', () => {
    const targets: ProjectedTarget[] = Array.from({ length: 20 }, (_, i) => ({
      targetType: 'symbol', stableKey: `s${i}`, score: 1 - i / 20, reasons: [], viewScores: {},
    }));
    targets.push({ targetType: 'workflow', stableKey: 'wf1', score: 0.5, reasons: [], viewScores: {} });
    const top = critical25(targets, 3);
    expect(top.get('symbol')).to.have.length(5); // ceil(20 * 0.25)
    expect(top.get('symbol')![0]!.stableKey).to.equal('s0');
    expect(top.get('workflow')).to.have.length(1); // floor capped by availability
  });
});

describe('phase 7 — section specs', () => {
  it('covers all eleven spec sections with views and instructions', () => {
    expect(SECTION_TYPES).to.have.length(11);
    for (const type of SECTION_TYPES) {
      const spec = SECTION_SPECS[type];
      expect(spec.views.length, type).to.be.greaterThan(0);
      expect(spec.instructions.length, type).to.be.greaterThan(40);
      expect(spec.retrievalTask('backend').length, type).to.be.greaterThan(10);
    }
  });

  it('diagram-bearing sections are exactly architecture, workflow_guide, data_schema', () => {
    const withDiagrams = SECTION_TYPES.filter((t) => SECTION_SPECS[t].diagrams !== undefined);
    expect(withDiagrams.sort()).to.deep.equal(['architecture', 'data_schema', 'workflow_guide']);
  });
});

describe('phase 7 — citation validator', () => {
  afterEach(() => __setQueryForTests(null));

  function bundle(receipts: EvidenceBundleV2['receipts']): EvidenceBundleV2 {
    return {
      bundleVersion: '2.0', task: 't', privacyMode: 'full_ai',
      repo: { owner: 'o', name: 'n', branch: 'main', commit: 'c' },
      scope: { id: 's', pathPrefix: '', displayName: 'repo' },
      deterministicContext: {}, semanticContext: [], receipts, unknowns: [],
      outputRules: { useOnlyProvidedEvidence: true, citeEverySubstantiveClaim: true, codeReceiptsWinOverDocs: true, stateUnknownsExplicitly: true },
    };
  }

  function output(claims: GeneratedOutput['claims'], used: string[] = []): GeneratedOutput {
    return { title: 't', contentMarkdown: 'body', confidence: 'high', claims, usedReceiptIds: used, unknowns: [] };
  }

  const R1 = '11111111-1111-1111-1111-111111111111';
  const R2 = '22222222-2222-2222-2222-222222222222';

  function stubNodes(existing: string[]) {
    __setQueryForTests(async (text, params) => {
      if (text.includes('FROM graph_nodes')) {
        return { rows: existing.filter((k) => (params?.[1] as string[]).includes(k)).map((k) => ({ stable_key: k })) } as never;
      }
      return { rows: [] } as never;
    });
  }

  it('accepts grounded claims and keeps confidence', async () => {
    stubNodes(['a.ts#fn']);
    const result = await validateGeneratedOutput({
      bundle: bundle([{ receiptId: R1, receiptKind: 'code_snippet', trustLevel: 'code', nodeStableKey: 'a.ts#fn', filePath: 'a.ts' }]),
      output: output([{ claim: 'a.ts validates input', receiptIds: [R1], confidence: 'high' }], [R1]),
      snapshotId: 'snap',
    });
    expect(result.hardFailure).to.equal(false);
    expect(result.confidence).to.equal('high');
    expect(result.adjustedClaims[0]!.confidence).to.equal('high');
  });

  it('drops unknown receipt ids and hard-fails when most citations are invented', async () => {
    stubNodes([]);
    const result = await validateGeneratedOutput({
      bundle: bundle([]),
      output: output([{ claim: 'something', receiptIds: ['33333333-3333-3333-3333-333333333333'], confidence: 'high' }]),
      snapshotId: 'snap',
    });
    expect(result.hardFailure).to.equal(true);
    expect(result.usedReceiptIds).to.deep.equal([]);
  });

  it('downgrades uncited claims to low and lists them in unknowns', async () => {
    stubNodes(['a.ts#fn']);
    const result = await validateGeneratedOutput({
      bundle: bundle([{ receiptId: R1, receiptKind: 'code_snippet', trustLevel: 'code', nodeStableKey: 'a.ts#fn' }]),
      output: output([
        { claim: 'grounded', receiptIds: [R1], confidence: 'high' },
        { claim: 'floating assertion', receiptIds: [], confidence: 'high' },
      ]),
      snapshotId: 'snap',
    });
    expect(result.adjustedClaims[1]!.confidence).to.equal('low');
    expect(result.unknowns.some((u) => u.kind === 'uncited_claim')).to.equal(true);
    expect(result.confidence).to.equal('low'); // min of major claims
  });

  it('caps docs-only support at medium and flags conflicts when code evidence existed', async () => {
    stubNodes(['a.ts#fn']);
    const result = await validateGeneratedOutput({
      bundle: bundle([
        { receiptId: R1, receiptKind: 'doc_snippet', trustLevel: 'docs', nodeStableKey: 'a.ts#fn' },
        { receiptId: R2, receiptKind: 'code_snippet', trustLevel: 'code', nodeStableKey: 'a.ts#fn' },
      ]),
      output: output([{ claim: 'behavior per README', receiptIds: [R1], confidence: 'high' }]),
      snapshotId: 'snap',
    });
    expect(result.adjustedClaims[0]!.confidence).to.equal('medium');
    expect(result.unknowns.some((u) => u.kind === 'docs_conflict_with_code')).to.equal(true);
  });

  it('claims naming files must cite receipts from those files', async () => {
    stubNodes(['a.ts#fn']);
    const result = await validateGeneratedOutput({
      bundle: bundle([{ receiptId: R1, receiptKind: 'code_snippet', trustLevel: 'code', nodeStableKey: 'a.ts#fn', filePath: 'a.ts' }]),
      output: output([{ claim: 'the logic lives in other/file.ts', receiptIds: [R1], confidence: 'high' }]),
      snapshotId: 'snap',
    });
    expect(result.adjustedClaims[0]!.confidence).to.equal('low');
    expect(result.issues.some((i) => i.includes('other/file.ts'))).to.equal(true);
  });

  it('resolves record_reference receipts transitively; unresolvable chains hard-fail', async () => {
    __setQueryForTests(async (text, params) => {
      if (text.includes('FROM graph_nodes')) return { rows: [] } as never;
      if (text.includes('FROM semantic_records')) {
        return { rows: [{ receipt_ids: params?.[0] === 'rec-good' ? ['deep-1'] : [] }] } as never;
      }
      if (text.includes('FROM source_receipts')) {
        return { rows: [{ trust_level: 'code', receipt_kind: 'code_snippet', referenced_record_id: null }] } as never;
      }
      return { rows: [] } as never;
    });
    const good = await validateGeneratedOutput({
      bundle: bundle([{ receiptId: R1, receiptKind: 'record_reference', trustLevel: 'llm_inference', referencedRecordId: 'rec-good' }]),
      output: output([{ claim: 'derived claim', receiptIds: [R1], confidence: 'medium' }]),
      snapshotId: 'snap',
    });
    expect(good.hardFailure).to.equal(false);
    expect(good.adjustedClaims[0]!.confidence).to.equal('medium');

    const bad = await validateGeneratedOutput({
      bundle: bundle([{ receiptId: R2, receiptKind: 'record_reference', trustLevel: 'llm_inference', referencedRecordId: 'rec-empty' }]),
      output: output([{ claim: 'derived claim', receiptIds: [R2], confidence: 'high' }]),
      snapshotId: 'snap',
    });
    expect(bad.hardFailure).to.equal(true);
    expect(bad.adjustedClaims[0]!.confidence).to.equal('low');
  });
});
