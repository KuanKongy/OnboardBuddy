/**
 * Dev tool: run the deterministic engine on a local repo and report
 * call-edge density + workflow extraction. No DB, no LLM.
 *
 *   node --import tsx backend/scripts/engine-repro.ts <repoPath>
 */
import { runAnalysis } from '../src/worker/engine/analysisRunner.js';
import { detectEntrypoints } from '../src/worker/engine/entrypointDetector.js';
import { detectSideEffects } from '../src/worker/engine/sideEffectDetector.js';
import { scanConfigNodes } from '../src/worker/engine/configScanner.js';
import { ingestDocs } from '../src/worker/engine/docsIngester.js';
import { buildEvidenceGraph } from '../src/worker/engine/evidenceGraphBuilder.js';
import { extractWorkflows } from '../src/worker/engine/workflowExtractor.js';

const repoPath = process.argv[2]!;
const t0 = Date.now();
const snapshot = await runAnalysis({ projectId: 'local', triggeredBy: 'local', repoPath, pathPrefix: process.argv[3] ?? '' });
console.log(`analysis: ${Date.now() - t0}ms, files=${snapshot.fileRecords.length}, parsed=${snapshot.fileAnalyses.length}, symbols=${snapshot.fileAnalyses.reduce((n, f) => n + f.symbols.length, 0)}`);

const entrypoints = detectEntrypoints(snapshot.fileAnalyses);
const sideEffects = detectSideEffects(snapshot.fileAnalyses);
const configNodes = scanConfigNodes(snapshot.fileRecords, snapshot.inventory);
const knownPaths = new Set(snapshot.fileRecords.map((r) => r.relativePath));
const docs = ingestDocs(snapshot.fileRecords, knownPaths);
const evidence = buildEvidenceGraph({
  fileAnalyses: snapshot.fileAnalyses, fileRecords: snapshot.fileRecords,
  entrypoints, sideEffects, configNodes, docs, rootPath: repoPath,
});

const byType = new Map<string, number>();
for (const e of evidence.edges) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
console.log('edges:', [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join(', '));
console.log('entrypoints:', entrypoints.length, 'kinds:', [...new Set(entrypoints.map((e) => e.kind))].join(','));
console.log('sideEffects:', sideEffects.length);

const workflows = extractWorkflows({ graph: evidence, entrypoints, sideEffects });
console.log('WORKFLOWS:', workflows.length);
for (const w of workflows.slice(0, 10)) console.log(`  [${w.confidence}] ${w.title} — ${w.steps.length} steps`);
