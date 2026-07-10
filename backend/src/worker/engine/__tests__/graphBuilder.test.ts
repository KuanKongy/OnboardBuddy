import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester';
import { createProgram, parseSourceFile } from '../astParser';
import { extractFileAnalysis } from '../symbolExtractor';
import { buildDependencyGraph, buildClassGraph, annotateResolvedImports } from '../graphBuilder';
import type { FileAnalysis, DependencyGraph } from '../../types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/simple');

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

  // SKIP: blocked on resolveSpecifier not mapping NodeNext ESM '.js' specifiers
  // back to their '.ts' source, so import edges/dependents are not resolved.
  // Re-enable once graphBuilder resolves '.js' → '.ts'.
  it('jwtUtil dependentCount = 2 (imported by index + authService)', () => {
    const node = graph.nodes.find((n) => n.id === path.join('utils', 'jwtUtil.ts'));
    expect(node!.metadata.dependentCount).to.equal(2);
  });

  it('authService dependentCount = 1 (imported by index)', () => {
    const node = graph.nodes.find((n) => n.id === path.join('services', 'authService.ts'));
    expect(node!.metadata.dependentCount).to.equal(1);
  });

  it('index.ts dependentCount = 0 (nobody imports it)', () => {
    const node = graph.nodes.find((n) => n.id === 'index.ts');
    expect(node!.metadata.dependentCount).to.equal(0);
  });
});

describe('graphBuilder — edges', () => {
  // SKIP (graphBuilder '.js' → '.ts' resolution): no edges are produced yet.
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
    const unique = new Set(ids);
    expect(unique.size).to.equal(ids.length);
  });

  it('each edge has weight >= 1', () => {
    for (const e of graph.edges) {
      expect(e.weight).to.be.greaterThanOrEqual(1);
    }
  });
});

describe('graphBuilder — entry points', () => {
  it('index.ts is detected as an entry point', () => {
    expect(graph.entryPoints).to.include('index.ts');
  });

  // SKIP (graphBuilder '.js' → '.ts' resolution): jwtUtil has no resolved
  // inbound edges yet, so it is currently misdetected as an entry point.
  it('jwtUtil is NOT an entry point (it has inbound imports)', () => {
    expect(graph.entryPoints).to.not.include(path.join('utils', 'jwtUtil.ts'));
  });
});

describe('buildClassGraph — fixture repo', () => {
  it('creates nodes for classes and interfaces only', () => {
    const classGraph = buildClassGraph(fileAnalyses);
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
  // SKIP (graphBuilder '.js' → '.ts' resolution): resolvedPath is left undefined.
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
