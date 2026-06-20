import { expect } from 'chai';
import * as path from 'path';
import { buildRepoIndex, filterByLanguage } from '../repoIngester';
import { createProgram, parseSourceFile } from '../astParser';
import { extractFileAnalysis } from '../symbolExtractor';
import { buildDependencyGraph, annotateResolvedImports } from '../graphBuilder';
import { detectEntrypoints } from '../entrypointDetector';
import { detectSideEffects } from '../sideEffectDetector';
import { extractWorkflows } from '../workflowExtractor';
import type { FileAnalysis } from '../../types/analysis';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/simple');

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

describe('workflowExtractor', () => {
  it('extracts at least one workflow from the fixture', () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const workflows = extractWorkflows(fileAnalyses, graph, entrypoints, sideEffects);
    expect(workflows.length).to.be.greaterThan(0);
  });

  it('workflows have required fields', () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const workflows = extractWorkflows(fileAnalyses, graph, entrypoints, sideEffects);
    for (const wf of workflows) {
      expect(wf.title).to.be.a('string');
      expect(wf.triggerType).to.be.a('string');
      expect(wf.stableKey).to.be.a('string');
      expect(wf.importanceScore).to.be.a('number');
      expect(wf.confidence).to.be.oneOf(['high', 'medium', 'low']);
      expect(wf.steps).to.be.an('array');
      expect(wf.steps.length).to.be.greaterThan(0);
    }
  });

  it('workflow steps have sequential stepOrder', () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const workflows = extractWorkflows(fileAnalyses, graph, entrypoints, sideEffects);
    for (const wf of workflows) {
      for (let i = 0; i < wf.steps.length; i++) {
        expect(wf.steps[i]!.stepOrder).to.equal(i + 1);
      }
    }
  });

  it('first step of each workflow is a trigger', () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const workflows = extractWorkflows(fileAnalyses, graph, entrypoints, sideEffects);
    for (const wf of workflows) {
      expect(wf.steps[0]!.stepKind).to.equal('trigger');
    }
  });

  it('workflows are sorted by importance score descending', () => {
    const graph = buildDependencyGraph(fileAnalyses, FIXTURE_DIR);
    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const workflows = extractWorkflows(fileAnalyses, graph, entrypoints, sideEffects);
    for (let i = 1; i < workflows.length; i++) {
      expect(workflows[i]!.importanceScore).to.be.at.most(workflows[i - 1]!.importanceScore);
    }
  });
});
