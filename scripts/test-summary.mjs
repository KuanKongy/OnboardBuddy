#!/usr/bin/env node
/**
 * Runs every automated suite and prints a per-area pass/fail summary at the end.
 *
 *   docker compose -f docker-compose.test.yml run --rm test
 *   npm test                                  # same thing, with Node installed
 *
 * Every number printed here is parsed from the test runners' own machine-readable
 * output — mocha writes JSON through scripts/mocha-spec-json.cjs, vitest through its
 * built-in `json` reporter, playwright through `--list --reporter=json`. Nothing is
 * hardcoded, and nothing is scraped from human-readable text. If a runner does not
 * produce its JSON, or the per-area counts do not add up to the runner's own total,
 * this script fails loudly instead of reporting a comfortable zero.
 *
 * Exit code is non-zero if any area failed, or if any count could not be trusted.
 *
 * Environment:
 *   RUN_E2E=1           actually execute the Playwright suite (needs a browser +
 *                       a dev server). Default: discovered but not executed.
 *   TEST_RESULTS_DIR    where the JSON artefacts are written (default: a temp dir).
 *   NO_COLOR=1          plain output.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS_DIR =
  process.env.TEST_RESULTS_DIR || path.join(os.tmpdir(), "onboardbuddy-test-results");
const MOCHA_REPORTER = path.join(ROOT, "scripts", "mocha-spec-json.cjs");

const RUN_E2E = process.env.RUN_E2E === "1";

/* ────────────────────────────────────────────────────────────────────────────
 * Areas. A backend test is bucketed by the file it lives in; the first matching
 * rule wins, so the security rule (which cuts across directories) is listed first.
 * ──────────────────────────────────────────────────────────────────────────── */

const SECURITY_FILES = new Set([
  "src/worker/generation/__tests__/markdownSanitizer.test.ts",
  "src/worker/generation/__tests__/promptInjection.test.ts",
  "src/worker/__tests__/zipSafety.test.ts",
  "src/lib/__tests__/githubRefSafety.test.ts",
]);

const BACKEND_AREAS = [
  {
    id: "backend-security",
    label: "Backend · security (hostile input)",
    match: (rel) => SECURITY_FILES.has(rel),
  },
  {
    id: "backend-analysis",
    label: "Backend · analysis pipeline",
    match: (rel) =>
      rel.startsWith("src/worker/engine/") ||
      rel.startsWith("src/worker/__tests__/") ||
      rel.startsWith("test/analysis/") ||
      rel.startsWith("test/ranking/") ||
      rel.startsWith("test/incremental-reanalysis/"),
  },
  {
    id: "backend-ai",
    label: "Backend · AI, caching & model routing",
    match: (rel) =>
      rel.startsWith("src/worker/ai/") ||
      rel.startsWith("src/worker/semantic/") ||
      rel.startsWith("test/ai/"),
  },
  {
    id: "backend-generation",
    label: "Backend · document generation",
    match: (rel) => rel.startsWith("src/worker/generation/") || rel.startsWith("test/golden/"),
  },
  {
    id: "backend-api",
    label: "Backend · API & auth (HTTP)",
    match: (rel) => rel.startsWith("test/api/"),
  },
  {
    id: "backend-unit",
    label: "Backend · unit (libs, queue, crypto)",
    match: (rel) =>
      rel.startsWith("src/lib/") || rel.startsWith("test/lib/") || rel.startsWith("test/worker/"),
  },
];

const BACKEND_UNCLASSIFIED = {
  id: "backend-other",
  label: "Backend · other (unclassified files)",
};

/* ────────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `[${code}m${s}[0m` : s);
const green = (s) => c("32", s);
const red = (s) => c("31;1", s);
const yellow = (s) => c("33", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);

const out = (s = "") => process.stdout.write(`${s}\n`);

/** Problems that mean "the numbers cannot be trusted" — always fatal. */
const integrityErrors = [];
function integrity(message) {
  integrityErrors.push(message);
}

/** Things a maintainer should fix, but which do not make the reported counts wrong. */
const warnings = [];
function warn(message) {
  warnings.push(message);
}

function emptyCounts() {
  return { passed: 0, failed: 0, skipped: 0 };
}

const runnerTotalNonZero = (stats) =>
  (stats?.passes || 0) + (stats?.failures || 0) + (stats?.pending || 0) > 0;

/** Pad ignoring ANSI escapes, so coloured cells still line up. */
const visibleLength = (s) => s.replace(/\[[0-9;]*m/g, "").length;
const padLeft = (s, w) => " ".repeat(Math.max(0, w - visibleLength(s))) + s;
const padRight = (s, w) => s + " ".repeat(Math.max(0, w - visibleLength(s)));

/** Hard ceiling per suite, so a wedged runner reports a failure instead of hanging forever. */
const SUITE_TIMEOUT_MS = Number(process.env.SUITE_TIMEOUT_MS || 15 * 60 * 1000);

function run(command, args, cwd, extraEnv = {}) {
  // npm leaks `npm_config_workspace` into child processes, which would make a nested
  // `npm test -w frontend` run the wrong workspace. Strip anything workspace-scoped.
  const env = { ...process.env, ...extraEnv };
  for (const key of Object.keys(env)) {
    if (/^npm_config_workspaces?$/i.test(key)) delete env[key];
  }
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    timeout: SUITE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (result.error) {
    return { code: 127, error: result.error.message };
  }
  if (result.signal) {
    return {
      code: 1,
      error: `killed by signal ${result.signal} (suite timeout is ${SUITE_TIMEOUT_MS}ms)`,
    };
  }
  return { code: result.status ?? 1 };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { __error: err.message };
  }
}

function banner(text) {
  out();
  out(bold(`── ${text} ${"─".repeat(Math.max(0, 74 - text.length))}`));
  out();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Backend — mocha
 * ──────────────────────────────────────────────────────────────────────────── */

function runBackend() {
  const jsonFile = path.join(RESULTS_DIR, "backend-mocha.json");
  fs.rmSync(jsonFile, { force: true });

  banner("Backend suite (mocha)");
  const { code, error } = run(
    "npm",
    [
      "test",
      "-w",
      "backend",
      "--",
      "--reporter",
      MOCHA_REPORTER,
      "--reporter-option",
      `output=${jsonFile}`,
    ],
    ROOT,
  );

  const areas = new Map();
  for (const area of BACKEND_AREAS) areas.set(area.id, { ...area, ...emptyCounts() });

  if (!fs.existsSync(jsonFile)) {
    integrity(
      `mocha produced no machine-readable output at ${jsonFile}` +
        ` (exit ${code}${error ? `, ${error}` : ""}). Backend counts are unknown, not zero.`,
    );
    return {
      runner: "mocha",
      jsonFile,
      ok: false,
      hardFailure: true,
      areas: [...areas.values()],
      failures: [],
      stats: null,
      fileCount: 0,
      exitCode: code,
    };
  }

  const report = readJson(jsonFile);
  if (report.__error) {
    integrity(`mocha JSON at ${jsonFile} is unreadable: ${report.__error}`);
    return {
      runner: "mocha",
      jsonFile,
      ok: false,
      hardFailure: true,
      areas: [...areas.values()],
      failures: [],
      stats: null,
      fileCount: 0,
      exitCode: code,
    };
  }

  const backendRoot = path.join(ROOT, "backend");
  const files = new Set();
  const unclassified = new Map();
  const failures = [];

  for (const test of report.tests || []) {
    const rel = test.file ? path.relative(backendRoot, test.file).split(path.sep).join("/") : "";
    files.add(rel);

    let bucket = null;
    for (const area of BACKEND_AREAS) {
      if (area.match(rel)) {
        bucket = areas.get(area.id);
        break;
      }
    }
    if (!bucket) {
      if (!areas.has(BACKEND_UNCLASSIFIED.id)) {
        areas.set(BACKEND_UNCLASSIFIED.id, { ...BACKEND_UNCLASSIFIED, ...emptyCounts() });
      }
      bucket = areas.get(BACKEND_UNCLASSIFIED.id);
      unclassified.set(rel, (unclassified.get(rel) || 0) + 1);
    }

    if (test.state === "passed") bucket.passed += 1;
    else if (test.state === "failed") {
      bucket.failed += 1;
      failures.push({
        area: bucket.label,
        title: test.fullTitle,
        file: rel,
        message: test.err?.message || "(no message)",
      });
    } else bucket.skipped += 1;
  }

  const stats = report.stats || {};
  const runnerTotal = (stats.passes || 0) + (stats.failures || 0) + (stats.pending || 0);
  const bucketed = [...areas.values()].reduce((n, a) => n + a.passed + a.failed + a.skipped, 0);

  if (runnerTotal === 0) {
    integrity(
      `mocha reported 0 tests. The backend suite is expected to run hundreds — ` +
        `treat this as a broken run, not an empty one.`,
    );
  }
  if (bucketed !== runnerTotal) {
    integrity(
      `backend per-area counts (${bucketed}) do not add up to mocha's own total (${runnerTotal}).`,
    );
  }
  // The security area is the one defined by an explicit file list, so it is the one that
  // could silently shrink if a file were renamed. Say so rather than quietly reporting less.
  const missingSecurity = [...SECURITY_FILES].filter((f) => !files.has(f));
  if (missingSecurity.length > 0 && runnerTotalNonZero(stats)) {
    integrity(
      `these security test files did not run — the security count is understated, not lower:` +
        `\n      ${missingSecurity.join("\n      ")}`,
    );
  }
  if (unclassified.size > 0) {
    // Not fatal: these tests are still counted, in a row that says so. But a new test
    // directory should get its own area rather than living in a catch-all.
    warn(
      `${unclassified.size} backend test file(s) matched no area rule and were counted under ` +
        `"${BACKEND_UNCLASSIFIED.label}". Add them to BACKEND_AREAS in scripts/test-summary.mjs:` +
        `\n      ${[...unclassified.keys()].join("\n      ")}`,
    );
  }
  if (code === 0 && stats.failures > 0) {
    integrity(`mocha exited 0 while reporting ${stats.failures} failing test(s).`);
  }
  if (code !== 0 && (stats.failures || 0) === 0) {
    integrity(
      `mocha exited ${code} but reported no failing test — the runner itself failed` +
        ` (crash, timeout, or setup error)${error ? `: ${error}` : ""}.`,
    );
  }

  return {
    runner: "mocha",
    jsonFile,
    ok: code === 0 && (stats.failures || 0) === 0,
    hardFailure: false,
    areas: [...areas.values()],
    failures,
    stats,
    fileCount: files.size,
    exitCode: code,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Frontend — vitest
 * ──────────────────────────────────────────────────────────────────────────── */

function runFrontend() {
  const jsonFile = path.join(RESULTS_DIR, "frontend-vitest.json");
  fs.rmSync(jsonFile, { force: true });

  banner("Frontend suite (vitest)");
  const { code, error } = run(
    "npm",
    [
      "test",
      "-w",
      "frontend",
      "--",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${jsonFile}`,
    ],
    ROOT,
  );

  const area = {
    id: "frontend-unit",
    label: "Frontend · unit (components, pages, safe rendering)",
    ...emptyCounts(),
  };

  if (!fs.existsSync(jsonFile)) {
    integrity(
      `vitest produced no machine-readable output at ${jsonFile}` +
        ` (exit ${code}${error ? `, ${error}` : ""}). Frontend counts are unknown, not zero.`,
    );
    return {
      runner: "vitest",
      jsonFile,
      ok: false,
      hardFailure: true,
      areas: [area],
      failures: [],
      stats: null,
      fileCount: 0,
      exitCode: code,
    };
  }

  const report = readJson(jsonFile);
  if (report.__error) {
    integrity(`vitest JSON at ${jsonFile} is unreadable: ${report.__error}`);
    return {
      runner: "vitest",
      jsonFile,
      ok: false,
      hardFailure: true,
      areas: [area],
      failures: [],
      stats: null,
      fileCount: 0,
      exitCode: code,
    };
  }

  const failures = [];
  for (const suite of report.testResults || []) {
    const rel = suite.name
      ? path.relative(path.join(ROOT, "frontend"), suite.name).split(path.sep).join("/")
      : "(unknown file)";
    for (const test of suite.assertionResults || []) {
      if (test.status === "passed") area.passed += 1;
      else if (test.status === "failed") {
        area.failed += 1;
        failures.push({
          area: area.label,
          title: test.fullName || test.title,
          file: rel,
          message: (test.failureMessages || [])[0]?.split("\n")[0] || "(no message)",
        });
      } else area.skipped += 1;
    }
  }

  const runnerTotal = report.numTotalTests ?? 0;
  const bucketed = area.passed + area.failed + area.skipped;

  if (runnerTotal === 0) {
    integrity(`vitest reported 0 tests. The frontend suite is expected to run over a hundred.`);
  }
  if (bucketed !== runnerTotal) {
    integrity(
      `frontend per-area counts (${bucketed}) do not add up to vitest's own total (${runnerTotal}).`,
    );
  }
  if (code === 0 && (report.numFailedTests || 0) > 0) {
    integrity(`vitest exited 0 while reporting ${report.numFailedTests} failing test(s).`);
  }
  if (code !== 0 && (report.numFailedTests || 0) === 0) {
    integrity(
      `vitest exited ${code} but reported no failing test — the runner itself failed` +
        ` (crash, timeout, or setup error)${error ? `: ${error}` : ""}.`,
    );
  }

  return {
    runner: "vitest",
    jsonFile,
    ok: code === 0 && (report.numFailedTests || 0) === 0,
    hardFailure: false,
    areas: [area],
    failures,
    stats: {
      tests: report.numTotalTests,
      passes: report.numPassedTests,
      failures: report.numFailedTests,
      pending: (report.numPendingTests || 0) + (report.numTodoTests || 0),
    },
    fileCount: (report.testResults || []).length,
    exitCode: code,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * E2E — Playwright. Discovered always, executed only with RUN_E2E=1, because the
 * test image has no browser. Reported as SKIPPED rather than quietly omitted.
 * ──────────────────────────────────────────────────────────────────────────── */

function playwrightBrowsersPresent() {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), "AppData", "Local", "ms-playwright"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.readdirSync(dir).some((entry) => entry.startsWith("chromium"))) return true;
    } catch {
      /* not there */
    }
  }
  return false;
}

/** Count `*.spec.ts` under frontend/e2e — the fallback when playwright itself cannot answer. */
function countSpecFiles(frontend) {
  let specFiles = 0;
  const walkDir = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.name.endsWith(".spec.ts")) specFiles += 1;
    }
  };
  try {
    walkDir(path.join(frontend, "e2e"));
  } catch {
    /* no e2e dir */
  }
  return specFiles;
}

function e2eArea() {
  const frontend = path.join(ROOT, "frontend");
  const area = { id: "e2e", label: "E2E · Playwright (browser)", ...emptyCounts() };

  // Resolve the local binary rather than shelling out to `npx`: npx would try to
  // *download* playwright if it were missing, and this run must work offline.
  const pwBin = path.join(ROOT, "node_modules", ".bin", "playwright");
  if (!fs.existsSync(pwBin)) {
    const specFiles = countSpecFiles(frontend);
    area.skipped = specFiles;
    return {
      area,
      ok: true,
      status: "SKIPPED",
      note: `not run — playwright is not installed here; ${specFiles} spec file(s) on disk`,
      failures: [],
    };
  }

  if (RUN_E2E) {
    const jsonFile = path.join(RESULTS_DIR, "e2e-playwright.json");
    fs.rmSync(jsonFile, { force: true });
    banner("End-to-end suite (playwright)");
    // PLAYWRIGHT_JSON_OUTPUT_NAME redirects the json reporter to a file instead of stdout.
    const { code } = run(pwBin, ["test", "--reporter=json"], frontend, {
      PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
    });
    const report = fs.existsSync(jsonFile) ? readJson(jsonFile) : { __error: "no output file" };
    if (report.__error || !report.stats) {
      integrity(
        `playwright produced no usable JSON (exit ${code}). E2E counts are unknown, not zero.`,
      );
      return { area, ok: false, status: "ERROR", note: "runner produced no JSON", failures: [] };
    }
    area.passed = report.stats.expected || 0;
    area.failed = (report.stats.unexpected || 0) + (report.stats.flaky || 0);
    area.skipped = report.stats.skipped || 0;
    return {
      area,
      ok: code === 0 && area.failed === 0,
      status: area.failed === 0 && code === 0 ? "PASS" : "FAIL",
      note: `executed (RUN_E2E=1)`,
      failures: [],
    };
  }

  // Not executing: still get a *real* count of what exists, from playwright itself.
  // `--list` enumerates the specs without launching a browser or a dev server.
  const listed = spawnSync(pwBin, ["test", "--list", "--reporter=json"], {
    cwd: frontend,
    encoding: "utf8",
    env: process.env,
    timeout: 120_000,
  });

  let discovered = null;
  if (listed.status === 0 && listed.stdout) {
    try {
      const report = JSON.parse(
        listed.stdout.slice(listed.stdout.indexOf("{"), listed.stdout.lastIndexOf("}") + 1) || "{}",
      );
      let n = 0;
      const walk = (suite) => {
        n += (suite.specs || []).length;
        for (const child of suite.suites || []) walk(child);
      };
      for (const suite of report.suites || []) walk(suite);
      discovered = n;
    } catch {
      discovered = null;
    }
  }

  if (discovered === null) {
    // Fall back to counting spec files, and say so — never silently report 0.
    const specFiles = countSpecFiles(frontend);
    area.skipped = specFiles;
    return {
      area,
      ok: true,
      status: "SKIPPED",
      note: `not run — ${specFiles} spec file(s) found; playwright could not list tests here`,
      failures: [],
    };
  }

  area.skipped = discovered;
  const why = playwrightBrowsersPresent()
    ? "not run by default — set RUN_E2E=1 (needs a dev server on :5173)"
    : "not run — no browser in this image; on a host: npx playwright install chromium && RUN_E2E=1 npm test";
  return { area, ok: true, status: "SKIPPED", note: why, failures: [] };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Summary table
 * ──────────────────────────────────────────────────────────────────────────── */

function printSummary(rows, evidence, failures, overallOk) {
  const LABEL_W = Math.max(38, ...rows.map((r) => r.label.length));
  const NUM_W = 9;
  const RESULT_W = 10;
  const WIDTH = 2 + LABEL_W + NUM_W * 3 + RESULT_W;
  const rule = (ch) => out(dim("  " + ch.repeat(WIDTH - 2)));

  const statusText = (s) =>
    s === "PASS"
      ? green("PASS")
      : s === "FAIL"
        ? red("FAIL")
        : s === "ERROR"
          ? red("ERROR")
          : yellow("SKIPPED");

  const row = (label, passed, failed, skipped, status) =>
    "  " +
    padRight(label, LABEL_W) +
    padLeft(String(passed), NUM_W) +
    padLeft(String(failed), NUM_W) +
    padLeft(String(skipped), NUM_W) +
    padLeft(status, RESULT_W);

  out();
  out(bold("═".repeat(WIDTH)));
  out(bold("  OnboardBuddy — automated tests passing, by area"));
  out(bold("═".repeat(WIDTH)));
  out();
  out(bold(row("AREA", "PASSED", "FAILED", "SKIPPED", "RESULT")));
  rule("─");

  for (const r of rows) {
    out(row(r.label, r.passed, r.failed, r.skipped, statusText(r.status)));
  }

  rule("─");
  const total = rows.reduce(
    (acc, r) => ({
      passed: acc.passed + r.passed,
      failed: acc.failed + r.failed,
      skipped: acc.skipped + r.skipped,
    }),
    emptyCounts(),
  );
  out(
    bold(
      row(
        "TOTAL",
        total.passed,
        total.failed,
        total.skipped,
        statusText(overallOk ? "PASS" : "FAIL"),
      ),
    ),
  );
  out();

  out(dim("  Counts are parsed from each runner's own machine-readable output:"));
  for (const e of evidence) out(dim(`    ${e}`));
  out();

  if (failures.length > 0) {
    out(red(`  ${failures.length} FAILING TEST(S):`));
    out();
    const byArea = new Map();
    for (const f of failures) {
      if (!byArea.has(f.area)) byArea.set(f.area, []);
      byArea.get(f.area).push(f);
    }
    for (const [area, list] of byArea) {
      out(red(`  ▸ ${area}`));
      for (const f of list) {
        out(`      ✗ ${f.title}`);
        out(dim(`        ${f.file}`));
        out(dim(`        ${f.message}`));
      }
      out();
    }
  }

  if (warnings.length > 0) {
    out(yellow("  NOTE:"));
    for (const w of warnings) out(yellow(`    • ${w}`));
    out();
  }

  if (integrityErrors.length > 0) {
    out(red("  COUNTS CANNOT BE TRUSTED:"));
    for (const e of integrityErrors) out(red(`    ! ${e}`));
    out();
  }

  if (overallOk) {
    out(green(`  Overall: PASS — ${total.passed} tests passed, 0 failed. Exit code 0.`));
  } else if (total.failed > 0) {
    out(red(`  Overall: FAIL — ${total.failed} test(s) failed. Exit code 1.`));
  } else {
    out(red(`  Overall: FAIL — no test failed, but this run could not be verified. Exit code 1.`));
  }
  out();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Main
 * ──────────────────────────────────────────────────────────────────────────── */

fs.mkdirSync(RESULTS_DIR, { recursive: true });

const backend = runBackend();
const frontend = runFrontend();
const e2e = e2eArea();

const rows = [];
for (const area of backend.areas) {
  rows.push({ ...area, status: area.failed > 0 ? "FAIL" : backend.hardFailure ? "ERROR" : "PASS" });
}
for (const area of frontend.areas) {
  rows.push({
    ...area,
    status: area.failed > 0 ? "FAIL" : frontend.hardFailure ? "ERROR" : "PASS",
  });
}
rows.push({ ...e2e.area, status: e2e.status });

const evidence = [
  backend.stats
    ? `mocha      → ${backend.jsonFile}  (${backend.stats.tests} tests across ${backend.fileCount} files, exit ${backend.exitCode})`
    : `mocha      → NO JSON PRODUCED (exit ${backend.exitCode})`,
  frontend.stats
    ? `vitest     → ${frontend.jsonFile}  (${frontend.stats.tests} tests across ${frontend.fileCount} files, exit ${frontend.exitCode})`
    : `vitest     → NO JSON PRODUCED (exit ${frontend.exitCode})`,
  `playwright → ${e2e.note}`,
];

const failures = [...backend.failures, ...frontend.failures];
const overallOk =
  backend.ok && frontend.ok && e2e.ok && integrityErrors.length === 0 && failures.length === 0;

printSummary(rows, evidence, failures, overallOk);

process.exit(overallOk ? 0 : 1);
