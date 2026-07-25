/**
 * Accuracy gate. Runs the deterministic half of the pipeline over real cloned
 * repos and diffs the result against hand-labeled expectations in
 * `test/truth/*.json`.
 *
 * The point is that "more accurate" stops being an assertion. Every later phase
 * of the rework runs this before claiming an improvement, and a regression here
 * blocks the phase.
 *
 *   npm run truth              # clones missing repos into .truth-repos/
 *   npm run truth -- --repos /path/to/clones
 *   npm run truth -- --only skribbl
 *
 * Exit code is the number of failed checks, so CI can gate on it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildRepoIndex } from '../src/worker/engine/repoIngester.js';
import { typescriptParser } from '../src/worker/engine/parserInterface.js';
import { createProgram, parseSourceFile } from '../src/worker/engine/astParser.js';
import { extractFileAnalysis } from '../src/worker/engine/symbolExtractor.js';
import { detectEntrypoints } from '../src/worker/engine/entrypointDetector.js';

interface Truth {
  repo: string;
  clone: string;
  shape: string;
  expect: {
    uiRoutes?: { exact?: string[]; mustInclude?: string[] };
    declaredPaths?: Record<string, string>;
    unrouted?: { exact?: string[] };
    httpRoutes?: { exact?: string[]; atLeast?: number; mustInclude?: string[] };
    socketEvents?: { exact?: string[] };
  };
  knownGaps?: string[];
}

const TRUTH_DIR = path.resolve(import.meta.dirname, '../test/truth');
const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const REPOS_DIR = path.resolve(argOf('--repos') ?? path.resolve(import.meta.dirname, '../.truth-repos'));
const ONLY = argOf('--only');

let failures = 0;
let checks = 0;

const norm = (p: string): string => p.replace(/\\/g, '/');

function check(label: string, ok: boolean, detail?: string): void {
  checks++;
  if (ok) {
    console.log(`    ✓ ${label}`);
  } else {
    failures++;
    console.log(`    ✗ ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

/** Set difference rendered for a human, capped so a wholesale miss stays readable. */
function diffList(expected: string[], actual: string[]): string {
  const missing = expected.filter((e) => !actual.includes(e));
  const extra = actual.filter((a) => !expected.includes(a));
  const parts: string[] = [];
  if (missing.length) parts.push(`missing (${missing.length}): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
  if (extra.length) parts.push(`unexpected (${extra.length}): ${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ' …' : ''}`);
  return parts.join('  |  ');
}

async function analyze(dir: string) {
  const index = await buildRepoIndex(dir);
  // Same selector as analysisRunner.ts:61 — anything else silently drops .js.
  const files = index.files.filter((f) => typescriptParser.supports(f.absolutePath));
  const program = createProgram(files, dir);
  const fileAnalyses = files.map((f) => extractFileAnalysis(parseSourceFile(program, f.absolutePath), dir));
  return { fileAnalyses, entrypoints: detectEntrypoints(fileAnalyses), parsedFiles: fileAnalyses.length };
}

function ensureClone(t: Truth, slug: string): string | null {
  const dir = path.join(REPOS_DIR, slug);
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  try {
    console.log(`    cloning ${t.clone} …`);
    execFileSync('git', ['clone', '--depth', '1', '-q', t.clone, dir], { stdio: 'inherit' });
    return dir;
  } catch {
    console.log(`    ⚠ could not clone ${t.clone} — skipping (network?)`);
    return null;
  }
}

const files = fs.readdirSync(TRUTH_DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) throw new Error(`No truth fixtures in ${TRUTH_DIR}`);

for (const file of files) {
  const slug = path.basename(file, '.json');
  if (ONLY && slug !== ONLY) continue;
  const truth = JSON.parse(fs.readFileSync(path.join(TRUTH_DIR, file), 'utf8')) as Truth;

  console.log(`\n  ${truth.repo}  —  ${truth.shape}`);
  const dir = ensureClone(truth, slug);
  if (!dir) continue;

  const { entrypoints, parsedFiles } = await analyze(dir);
  const ui = entrypoints.filter((e) => e.kind === 'ui_route');
  const uiFiles = ui.map((e) => norm(e.filePath)).sort();
  const httpFiles = entrypoints.filter((e) => e.kind === 'http_route').map((e) => norm(e.filePath)).sort();
  console.log(`    (${parsedFiles} files parsed)`);

  const exp = truth.expect;

  if (exp.uiRoutes?.exact) {
    const want = [...exp.uiRoutes.exact].sort();
    check(`ui_routes: ${want.length} expected`, JSON.stringify(want) === JSON.stringify(uiFiles), diffList(want, uiFiles));
  }
  if (exp.uiRoutes?.mustInclude) {
    for (const f of exp.uiRoutes.mustInclude) check(`ui_route includes ${f}`, uiFiles.includes(f));
  }

  if (exp.declaredPaths) {
    const byFile = new Map(ui.map((e) => [norm(e.filePath), e.routePattern]));
    for (const [f, want] of Object.entries(exp.declaredPaths)) {
      if (f === 'note') continue;
      const got = byFile.get(f);
      check(`path ${f} -> ${want}`, got === want, got === undefined ? 'no path detected' : `got ${got}`);
    }
  }

  if (exp.unrouted?.exact) {
    const byFile = new Map(ui.map((e) => [norm(e.filePath), e.routePattern]));
    for (const f of exp.unrouted.exact) {
      check(`${f} correctly has no declared path`, byFile.has(f) && !byFile.get(f), `got ${byFile.get(f)}`);
    }
  }

  if (exp.httpRoutes?.exact) {
    const want = [...exp.httpRoutes.exact].sort();
    check(`http_routes: ${want.length} expected`, JSON.stringify(want) === JSON.stringify(httpFiles), diffList(want, httpFiles));
  }
  if (exp.httpRoutes?.atLeast !== undefined) {
    check(`http_routes >= ${exp.httpRoutes.atLeast}`, httpFiles.length >= exp.httpRoutes.atLeast, `got ${httpFiles.length}`);
  }
  if (exp.httpRoutes?.mustInclude) {
    for (const f of exp.httpRoutes.mustInclude) check(`http_route includes ${f}`, httpFiles.includes(f));
  }

  if (exp.socketEvents?.exact) {
    const want = [...exp.socketEvents.exact].sort();
    const got = [
      ...new Set(
        entrypoints
          .filter((e) => (e.routePattern ?? '').startsWith('socket:'))
          .map((e) => e.routePattern!.slice('socket:'.length)),
      ),
    ].sort();
    check(`socket events: ${want.length} expected`, JSON.stringify(want) === JSON.stringify(got), diffList(want, got));
  }

  // Known gaps are printed, never asserted — they are the work not yet done,
  // and burying them would make this report read cleaner than the product is.
  for (const gap of truth.knownGaps ?? []) console.log(`    ⚠ known gap: ${gap}`);
}

console.log(`\n  ${checks - failures}/${checks} checks passed\n`);
process.exit(failures);
