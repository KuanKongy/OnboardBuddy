"use strict";

/**
 * Mocha reporter: human-readable `spec` output on stdout **plus** a machine-readable
 * JSON file with one entry per test.
 *
 * Why this exists: the one-command Docker test run has to print a per-area pass count
 * (backend unit / analysis pipeline / generation / security / API), and those counts must
 * come from the runner itself rather than from scraping human text. Mocha only accepts one
 * reporter, so we subclass `spec` and bolt the JSON writer on. `scripts/test-summary.mjs`
 * reads the file and buckets each test by the file it lives in.
 *
 * Usage:
 *   mocha --reporter /abs/path/mocha-spec-json.cjs --reporter-option output=/abs/path/out.json
 *
 * The file is `.cjs` on purpose: mocha loads custom reporters with `require()`.
 */

const fs = require("node:fs");
const path = require("node:path");
const Mocha = require("mocha");

const { Spec, Base } = Mocha.reporters;
const { EVENT_TEST_PASS, EVENT_TEST_FAIL, EVENT_TEST_PENDING, EVENT_RUN_END } =
  Mocha.Runner.constants;

function serialiseError(err) {
  if (!err) return undefined;
  return {
    message: String(err.message || err),
    stack: typeof err.stack === "string" ? err.stack : undefined,
  };
}

function entry(test, state) {
  return {
    state,
    title: test.title,
    fullTitle: typeof test.fullTitle === "function" ? test.fullTitle() : test.title,
    file: test.file || null,
    duration: test.duration || 0,
    err: state === "failed" ? serialiseError(test.err) : undefined,
  };
}

class SpecJsonReporter extends Spec {
  constructor(runner, options = {}) {
    super(runner, options);

    const output =
      (options.reporterOption && options.reporterOption.output) ||
      (options.reporterOptions && options.reporterOptions.output) ||
      process.env.MOCHA_JSON_OUTPUT;

    const tests = [];

    runner.on(EVENT_TEST_PASS, (test) => tests.push(entry(test, "passed")));
    runner.on(EVENT_TEST_FAIL, (test) => tests.push(entry(test, "failed")));
    runner.on(EVENT_TEST_PENDING, (test) => tests.push(entry(test, "pending")));

    runner.once(EVENT_RUN_END, () => {
      const payload = {
        runner: "mocha",
        stats: this.stats,
        tests,
      };
      const json = JSON.stringify(payload, null, 2);
      if (!output) {
        process.stdout.write(json);
        return;
      }
      try {
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, json);
      } catch (err) {
        // Loud, not silent: the summary script treats a missing file as a hard error,
        // but say why here too.
        process.stderr.write(
          `${Base.symbols.err} [mocha-spec-json] could not write "${output}": ${err.message}\n`,
        );
        process.exitCode = 1;
      }
    });
  }
}

module.exports = SpecJsonReporter;
