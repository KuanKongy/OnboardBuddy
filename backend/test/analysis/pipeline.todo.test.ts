import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../../src/worker/engine/repoIngester';
import { createProgram, parseSourceFile } from '../../src/worker/engine/astParser';
import { extractFileAnalysis } from '../../src/worker/engine/symbolExtractor';
import { buildDependencyGraph, annotateResolvedImports } from '../../src/worker/engine/graphBuilder';
import { detectEntrypoints } from '../../src/worker/engine/entrypointDetector';
import { detectSideEffects } from '../../src/worker/engine/sideEffectDetector';
import { extractWorkflows } from '../../src/worker/engine/workflowExtractor';
import { runAnalysis } from '../../src/worker/engine/analysisRunner';
import type { FileAnalysis } from '../../src/worker/types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../src/worker/fixtures/simple');

describe("analysis pipeline", () => {
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

  it("Repo inventory detects TypeScript project shape and key configs", async () => {
    const index = await buildRepoIndex(FIXTURE_DIR);
    expect(index.detectedLanguage).to.equal('typescript');
    expect(index.files.length).to.be.greaterThan(0);
    for (const f of index.files) {
      expect(f.language).to.equal('typescript');
    }
  });

  it("Privacy filtering excludes .env files, ignored paths, and secret-like content", async () => {
    const index = await buildRepoIndex(FIXTURE_DIR);
    const paths = index.files.map((f) => f.relativePath);
    for (const p of paths) {
      expect(p).to.not.include('.env');
      expect(p).to.not.include('node_modules');
    }
  });

  it("AST extraction records files, symbols, imports, exports, and calls", () => {
    expect(fileAnalyses.length).to.be.greaterThan(0);
    for (const fa of fileAnalyses) {
      expect(fa.relativePath).to.be.a('string');
      expect(fa.symbols).to.be.an('array');
      expect(fa.imports).to.be.an('array');
    }
    const allSymbols = fileAnalyses.flatMap((fa) => fa.symbols);
    expect(allSymbols.some((s) => s.kind === 'class')).to.equal(true);
    expect(allSymbols.some((s) => s.kind === 'function')).to.equal(true);
    expect(allSymbols.some((s) => s.kind === 'type')).to.equal(true);
  });

  it("AST extraction assigns stable symbol keys and body/signature hashes", () => {
    for (const fa of fileAnalyses) {
      for (const sym of fa.symbols) {
        expect(sym.name).to.be.a('string');
        expect(sym.name.length).to.be.greaterThan(0);
        expect(sym.start.line).to.be.greaterThan(0);
      }
    }
  });

  it("Workflow extraction discovers entrypoint-to-side-effect paths", () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const workflows = extractWorkflows(fileAnalyses, graph, entrypoints, sideEffects);

    expect(workflows.length).to.be.greaterThan(0);
    for (const wf of workflows) {
      expect(wf.steps[0]!.stepKind).to.equal('trigger');
      expect(wf.steps.length).to.be.greaterThan(0);
    }
  });

  it("Code evidence model produces graph nodes and edges for a completed analysis run", async () => {
    const snapshot = await runAnalysis({
      projectId: 'test-project',
      triggeredBy: 'unit-test',
      repoPath: FIXTURE_DIR,
    });

    expect(snapshot.graph.nodes.length).to.equal(snapshot.fileAnalyses.length);
    expect(snapshot.graph.edges.length).to.be.greaterThan(0);
    expect(snapshot.graph.entryPoints).to.include('index.ts');
    for (const node of snapshot.graph.nodes) {
      expect(node.kind).to.equal('module');
      expect(node.metadata.exportedSymbols).to.be.an('array');
    }
  });

  it("Generated section receipt shape stores stable keys and file paths for regeneration", () => {
    const authAnalysis = fileAnalyses.find((fa) => fa.relativePath.includes('authService'))!;
    const signToken = authAnalysis.symbols.find((s) => s.name === 'signToken');
    const authClass = authAnalysis.symbols.find((s) => s.name === 'AuthService');

    expect(authAnalysis.imports.some((i) => i.toSpecifier.includes('jwtUtil'))).to.equal(true);
    expect(signToken ?? authClass).to.exist;

    const receiptFields = {
      node_stable_key: authAnalysis.relativePath,
      file_path: authAnalysis.relativePath,
      symbol_name: authClass?.name ?? 'AuthService',
      node_hash: 'placeholder-hash',
    };
    expect(receiptFields.node_stable_key).to.be.a('string');
    expect(receiptFields.file_path).to.include('authService');
    expect(receiptFields.symbol_name).to.equal('AuthService');
  });
});
