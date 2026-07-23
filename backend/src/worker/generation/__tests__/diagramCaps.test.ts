import { expect } from 'chai';
import { architectureDiagram, schemaDiagram, workflowSequenceDiagram } from '../diagrams.js';

describe('workflowSequenceDiagram (hub topology)', () => {
  const step = (n: number, filePath: string, symbolName: string) => ({
    stepOrder: n,
    filePath,
    symbolName,
    stepKind: 'transform',
    description: '',
  });

  it('draws every arrow from the entry participant — no fictional peer calls', () => {
    const mermaid = workflowSequenceDiagram('t', [
      step(1, 'api/routes/a.ts', 'GET /'),
      step(2, 'lib/db.ts', 'query'),
      step(3, 'lib/other.ts', 'helper'),
    ]);
    expect(mermaid).to.include('P0->>P1: 2. query');
    expect(mermaid).to.include('P0->>P2: 3. helper');
    expect(mermaid).to.not.include('P1->>P2'); // the old chained fiction
  });

  it('drops fixture/test files from participants entirely', () => {
    const mermaid = workflowSequenceDiagram('t', [
      step(1, 'api/routes/a.ts', 'POST /x'),
      step(2, 'src/worker/fixtures/mixed/migrations/001_init.sql', 'users'),
      step(3, 'lib/db.ts', 'query'),
    ]);
    expect(mermaid).to.not.include('fixtures');
    expect(mermaid).to.include('P0->>P1: 3. query');
  });

  it('caps participants and notes the overflow', () => {
    const steps = Array.from({ length: 12 }, (_, i) => step(i + 1, `f${i}.ts`, `s${i}`));
    const mermaid = workflowSequenceDiagram('t', steps);
    expect((mermaid.match(/participant /g) ?? []).length).to.equal(8);
    expect(mermaid).to.include('more steps beyond 8 files');
  });
});

describe('schemaDiagram (connected-only, capped)', () => {
  it('drops isolated tables and test accessors', () => {
    const mermaid = schemaDiagram(
      [{ name: 'users' }, { name: 'lonely_table' }],
      [
        { table: 'users', accessor: 'src/api/auth.ts#GET /me', mode: 'reads' },
        { table: 'users', accessor: 'test/helpers/mocks.ts#mockUsers', mode: 'reads' },
      ],
    );
    expect(mermaid).to.include('users');
    expect(mermaid).to.not.include('lonely_table');
    expect(mermaid).to.not.include('mockUsers');
  });

  it('caps accessors per table', () => {
    const accesses = Array.from({ length: 6 }, (_, i) => ({
      table: 'users',
      accessor: `src/api/r${i}.ts#h${i}`,
      mode: 'writes',
    }));
    const mermaid = schemaDiagram([{ name: 'users' }], accesses);
    expect((mermaid.match(/-->/g) ?? []).length).to.equal(3);
  });
});

describe('architectureDiagram (deduped, test-free, capped)', () => {
  const cluster = (key: string, kind = 'backend') => ({ stableKey: key, label: key, kind });

  it('drops test-cluster edges, self-loops, and keeps the heavier direction', () => {
    const mermaid = architectureDiagram(
      [cluster('api'), cluster('worker'), cluster('tests', 'tests')],
      [
        { sourceClusterKey: 'api', targetClusterKey: 'worker', type: 'calls', weight: 5 },
        { sourceClusterKey: 'api', targetClusterKey: 'worker', type: 'imports', weight: 2 },
        { sourceClusterKey: 'api', targetClusterKey: 'api', type: 'calls', weight: 9 },
        { sourceClusterKey: 'tests', targetClusterKey: 'api', type: 'tests', weight: 8 },
      ],
    );
    expect(mermaid).to.include('api -->|calls| worker');
    expect(mermaid).to.not.include('imports');
    expect(mermaid).to.not.include('tests');
    expect((mermaid.match(/-->/g) ?? []).length).to.equal(1);
  });

  it('caps total edges at 16 by weight', () => {
    const clusters = Array.from({ length: 20 }, (_, i) => cluster(`c${i}`));
    const edges = Array.from({ length: 19 }, (_, i) => ({
      sourceClusterKey: `c${i}`,
      targetClusterKey: `c${i + 1 === 20 ? 0 : i + 1}`,
      type: 'calls',
      weight: i,
    }));
    const mermaid = architectureDiagram(clusters, edges);
    expect((mermaid.match(/-->/g) ?? []).length).to.equal(16);
  });
});
