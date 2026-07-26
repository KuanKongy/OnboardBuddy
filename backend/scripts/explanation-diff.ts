/**
 * Generalization gate for generated PROSE — the explanation half of what
 * `truth-diff.ts` does for extraction.
 *
 * `npm run truth` clones real repos and asks "did the parser find the right
 * routes?". This asks the question the reviewer actually raised: *"test your
 * features versus various projects since some of your features or prompts may
 * not generalize well"*. It runs every stored explanation for five
 * deliberately different repo shapes through `explanationLint.ts` and scores
 * PROPERTIES, never exact text.
 *
 *   npm run explain
 *   npm run explain -- --repos /path/to/clones      # reuse existing clones
 *   npm run explain -- --only skribbl
 *   npm run explain -- --no-db                      # shape probe only
 *   npm run explain -- --verbose                    # print every finding
 *
 * Two phases, and the split is the point:
 *
 *   PHASE 1 — SHAPE (always runs, no DB, no LLM). Re-derives each fixture's
 *     claimed shape from the clone. This is what makes the fixture set
 *     trustworthy: a reader can see the five repos really are different, and
 *     a fixture that quietly stops matching its repo fails here.
 *
 *   PHASE 2 — PROSE (needs the database). Loads whatever the pipeline actually
 *     stored for that repo — package sections, cluster summaries, capability
 *     descriptions — and scores it. Generating fresh prose needs an LLM and a
 *     worker; this scores what is there and SKIPS LOUDLY when there is
 *     nothing, printing exactly what is missing and how to produce it. It
 *     never silently passes a repo it did not read.
 *
 * Exit code is the number of failed checks, so CI can gate on it. Budgets in
 * the fixtures are today's MEASURED debt, not aspirations — the gate catches
 * regressions, which is the only honest way to introduce a quality gate over
 * prose that has never had one.
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildRepoIndex, scanRepositoryFiles, buildLanguageInventory } from '../src/worker/engine/repoIngester.js';
import { typescriptParser } from '../src/worker/engine/parserInterface.js';
import { createProgram, parseSourceFile } from '../src/worker/engine/astParser.js';
import { extractFileAnalysis } from '../src/worker/engine/symbolExtractor.js';
import { detectEntrypoints } from '../src/worker/engine/entrypointDetector.js';
import { lintExplanation, type ExplanationFinding, type ExplanationEvidence } from '../src/worker/generation/explanationLint.js';
import { SECTION_SPECS, type SectionType } from '../src/worker/generation/sectionSpecs.js';
import { pool, query } from '../src/lib/db.js';

// ── fixture shape ───────────────────────────────────────────────────────────

interface GoldenFixture {
  repo: string;
  clone: string;
  shape: string;
  whyThisShape: string;
  labeledOn: string;
  labeledFrom: string;
  /** Deterministic assertions that the repo really has the shape claimed. */
  expectShape: {
    entrypointKinds?: { mustInclude?: string[]; mustExclude?: string[] };
    uiRoutesAtLeast?: number;
    httpRoutesAtLeast?: number;
    maxEntrypoints?: number;
    /** Source languages present in the tree that no parser reads. */
    unparsedLanguages?: string[];
  };
  /** The repo's own vocabulary — prose naming none of it is about some other program. */
  domainNouns: string[];
  /** Coverage facts the package must admit ("Python", "FastAPI"). */
  mustDisclose?: string[];
  /** Today's measured numbers. Lower them as quality improves; never raise silently. */
  budgets: {
    minDomainNounsInPackage: number;
    minCitedShare: number;
    maxNarrationErrors: number;
    maxLevelErrors: number;
    minSectionsDisclosingGaps: number;
  };
  /** Printed, never asserted — the work not yet done. */
  knownGaps?: string[];
  /** True when the product cannot analyse this repo (third-party, no installation). */
  proseUnavailable?: string;
}

// ── cli ─────────────────────────────────────────────────────────────────────

const GOLDEN_DIR = path.resolve(import.meta.dirname, '../test/golden');
const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const hasFlag = (flag: string): boolean => process.argv.includes(flag);
const REPOS_DIR = path.resolve(argOf('--repos') ?? path.resolve(import.meta.dirname, '../.truth-repos'));
const ONLY = argOf('--only');
const NO_DB = hasFlag('--no-db');
const VERBOSE = hasFlag('--verbose');

let failures = 0;
let checks = 0;
let scoredRepos = 0;
let skippedRepos = 0;

function check(label: string, ok: boolean, detail?: string): void {
  checks++;
  if (ok) {
    console.log(`    ✓ ${label}`);
  } else {
    failures++;
    console.log(`    ✗ ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

function skip(label: string, why: string): void {
  skippedRepos++;
  console.log(`    ⚠ NOT SCORED — ${label}`);
  console.log(`      ${why}`);
}

// ── phase 1: deterministic shape probe ──────────────────────────────────────

interface Shape {
  filesInScope: number;
  parsedFiles: number;
  entrypointKinds: Record<string, number>;
  uiRoutes: number;
  httpRoutes: number;
  totalEntrypoints: number;
  unparsedLanguages: Record<string, number>;
}

async function probeShape(dir: string): Promise<Shape> {
  const index = await buildRepoIndex(dir);
  // Same selector as analysisRunner.ts — anything else silently drops .js.
  const files = index.files.filter((f) => typescriptParser.supports(f.absolutePath));
  const program = createProgram(files, dir);
  const analyses = files.map((f) => extractFileAnalysis(parseSourceFile(program, f.absolutePath), dir));
  const entrypoints = detectEntrypoints(analyses);

  const kinds: Record<string, number> = {};
  for (const e of entrypoints) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;

  const inventory = buildLanguageInventory(await scanRepositoryFiles(dir));

  return {
    filesInScope: index.files.length,
    parsedFiles: analyses.length,
    entrypointKinds: kinds,
    uiRoutes: kinds.ui_route ?? 0,
    httpRoutes: kinds.http_route ?? 0,
    totalEntrypoints: entrypoints.length,
    unparsedLanguages: inventory.unsupported,
  };
}

function checkShape(fx: GoldenFixture, shape: Shape): void {
  const exp = fx.expectShape;
  console.log(
    `    shape: ${shape.parsedFiles}/${shape.filesInScope} files parsed · ` +
      `${shape.totalEntrypoints} entrypoints ${JSON.stringify(shape.entrypointKinds)}` +
      (Object.keys(shape.unparsedLanguages).length > 0
        ? ` · unread: ${JSON.stringify(shape.unparsedLanguages)}`
        : ''),
  );

  for (const kind of exp.entrypointKinds?.mustInclude ?? []) {
    check(`shape: has ${kind} entrypoints`, (shape.entrypointKinds[kind] ?? 0) > 0, `got ${JSON.stringify(shape.entrypointKinds)}`);
  }
  for (const kind of exp.entrypointKinds?.mustExclude ?? []) {
    check(`shape: has NO ${kind} entrypoints`, (shape.entrypointKinds[kind] ?? 0) === 0, `got ${shape.entrypointKinds[kind]}`);
  }
  if (exp.uiRoutesAtLeast !== undefined) {
    check(`shape: ui_routes >= ${exp.uiRoutesAtLeast}`, shape.uiRoutes >= exp.uiRoutesAtLeast, `got ${shape.uiRoutes}`);
  }
  if (exp.httpRoutesAtLeast !== undefined) {
    check(`shape: http_routes >= ${exp.httpRoutesAtLeast}`, shape.httpRoutes >= exp.httpRoutesAtLeast, `got ${shape.httpRoutes}`);
  }
  if (exp.maxEntrypoints !== undefined) {
    check(`shape: <= ${exp.maxEntrypoints} entrypoints (few-entrypoint repo)`, shape.totalEntrypoints <= exp.maxEntrypoints, `got ${shape.totalEntrypoints}`);
  }
  for (const lang of exp.unparsedLanguages ?? []) {
    const n = shape.unparsedLanguages[lang] ?? 0;
    check(`shape: ${n} ${lang} source files present and unread`, n > 0, `no ${lang} files classified unsupported`);
  }
}

// ── phase 2: prose scoring ──────────────────────────────────────────────────

interface StoredSection {
  type: string;
  content: string;
}

interface StoredPackage {
  snapshotId: string;
  sections: StoredSection[];
  clusterLabels: string[];
  capabilities: Array<{ name: string; description: string | null }>;
  parsedFileCount: number | null;
  fileCount: number | null;
}

async function loadStoredPackage(repoFullName: string): Promise<StoredPackage | null> {
  const project = (await query(`SELECT id FROM projects WHERE repo_full_name = $1 LIMIT 1`, [repoFullName]))
    .rows[0] as { id: string } | undefined;
  if (!project) return null;

  const snap = (await query(
    `SELECT s.id, s.parsed_file_count, s.file_count
     FROM analysis_snapshots s
     WHERE s.project_id = $1 AND s.status = 'complete'
     ORDER BY s.created_at DESC LIMIT 1`,
    [project.id],
  )).rows[0] as { id: string; parsed_file_count: number | null; file_count: number | null } | undefined;
  if (!snap) return null;

  const sections = (await query(
    `SELECT DISTINCT ON (ps.type) ps.type, ps.content
     FROM package_sections ps
     WHERE ps.snapshot_id = $1 AND ps.content IS NOT NULL AND length(ps.content) > 0
     ORDER BY ps.type, ps.created_at DESC`,
    [snap.id],
  )).rows as StoredSection[];
  if (sections.length === 0) return null;

  const clusterLabels = ((await query(
    `SELECT label FROM architecture_clusters WHERE snapshot_id = $1 ORDER BY critical_score DESC`,
    [snap.id],
  )).rows as Array<{ label: string }>).map((r) => r.label);

  const capabilities = (await query(
    `SELECT name, description FROM capabilities WHERE snapshot_id = $1`,
    [snap.id],
  )).rows as Array<{ name: string; description: string | null }>;

  return {
    snapshotId: snap.id,
    sections,
    clusterLabels,
    capabilities,
    parsedFileCount: snap.parsed_file_count,
    fileCount: snap.file_count,
  };
}

/** Splits a section into `## Heading` / `### Heading` slices, heading text kept. */
function sliceByHeading(markdown: string, level: 2 | 3): Array<{ heading: string; body: string }> {
  const marker = level === 2 ? /^##\s+(?!#)(.+)$/ : /^###\s+(?!#)(.+)$/;
  const out: Array<{ heading: string; body: string }> = [];
  let heading: string | null = null;
  let body: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = fenced ? null : line.match(marker);
    if (m) {
      if (heading !== null) out.push({ heading, body: body.join('\n') });
      heading = m[1]!.replace(/[`*_]/g, '').trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  if (heading !== null) out.push({ heading, body: body.join('\n') });
  return out;
}

interface ProseScore {
  narrationErrors: number;
  levelErrors: number;
  claimBlocks: number;
  citedBlocks: number;
  sectionsDisclosingGaps: number;
  domainNounsHit: Set<string>;
  findings: Array<{ where: string; finding: ExplanationFinding }>;
}

const EMPTY_SCORE = (): ProseScore => ({
  narrationErrors: 0,
  levelErrors: 0,
  claimBlocks: 0,
  citedBlocks: 0,
  sectionsDisclosingGaps: 0,
  domainNounsHit: new Set(),
  findings: [],
});

function lintInto(score: ProseScore, where: string, markdown: string, evidence: ExplanationEvidence): void {
  const r = lintExplanation(markdown, evidence);
  score.claimBlocks += r.stats.claimBlocks;
  score.citedBlocks += r.stats.citedBlocks;
  for (const n of r.stats.domainNounsHit) score.domainNounsHit.add(n);
  for (const f of r.findings) {
    if (f.severity !== 'error') continue;
    if (f.rule === 'narration') score.narrationErrors++;
    if (f.rule === 'level') score.levelErrors++;
    score.findings.push({ where, finding: f });
  }
}

/**
 * The ORIENT/UNDERSTAND sections are where a coverage gap has to be admitted:
 * a reader who never reaches CONSULT still has to learn the backend was not
 * read.
 */
const DISCLOSURE_SECTIONS = new Set(['big_picture', 'architecture_deep', 'capabilities', 'code_map', 'concepts']);

function scorePackage(fx: GoldenFixture, pkg: StoredPackage): ProseScore {
  const score = EMPTY_SCORE();

  for (const section of pkg.sections) {
    const spec = SECTION_SPECS[section.type as SectionType];
    const mode = spec?.mode ?? 'explanation';
    const evidence: ExplanationEvidence = { scope: { kind: 'section' }, domainNouns: fx.domainNouns, mode };
    lintInto(score, `section:${section.type}`, section.content, evidence);
    if (lintExplanation(section.content, evidence).stats.disclosesGaps) score.sectionsDisclosingGaps++;

    // Cluster altitude: each `## <cluster>` subsection is judged as a cluster
    // summary, so "explains the repo instead of this cluster" is measurable.
    if (section.type === 'architecture_deep' && pkg.clusterLabels.length > 0) {
      for (const slice of sliceByHeading(section.content, 2)) {
        const label = pkg.clusterLabels.find((l) => headingMatchesLabel(slice.heading, l));
        if (!label || slice.body.trim().length === 0) continue;
        lintInto(score, `cluster:${label}`, slice.body, {
          scope: { kind: 'cluster', subject: label, siblings: pkg.clusterLabels.filter((l) => l !== label) },
          domainNouns: fx.domainNouns,
          mode: 'explanation',
        });
      }
    }

    // Capability descriptions: same treatment one level down.
    if (section.type === 'capabilities' && pkg.capabilities.length > 0) {
      for (const slice of sliceByHeading(section.content, 3)) {
        const cap = pkg.capabilities.find((c) => headingMatchesLabel(slice.heading, c.name));
        if (!cap || slice.body.trim().length === 0) continue;
        lintInto(score, `capability:${cap.name}`, slice.body, {
          scope: { kind: 'capability', subject: cap.name, siblings: pkg.capabilities.map((c) => c.name).filter((n) => n !== cap.name) },
          domainNouns: fx.domainNouns,
          mode: 'explanation',
        });
      }
    }
  }

  // Stored capability descriptions are generated prose too, and they are what
  // the "Capabilities" tab renders — lint them at their own level.
  for (const cap of pkg.capabilities) {
    if (!cap.description) continue;
    lintInto(score, `capability-description:${cap.name}`, cap.description, {
      scope: { kind: 'capability', subject: cap.name },
      mode: 'explanation',
    });
  }

  return score;
}

/** 'Server · Modules' vs '## Server · Modules' — punctuation-insensitive. */
function headingMatchesLabel(heading: string, label: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(heading) === norm(label);
}

function scoreProperties(fx: GoldenFixture, pkg: StoredPackage, score: ProseScore): void {
  const b = fx.budgets;

  // Printed on every run, pass or fail: these are the numbers a fixture's
  // budgets are set from, and a budget you cannot re-derive is a magic number.
  const measuredShare = score.claimBlocks === 0 ? 1 : score.citedBlocks / score.claimBlocks;
  console.log(
    `    measured: domainNouns=${score.domainNounsHit.size}/${fx.domainNouns.length} · ` +
      `cited=${(measuredShare * 100).toFixed(1)}% (${score.citedBlocks}/${score.claimBlocks}) · ` +
      `narrationErrors=${score.narrationErrors} · levelErrors=${score.levelErrors} · ` +
      `sectionsWithGaps=${score.sectionsDisclosingGaps}/${pkg.sections.length}`,
  );

  // P1 — names the repo's real domain nouns.
  const hit = [...score.domainNounsHit];
  check(
    `P1 domain nouns: >= ${b.minDomainNounsInPackage} of ${fx.domainNouns.length} appear`,
    hit.length >= b.minDomainNounsInPackage,
    `got ${hit.length}: [${hit.join(', ')}] — missing [${fx.domainNouns.filter((n) => !score.domainNounsHit.has(n)).join(', ')}]`,
  );

  // P2 — every claim carries a receipt.
  const share = score.claimBlocks === 0 ? 1 : score.citedBlocks / score.claimBlocks;
  check(
    `P2 receipts: >= ${(b.minCitedShare * 100).toFixed(0)}% of claim paragraphs cited`,
    share >= b.minCitedShare,
    `got ${(share * 100).toFixed(1)}% (${score.citedBlocks}/${score.claimBlocks})`,
  );

  // P3 — discloses what was not read.
  check(
    `P3 disclosure: >= ${b.minSectionsDisclosingGaps} section(s) name a gap`,
    score.sectionsDisclosingGaps >= b.minSectionsDisclosingGaps,
    `got ${score.sectionsDisclosingGaps} of ${pkg.sections.length}`,
  );
  const orientText = pkg.sections
    .filter((s) => DISCLOSURE_SECTIONS.has(s.type))
    .map((s) => s.content)
    .join('\n')
    .toLowerCase();
  for (const required of fx.mustDisclose ?? []) {
    check(
      `P3 disclosure: the unread "${required}" subsystem is named`,
      orientText.includes(required.toLowerCase()),
      `no ORIENT/UNDERSTAND section mentions "${required}" — the package reads as if this repo has no such code`,
    );
  }

  // P4 — trips no screen-narration finding.
  check(
    `P4 narration: <= ${b.maxNarrationErrors} error-severity finding(s)`,
    score.narrationErrors <= b.maxNarrationErrors,
    `got ${score.narrationErrors}` + topCodes(score, 'narration'),
  );

  // P5 — a cluster summary mentions that cluster rather than the repo.
  check(
    `P5 altitude: <= ${b.maxLevelErrors} level finding(s)`,
    score.levelErrors <= b.maxLevelErrors,
    `got ${score.levelErrors}` + topCodes(score, 'level'),
  );
}

function topCodes(score: ProseScore, rule: string): string {
  const counts = new Map<string, number>();
  for (const { finding } of score.findings) {
    if (finding.rule !== rule) continue;
    counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const rendered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(', ');
  return ` — ${rendered}`;
}

function printFindings(score: ProseScore, limit: number): void {
  const shown = VERBOSE ? score.findings : score.findings.slice(0, limit);
  for (const { where, finding } of shown) {
    console.log(`      [${finding.code}] ${where}`);
    console.log(`        "${finding.sentence.slice(0, 150)}${finding.sentence.length > 150 ? '…' : ''}"`);
  }
  if (!VERBOSE && score.findings.length > limit) {
    console.log(`      … ${score.findings.length - limit} more (run with --verbose)`);
  }
}

// ── clone management (same contract as truth-diff) ──────────────────────────

function ensureClone(fx: GoldenFixture, slug: string): string | null {
  const dir = path.join(REPOS_DIR, slug);
  if (fs.existsSync(dir)) return dir;
  // Directory names in a shared clone cache follow the repo name, not the slug.
  const byRepoName = path.join(REPOS_DIR, fx.repo.split('/')[1] ?? '');
  if (fs.existsSync(byRepoName)) return byRepoName;
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  try {
    console.log(`    cloning ${fx.clone} …`);
    execFileSync('git', ['clone', '--depth', '1', '-q', fx.clone, dir], { stdio: 'inherit' });
    return dir;
  } catch {
    console.log(`    ⚠ could not clone ${fx.clone} — skipping shape probe (network?)`);
    return null;
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const files = fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) throw new Error(`No golden fixtures in ${GOLDEN_DIR}`);

let dbUsable = !NO_DB;
if (dbUsable) {
  try {
    await query('SELECT 1');
  } catch (err) {
    dbUsable = false;
    console.log(`\n  ⚠ DATABASE UNREACHABLE (${(err as Error).message}) — prose scoring is SKIPPED for every repo.`);
    console.log('    The shape probe below still runs. Nothing is being judged on generated text.');
  }
}

console.log(`\n  Explanation generalization gate — ${files.length} repo shape(s)\n`);

for (const file of files) {
  const slug = path.basename(file, '.json');
  if (ONLY && slug !== ONLY) continue;
  const fx = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, file), 'utf8')) as GoldenFixture;

  console.log(`\n  ${fx.repo}  —  ${fx.shape}`);
  console.log(`    why this shape: ${fx.whyThisShape}`);

  // PHASE 1 — shape
  const dir = ensureClone(fx, slug);
  if (dir) {
    checkShape(fx, await probeShape(dir));
  }

  // PHASE 2 — prose
  if (!dbUsable) {
    skip(`${fx.repo} prose`, NO_DB ? '--no-db was passed.' : 'the database is unreachable (see above).');
  } else {
    const pkg = await loadStoredPackage(fx.repo).catch((err: Error) => {
      console.log(`    ⚠ query failed: ${err.message}`);
      return null;
    });
    if (!pkg) {
      skip(
        `${fx.repo} prose`,
        fx.proseUnavailable ??
          `No complete snapshot with generated sections is stored for "${fx.repo}". ` +
            'Analyse it in the app (or enqueue analyze_scope + generate_package) and re-run. ' +
            'NOTHING about this repo\'s explanations has been verified.',
      );
    } else {
      scoredRepos++;
      console.log(
        `    prose: snapshot ${pkg.snapshotId.slice(0, 8)} · ${pkg.sections.length} sections · ` +
          `${pkg.clusterLabels.length} clusters · ${pkg.capabilities.length} capabilities · ` +
          `${pkg.parsedFileCount}/${pkg.fileCount} files parsed`,
      );
      const score = scorePackage(fx, pkg);
      scoreProperties(fx, pkg, score);
      if (score.findings.length > 0) {
        console.log(`    findings (${score.findings.length}):`);
        printFindings(score, 6);
      }
    }
  }

  for (const gap of fx.knownGaps ?? []) console.log(`    ⚠ known gap: ${gap}`);
}

console.log(`\n  ── SUMMARY ─────────────────────────────────────────────────`);
console.log(`  ${checks - failures}/${checks} checks passed`);
console.log(`  ${scoredRepos} repo(s) scored on real prose · ${skippedRepos} NOT SCORED`);
if (skippedRepos > 0) {
  console.log('  A NOT SCORED repo is not a pass. Nothing about its explanations was verified.');
}
console.log('');

await pool.end();
process.exit(failures);
