import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester';
import { createProgram, parseSourceFile } from '../astParser';
import { extractFileAnalysis } from '../symbolExtractor';
import { buildDependencyGraph, buildClassGraph, annotateResolvedImports } from '../graphBuilder';
import type { FileAnalysis, DependencyGraph } from '../../types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/simple');

/**
 * Bug #25 — "graphBuilder edge tests could pass vacuously when edges empty".
 *
 * How the graph fails in production is specific and total: `resolveSpecifier`
 * stops mapping a NodeNext `'./x.js'` specifier back to `x.ts` and EVERY import
 * edge disappears at once (that was bug #21, live for a whole milestone). Any
 * assertion shaped `for (const e of graph.edges)` or `edges.every(...)` or
 * `new Set(ids).size === ids.length` is trivially true over an empty array, so
 * a suite built from those shapes stays green through exactly the outage it
 * exists to catch.
 *
 * The rule this file now follows: anything that iterates or aggregates a
 * collection first asserts the collection is the size it should be. Exact
 * counts, not `>= 0` — a count that can only be right is what makes the
 * iteration mean something.
 */
const EXPECTED_IMPORT_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['index.ts', path.join('services', 'authService.ts')],
  ['index.ts', path.join('utils', 'jwtUtil.ts')],
  [path.join('routes', 'authRoutes.ts'), path.join('services', 'authService.ts')],
  [path.join('routes', 'authRoutes.ts'), path.join('services', 'sessionStore.ts')],
  [path.join('routes', 'authRoutes.ts'), path.join('utils', 'textUtil.ts')],
  [path.join('services', 'authService.ts'), path.join('utils', 'jwtUtil.ts')],
  [path.join('services', 'reportQueueConsumer.ts'), path.join('services', 'sessionStore.ts')],
  [path.join('services', 'summaryQueueConsumer.ts'), path.join('services', 'sessionStore.ts')],
];

let fileAnalyses: FileAnalysis[];
let graph: DependencyGraph;

before(async () => {
  const index = await buildRepoIndex(FIXTURE_DIR);
  const tsFiles = filterByLanguage(index, 'typescript');
  const program = createProgram(tsFiles, FIXTURE_DIR);

  fileAnalyses = tsFiles.map((entry) => {
    const parsed = parseSourceFile(program, entry.absolutePath);
    return extractFileAnalysis(parsed, FIXTURE_DIR);
  });

  annotateResolvedImports(fileAnalyses, FIXTURE_DIR);
  graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
});

describe('graphBuilder — nodes', () => {
  it('creates one node per file', () => {
    expect(graph.nodes).to.have.length(fileAnalyses.length);
  });

  it('node ids are relative file paths', () => {
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).to.include('index.ts');
    expect(ids).to.include(path.join('services', 'authService.ts'));
    expect(ids).to.include(path.join('utils', 'jwtUtil.ts'));
  });

  it('every node has kind = module', () => {
    // Guard first: a loop over an empty array asserts nothing (bug #25).
    expect(graph.nodes).to.not.be.empty;
    for (const n of graph.nodes) {
      expect(n.kind).to.equal('module');
    }
  });

  it('jwtUtil node lists exported symbols', () => {
    const node = graph.nodes.find((n) => n.id === path.join('utils', 'jwtUtil.ts'));
    expect(node).to.exist;
    expect(node!.metadata.exportedSymbols).to.include('signToken');
    expect(node!.metadata.exportedSymbols).to.include('verifyToken');
    expect(node!.metadata.exportedSymbols).to.include('TokenPayload');
    expect(node!.metadata.exportedSymbols).to.include('TokenStatus');
  });

  // Was annotated "SKIP: blocked on resolveSpecifier not mapping NodeNext ESM
  // '.js' specifiers" — bug #21, fixed in M3. The comment outlived the defect
  // and claimed a skip that never existed in the code (`it`, not `it.skip`),
  // which is its own way of making a suite unreadable.
  it('jwtUtil dependentCount = 2 (imported by index + authService)', () => {
    const node = graph.nodes.find((n) => n.id === path.join('utils', 'jwtUtil.ts'));
    expect(node!.metadata.dependentCount).to.equal(2);
  });

  it('authService dependentCount = 2 (imported by index + authRoutes)', () => {
    const node = graph.nodes.find((n) => n.id === path.join('services', 'authService.ts'));
    expect(node!.metadata.dependentCount).to.equal(2);
  });

  it('index.ts dependentCount = 0 (nobody imports it)', () => {
    const node = graph.nodes.find((n) => n.id === 'index.ts');
    expect(node!.metadata.dependentCount).to.equal(0);
  });
});

describe('graphBuilder — edges', () => {
  /**
   * Bug #25's headline assertion. The `.js` → `.ts` resolution failure empties
   * this array wholesale, so the exact count is what stands between a silent
   * regression and a red suite — every other test in this block iterates or
   * searches, and all of them are satisfiable by `[]` alone or by a graph that
   * happens to contain the three edges plus junk.
   *
   * The fixture's every intra-repo import is listed above, all written with
   * NodeNext `.js` specifiers — the shape production gets wrong. Pinning the
   * whole set (not just the three the searches below look for) also catches
   * the opposite failure: a resolver that starts inventing edges.
   */
  it('resolves every fixture import into an edge — the exact set, no more', () => {
    expect(graph.edges, 'no import edges at all — .js → .ts resolution is broken again')
      .to.have.length(EXPECTED_IMPORT_EDGES.length);
    const sortPairs = (pairs: string[][]) =>
      [...pairs].sort((a, b) => `${a[0]}→${a[1]}`.localeCompare(`${b[0]}→${b[1]}`));
    expect(sortPairs(graph.edges.map((e) => [e.source, e.target])))
      .to.deep.equal(sortPairs(EXPECTED_IMPORT_EDGES.map(([s, t]) => [s, t])));
  });

  it('creates an imports edge from index → authService', () => {
    const edge = graph.edges.find(
      (e) =>
        e.source === 'index.ts' &&
        e.target === path.join('services', 'authService.ts'),
    );
    expect(edge).to.exist;
    expect(edge!.kind).to.equal('imports');
  });

  it('creates an imports edge from index → jwtUtil', () => {
    const edge = graph.edges.find(
      (e) =>
        e.source === 'index.ts' &&
        e.target === path.join('utils', 'jwtUtil.ts'),
    );
    expect(edge).to.exist;
  });

  it('creates an imports edge from authService → jwtUtil', () => {
    const edge = graph.edges.find(
      (e) =>
        e.source === path.join('services', 'authService.ts') &&
        e.target === path.join('utils', 'jwtUtil.ts'),
    );
    expect(edge).to.exist;
  });

  it('no duplicate edges', () => {
    const ids = graph.edges.map((e) => e.id);
    // `new Set([]).size === [].length` is the textbook vacuous pass (#25):
    // with no edges this said "no duplicates" about nothing.
    expect(ids).to.have.length(EXPECTED_IMPORT_EDGES.length);
    expect(new Set(ids).size).to.equal(ids.length);
  });

  it('each edge has weight >= 1', () => {
    expect(graph.edges).to.have.length(EXPECTED_IMPORT_EDGES.length);
    for (const e of graph.edges) {
      expect(e.weight).to.be.greaterThanOrEqual(1);
    }
  });
});

describe('graphBuilder — entry points', () => {
  it('index.ts is detected as an entry point', () => {
    expect(graph.entryPoints).to.include('index.ts');
  });

  // Also #21's stale "SKIP" annotation. This one is the sharper of the pair:
  // entry points are "nodes with no inbound edge", so an empty edge set makes
  // EVERY file an entry point — the assertion below is the only thing in the
  // suite that fails on the over-inclusive direction.
  it('jwtUtil is NOT an entry point (it has inbound imports)', () => {
    expect(graph.entryPoints).to.not.include(path.join('utils', 'jwtUtil.ts'));
  });
});

describe('buildClassGraph — fixture repo', () => {
  it('creates nodes for classes and interfaces only', () => {
    const classGraph = buildClassGraph(fileAnalyses);
    // `[].every(...)` is `true` (#25): with no class nodes this asserted that
    // an empty graph contains only classes and interfaces. The fixture's
    // AuthService / ICredentials / ISession are the floor.
    expect(classGraph.nodes.length).to.be.at.least(3);
    const kinds = new Set(classGraph.nodes.map((n) => n.kind));
    expect([...kinds].every((k) => k === 'class' || k === 'interface')).to.equal(true);
  });

  it('creates a class node for AuthService with relativePath#Name id', () => {
    const classGraph = buildClassGraph(fileAnalyses);
    const node = classGraph.nodes.find((n) => n.label === 'AuthService');
    expect(node).to.exist;
    expect(node!.kind).to.equal('class');
    expect(node!.id).to.match(/authService\.ts#AuthService$/);
  });

  it('creates interface nodes for ICredentials and ISession', () => {
    const classGraph = buildClassGraph(fileAnalyses);
    const labels = classGraph.nodes.map((n) => n.label);
    expect(labels).to.include('ICredentials');
    expect(labels).to.include('ISession');
  });

  it('class node metadata lists its method names', () => {
    const classGraph = buildClassGraph(fileAnalyses);
    const node = classGraph.nodes.find((n) => n.label === 'AuthService');
    expect(node!.metadata.exportedSymbols).to.include('login');
    expect(node!.metadata.exportedSymbols).to.include('logout');
    expect(node!.metadata.exportedSymbols).to.include('verify');
  });
});

describe('buildClassGraph — inheritance edges', () => {
  const synthetic: FileAnalysis[] = [
    {
      filePath: '/repo/src/base.ts',
      relativePath: 'src/base.ts',
      symbols: [
        { name: 'IRepository', kind: 'interface', filePath: '/repo/src/base.ts', start: { line: 1, column: 0 }, end: { line: 3, column: 0 }, exported: true, isDefault: false, properties: [{ name: 'find', type: '() => void' }] },
        { name: 'BaseService', kind: 'class', filePath: '/repo/src/base.ts', start: { line: 5, column: 0 }, end: { line: 9, column: 0 }, exported: true, isDefault: false },
      ],
      imports: [],
      exports: [],
      hasParseErrors: false,
      parseErrors: [],
    },
    {
      filePath: '/repo/src/user.ts',
      relativePath: 'src/user.ts',
      symbols: [
        {
          name: 'UserService',
          kind: 'class',
          filePath: '/repo/src/user.ts',
          start: { line: 1, column: 0 },
          end: { line: 10, column: 0 },
          exported: true,
          isDefault: false,
          extendsClass: 'BaseService',
          implements: ['IRepository'],
        },
      ],
      imports: [],
      exports: [],
      hasParseErrors: false,
      parseErrors: [],
    },
  ];

  it('creates an extends edge from UserService to BaseService', () => {
    const classGraph = buildClassGraph(synthetic);
    const edge = classGraph.edges.find((e) => e.kind === 'extends');
    expect(edge).to.exist;
    expect(edge!.source).to.equal('src/user.ts#UserService');
    expect(edge!.target).to.equal('src/base.ts#BaseService');
  });

  it('creates an implements edge from UserService to IRepository', () => {
    const classGraph = buildClassGraph(synthetic);
    const edge = classGraph.edges.find((e) => e.kind === 'implements');
    expect(edge).to.exist;
    expect(edge!.source).to.equal('src/user.ts#UserService');
    expect(edge!.target).to.equal('src/base.ts#IRepository');
  });

  it('increments dependentCount on the parent nodes', () => {
    const classGraph = buildClassGraph(synthetic);
    const base = classGraph.nodes.find((n) => n.label === 'BaseService');
    const iface = classGraph.nodes.find((n) => n.label === 'IRepository');
    expect(base!.metadata.dependentCount).to.equal(1);
    expect(iface!.metadata.dependentCount).to.equal(1);
  });

  it('resolves generic parents like Base<T> to the bare name', () => {
    const withGenerics: FileAnalysis[] = [
      synthetic[0]!,
      {
        ...synthetic[1]!,
        symbols: [{ ...synthetic[1]!.symbols[0]!, extendsClass: 'BaseService<User>', implements: [] }],
      },
    ];
    const classGraph = buildClassGraph(withGenerics);
    const edge = classGraph.edges.find((e) => e.kind === 'extends');
    expect(edge).to.exist;
    expect(edge!.target).to.equal('src/base.ts#BaseService');
  });

  it('produces no edge for unresolvable external parents', () => {
    const external: FileAnalysis[] = [
      {
        ...synthetic[1]!,
        symbols: [{ ...synthetic[1]!.symbols[0]!, extendsClass: 'EventEmitter', implements: [] }],
      },
    ];
    const classGraph = buildClassGraph(external);
    expect(classGraph.edges).to.have.length(0);
  });
});

describe('annotateResolvedImports', () => {
  // Third stale "#21 SKIP" annotation, removed. These two are the root-cause
  // assertions for everything above: if `resolvedPath` goes undefined again,
  // the edge set empties and the counts in `graphBuilder — edges` go red with
  // it, which is exactly the coupling bug #25 asked for.
  it('resolves ../utils/jwtUtil specifier in authService to absolute path', () => {
    const authAnalysis = fileAnalyses.find((fa) =>
      fa.relativePath.includes('authService'),
    )!;
    const imp = authAnalysis.imports.find((i) => i.toSpecifier === '../utils/jwtUtil.js');
    expect(imp!.resolvedPath).to.include('jwtUtil.ts');
  });

  it('resolves ./services/authService specifier in index to absolute path', () => {
    const indexAnalysis = fileAnalyses.find((fa) => fa.relativePath === 'index.ts')!;
    const imp = indexAnalysis.imports.find((i) => i.toSpecifier === './services/authService.js');
    expect(imp!.resolvedPath).to.include('authService.ts');
  });
});
