/**
 * What a tutorial IS, mechanically.
 *
 * The graded complaint was "tutorial is not effective — it has no difference
 * with writing sections", and it was accurate: both called the same generator
 * with a different prompt, so both produced essays. All four MasterPokedex
 * tutorials were "Trace the X page UI flow" — 11-20 cards of "The
 * `fetchPokemonSpecies` function fetches additional data…". No action, no
 * expected result, no way to tell whether you did it. That is `traced_flows`
 * chopped into cards.
 *
 * A section EXPLAINS. A procedure is something you DO. So every step here
 * carries three things, and a step that cannot carry all three is not emitted:
 *
 *   1. `action`   — one concrete thing to do: a command to run, a file and
 *                   line to open, an edit to make.
 *   2. `expected` — what you should see afterwards, in terms of real service
 *                   names, ports, symbols and paths from this repo.
 *   3. `verify`   — how you prove it, ideally a second command whose output
 *                   you can read.
 *
 * The crucial design decision: **the model does not write any of those.**
 * They are computed here from evidence that can support an action — compose
 * services and their published ports, package scripts, CI jobs, `.env`
 * templates, and traced workflow steps with real file+line identity. This is
 * the same split `referenceBackbones.ts` already makes for the CONSULT
 * chapter ("the LLM writes ONLY the intro… the model never touches, and so
 * never corrupts, the facts"). The model's remaining job is one sentence of
 * `why` per step, and it is allowed to return nothing.
 *
 * That split is what makes "no tutorial" a reachable answer. A `surface`-tier
 * flow has no traced effects, so there is nowhere to put an observation point
 * and no effect to confirm — `attemptTraceProcedure` returns a skip with a
 * reason instead of prose. Fewer real procedures beat four essays, and zero is
 * an honest outcome.
 *
 * Pure and side-effect free: evidence in, procedures or typed skips out. All
 * SQL, LLM and persistence lives in `tutorialGenerator.ts`.
 */

import type { ConfigFacts } from './referenceBackbones.js';

// ── the procedure model ─────────────────────────────────────────────────────

export type ProcedureKind = 'run_it' | 'run_tests' | 'trace_flow';

/**
 * What the reader physically does. Ordered roughly as a procedure runs;
 * the UI colours and labels steps by this.
 */
export type ProcedureStepKind =
  | 'setup' | 'run' | 'inspect' | 'edit' | 'trigger' | 'observe' | 'revert';

export interface ProcedureStep {
  order: number;
  kind: ProcedureStepKind;
  /** Imperative, exactly one thing to do. */
  action: string;
  /** The literal command, when the action is one. Rendered copyable. */
  command?: string;
  /** Where the action happens. Never empty — `tutorial_steps.file_path` is NOT NULL. */
  filePath: string;
  symbolName?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  /** What the reader should see. Real ports/services/symbols only. */
  expected: string;
  /** How they prove it worked, including what a failure means. */
  verify: string;
  /** A command whose output answers `verify`. */
  verifyCommand?: string;
  /** The file (and line) in THIS repo that proves the step is real. */
  evidence: string;
  nodeId?: string | null;
  nodeHash?: string | null;
  snippet?: string | null;
  /** Set when the step mirrors a traced workflow step, so the walkthrough can map back. */
  workflowStepOrder?: number;
}

export interface ProcedureGap {
  kind: string;
  detail: string;
}

export interface ProcedureDraft {
  kind: ProcedureKind;
  /** Deterministic fallback title; the model may replace it. */
  title: string;
  steps: ProcedureStep[];
  /** What this procedure could not determine. Shown, never hidden. */
  gaps: ProcedureGap[];
}

export interface ProcedureSkip {
  /** Stable machine code — safe to count in a report and to show as a reason. */
  reason: ProcedureSkipReason;
  detail: string;
}

export type ProcedureSkipReason =
  | 'surface_tier_no_traced_effects'
  | 'no_runnable_command'
  | 'no_test_command'
  | 'no_observable_probe'
  | 'no_way_to_trigger'
  | 'too_few_steps'
  | 'no_compose_topology';

export type ProcedureAttempt =
  | { ok: true; draft: ProcedureDraft }
  | { ok: false; skip: ProcedureSkip };

/** A procedure below this is a note, not a procedure. */
export const MIN_PROCEDURE_STEPS = 3;
/**
 * "Run the suite, read the exit status" is a complete procedure at two steps —
 * its single verification is stronger than anything the other two can offer,
 * because an exit status is not a matter of interpretation.
 */
export const MIN_TEST_PROCEDURE_STEPS = 2;
/** Above this the reader stops following. The old tutorials ran to 20. */
export const MAX_PROCEDURE_STEPS = 8;

// ── the runnable surface of a repo ──────────────────────────────────────────

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface RunCommand {
  command: string;
  /** Repo-relative directory to run it in; '.' is the repo root. */
  cwd: string;
  /** The repo file that proves this command exists. */
  source: string;
  sourceLine?: number;
  /** What the reader should see when it works. */
  expected: string;
  /** How they know it worked. */
  verify: string;
  verifyCommand?: string;
}

export interface PublishedPort {
  port: string;
  service: string;
  source: string;
  line: number;
  /**
   * `http` = worth opening in a browser. `service` = a datastore or broker;
   * telling a newcomer to "open http://localhost:5432" is the kind of
   * confident nonsense this rewrite exists to stop, so those ports are named
   * in the run step's expected output instead of getting a step of their own.
   */
  kind: 'http' | 'service';
  /** The service's build context, used to match a port to the code it serves. */
  buildContext?: string;
}

export interface RunEnvironment {
  /** How to start the app, best evidence first. */
  start: RunCommand[];
  /** How to run the automated tests. */
  test: RunCommand[];
  /** Host ports the running app publishes, from compose. */
  ports: PublishedPort[];
  /** `.env.example` and friends: the file to copy and the names inside it. */
  envTemplates: Array<{ path: string; varNames: string[] }>;
  packageManager: PackageManager;
}

const START_SCRIPTS = ['dev', 'start', 'serve', 'start:dev', 'develop', 'dev:all'];
const TEST_SCRIPTS = ['test', 'test:unit', 'test:all', 'tests'];
const ENV_TEMPLATE_SUFFIX = /\.(?:example|sample|template)$/;

export const dirOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';

const baseOf = (path: string): string => path.split('/').pop() ?? path;

/**
 * The host port a compose `ports:` entry publishes.
 *
 * `"5173:5173"` → 5173 · `"127.0.0.1:5432:5432"` → 5432 (the host side is the
 * second-to-last segment once an interface prefix is present) · `"3000"` →
 * null, because a container-only port is not something the reader can open.
 */
export function hostPort(spec: string): string | null {
  const parts = spec.replace(/\/(tcp|udp)$/i, '').split(':');
  if (parts.length < 2) return null;
  const host = parts[parts.length - 2]!.trim();
  return /^\d[\d-]*$/.test(host) ? host : null;
}

function runScript(pm: PackageManager, name: string): string {
  return pm === 'yarn' ? `yarn ${name}` : `${pm} run ${name}`;
}

function installCommand(pm: PackageManager): string {
  return pm === 'yarn' ? 'yarn install' : `${pm} install`;
}

/**
 * Databases, caches and brokers, by service name or image. Not exhaustive by
 * design — an unrecognised service is treated as HTTP, which produces one
 * `curl` the reader can ignore rather than a missing step.
 */
const DATASTORE = /\b(postgres|postgis|pgbouncer|mysql|mariadb|redis|valkey|mongo|elastic|opensearch|rabbitmq|kafka|zookeeper|memcached|clickhouse|cassandra|minio|localstack|etcd|nats)\b/i;

export function looksLikeDatastore(name: string, image?: string): boolean {
  return DATASTORE.test(name) || (image ? DATASTORE.test(image) : false);
}

/** Lockfile → package manager. Falls back to npm, which is what a bare repo means. */
export function detectPackageManager(filePaths: string[]): PackageManager {
  const names = new Set(filePaths.map(baseOf));
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('bun.lockb') || names.has('bun.lock')) return 'bun';
  if (names.has('yarn.lock')) return 'yarn';
  return 'npm';
}

/**
 * Everything in this repo that can be RUN, with its proof.
 *
 * Compose first: it names services and publishes ports, so its expected
 * results are checkable rather than hopeful. Package scripts come second and
 * carry their raw script text, because "runs `vite --host`" is a fact and
 * "starts the dev server" is a guess.
 */
export function buildRunEnvironment(facts: ConfigFacts, packageManager: PackageManager): RunEnvironment {
  const env: RunEnvironment = { start: [], test: [], ports: [], envTemplates: [], packageManager };

  const topology = facts.topology;
  if (topology && topology.services.length > 0) {
    const names = topology.services.map((s) => s.name);
    env.start.push({
      command: `docker compose -f ${topology.composePath} up --build`,
      cwd: dirOf(topology.composePath),
      source: topology.composePath,
      expected:
        `Docker builds and starts ${names.length} service${names.length === 1 ? '' : 's'} — ` +
        `${names.join(', ')} — and the command stays in the foreground streaming their logs.`,
      verify: `In a second terminal, every service declared in ${topology.composePath} is listed as running. A service missing from that list failed to start; its logs are in the first terminal.`,
      verifyCommand: `docker compose -f ${topology.composePath} ps`,
    });
    for (const service of topology.services) {
      for (const spec of service.ports) {
        const port = hostPort(spec);
        if (!port) continue;
        env.ports.push({
          port,
          service: service.name,
          source: topology.composePath,
          line: service.line,
          kind: looksLikeDatastore(service.name, service.image) ? 'service' : 'http',
          buildContext: service.buildContext,
        });
      }
    }
  }

  const testTopology = facts.testTopology;
  const runner = testTopology?.services[0];
  if (testTopology && runner) {
    env.test.push({
      command: `docker compose -f ${testTopology.composePath} run --rm ${runner.name}`,
      cwd: dirOf(testTopology.composePath),
      source: testTopology.composePath,
      expected:
        `The ${runner.name} container runs the suite to completion and exits` +
        (testTopology.services.length > 1
          ? `, after starting its dependencies (${testTopology.services.slice(1).map((s) => s.name).join(', ')}).`
          : '.'),
      verify: 'A zero exit status means every test passed; anything else means the suite failed and the failing test names are in the output above.',
      verifyCommand: 'echo $?',
    });
  }

  // Shortest manifest path first: the root manifest is the one a newcomer runs.
  const manifests = [...facts.packageScripts].sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path),
  );
  for (const manifest of manifests) {
    const cwd = dirOf(manifest.path);
    const where = cwd === '.' ? '' : ` (from ${cwd}/)`;
    if (env.start.length === 0) {
      const name = START_SCRIPTS.find((s) => manifest.scripts[s]);
      if (name) {
        env.start.push({
          command: runScript(packageManager, name),
          cwd,
          source: manifest.path,
          expected: `The \`${name}\` script runs \`${manifest.scripts[name]}\`${where} and stays in the foreground. Note the URL or port it prints — later steps need it.`,
          verify: 'The process does not exit. If it exits immediately, the message it printed is the reason.',
        });
      }
    }
    if (env.test.length === 0) {
      const name = TEST_SCRIPTS.find((s) => manifest.scripts[s]);
      if (name) {
        env.test.push({
          command: runScript(packageManager, name),
          cwd,
          source: manifest.path,
          expected: `The \`${name}\` script runs \`${manifest.scripts[name]}\`${where} and prints a pass/fail summary.`,
          verify: 'A zero exit status means every test passed; anything else means the suite failed and the failing test names are in the output above.',
          verifyCommand: 'echo $?',
        });
      }
    }
  }

  env.envTemplates = facts.envFiles
    .filter((f) => ENV_TEMPLATE_SUFFIX.test(f.path))
    .map((f) => ({ path: f.path, varNames: f.vars.map((v) => v.name) }));

  return env;
}

// ── shared step builders ────────────────────────────────────────────────────

type UnorderedStep = Omit<ProcedureStep, 'order'>;

function commandStep(kind: ProcedureStepKind, action: string, run: RunCommand): UnorderedStep {
  return {
    kind,
    action: run.cwd === '.' ? action : `${action} (from \`${run.cwd}/\`)`,
    command: run.command,
    filePath: run.source,
    lineStart: run.sourceLine ?? null,
    expected: run.expected,
    verify: run.verify,
    verifyCommand: run.verifyCommand,
    evidence: run.sourceLine ? `${run.source}:${run.sourceLine}` : run.source,
  };
}

function envSetupStep(template: { path: string; varNames: string[] }): UnorderedStep {
  const target = template.path.replace(ENV_TEMPLATE_SUFFIX, '');
  const shown = template.varNames.slice(0, 8);
  const more = template.varNames.length - shown.length;
  return {
    kind: 'setup',
    action: `Create the environment file from the template checked into the repo.`,
    command: `cp ${template.path} ${target}`,
    filePath: template.path,
    expected:
      `\`${target}\` exists and lists ${template.varNames.length} variable name${template.varNames.length === 1 ? '' : 's'}` +
      (shown.length > 0 ? `: ${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}.` : '.') +
      ` The template carries names only — every value is still blank and you must fill them in before the next step.`,
    verify: `The copy exists and its variable names match the template. Any name you leave without a value will surface as a startup error in the next step, not here.`,
    verifyCommand: `grep -c '=' ${target}`,
    evidence: template.path,
  };
}

/** How many `depends_on` hops deep a service sits. Cycle-safe. */
function dependencyDepth(
  name: string,
  services: Array<{ name: string; dependsOn: string[] }>,
  seen = new Set<string>(),
): number {
  if (seen.has(name)) return 0;
  seen.add(name);
  const service = services.find((s) => s.name === name);
  if (!service || service.dependsOn.length === 0) return 0;
  return 1 + Math.max(...service.dependsOn.map((d) => dependencyDepth(d, services, seen)));
}

// ── run_it: get the stack up ────────────────────────────────────────────────

/**
 * "Get it running." Compose-backed only: the whole point of this procedure is
 * that its expected results are checkable — named services, published ports —
 * and a bare `npm run dev` supports neither. A scripts-only repo still gets
 * its run command; it appears as step 1 of a trace procedure instead.
 */
export function attemptRunItProcedure(env: RunEnvironment, facts: ConfigFacts): ProcedureAttempt {
  const topology = facts.topology;
  if (!topology || topology.services.length === 0) {
    return { ok: false, skip: { reason: 'no_compose_topology', detail: 'no compose file with services was found, so there is no stack to bring up as one unit' } };
  }
  const start = env.start.find((c) => c.source === topology.composePath);
  if (!start) {
    return { ok: false, skip: { reason: 'no_runnable_command', detail: 'the compose topology produced no start command' } };
  }

  const gaps: ProcedureGap[] = [];
  const steps: ProcedureStep[] = [];
  const push = (s: UnorderedStep) => steps.push({ ...s, order: steps.length + 1 });

  // Only the templates the compose file actually reads; an unrelated
  // `.env.example` in a sibling package is not part of this procedure.
  const referenced = new Set(topology.services.flatMap((s) => s.envFiles.map(baseOf)));
  const templates = env.envTemplates.filter(
    (t) => referenced.size === 0 || referenced.has(baseOf(t.path.replace(ENV_TEMPLATE_SUFFIX, ''))),
  );
  for (const template of templates.slice(0, 2)) {
    push(envSetupStep(template));
    gaps.push({
      kind: 'env_values_not_in_repo',
      detail: `${template.path} carries variable names only — the values are not in the repository and cannot be derived from it.`,
    });
  }

  push({
    kind: 'run',
    action: 'Start the stack.',
    command: start.command,
    filePath: topology.composePath,
    expected: start.expected,
    verify: start.verify,
    verifyCommand: start.verifyCommand,
    evidence: topology.composePath,
  });

  const seen = new Set<string>();
  for (const p of env.ports.filter((x) => x.kind === 'http')) {
    if (steps.length >= MAX_PROCEDURE_STEPS - 2) break;
    if (seen.has(p.port)) continue;
    seen.add(p.port);
    const service = topology.services.find((s) => s.name === p.service);
    push({
      kind: 'observe',
      action: `Open http://localhost:${p.port} — this is the \`${p.service}\` service.`,
      filePath: p.source,
      lineStart: p.line,
      expected:
        `Something answers on port ${p.port}. ${p.source}:${p.line} publishes it from \`${p.service}\`` +
        (service?.image ? ` (image \`${service.image}\`)` : service?.buildContext ? ` (built from \`${service.buildContext}\`)` : '') +
        '. What it serves depends on the service; that it answers at all is what this step checks.',
      verify: `Any HTTP status back means the container is listening. Connection refused means \`${p.service}\` is not up — check its logs in the terminal from the previous step.`,
      verifyCommand: `curl -sS -o /dev/null -w '%{http_code}\\n' http://localhost:${p.port}`,
      evidence: `${p.source}:${p.line}`,
    });
  }
  const datastorePorts = env.ports.filter((p) => p.kind === 'service');
  if (datastorePorts.length > 0) {
    gaps.push({
      kind: 'datastore_ports_not_opened',
      detail: `${datastorePorts.map((p) => `\`${p.service}\` on ${p.port}`).join(', ')} ${datastorePorts.length === 1 ? 'is a datastore port' : 'are datastore ports'} — reachable, but not something to open in a browser. Use its own client.`,
    });
  }
  if (env.ports.length === 0) {
    gaps.push({
      kind: 'no_published_ports',
      detail: `${topology.composePath} publishes no host ports, so there is no URL to open — the services talk to each other only.`,
    });
  }

  // Always available, and the step that actually diagnoses a failed start:
  // the service furthest down the `depends_on` chain is the one whose
  // dependencies all had to succeed first, so its log is where a broken stack
  // shows itself.
  const last = [...topology.services].sort(
    (a, b) => dependencyDepth(a.name, topology.services) - dependencyDepth(b.name, topology.services),
  ).pop();
  if (last) {
    push({
      kind: 'observe',
      action: `Read the startup log of \`${last.name}\`, the last service to come up.`,
      command: `docker compose -f ${topology.composePath} logs --tail=30 ${last.name}`,
      filePath: topology.composePath,
      lineStart: last.line,
      expected:
        `\`${last.name}\`'s own output` +
        (last.command ? ` from \`${last.command}\`` : '') +
        (last.dependsOn.length > 0 ? `, which only starts once ${last.dependsOn.join(' and ')} ${last.dependsOn.length === 1 ? 'is' : 'are'} up (${topology.composePath}:${last.line})` : '') +
        '. This is where a broken stack tells you what broke.',
      verify: 'The log ends with the service settling rather than a stack trace or a restart loop. A repeating startup banner means the container is crash-looping.',
      evidence: `${topology.composePath}:${last.line}`,
    });
  }

  push({
    kind: 'revert',
    action: 'Stop the stack and remove its containers.',
    command: `docker compose -f ${topology.composePath} down`,
    filePath: topology.composePath,
    expected: 'Every container started above is stopped and removed. Named volumes survive unless you add `-v`.',
    verify: 'The running-container list for this project comes back empty.',
    verifyCommand: `docker compose -f ${topology.composePath} ps`,
    evidence: topology.composePath,
  });

  if (steps.length < MIN_PROCEDURE_STEPS) {
    return { ok: false, skip: { reason: 'too_few_steps', detail: `only ${steps.length} verifiable step(s) could be built` } };
  }
  return {
    ok: true,
    draft: { kind: 'run_it', title: 'Bring the stack up and confirm it answers', steps: steps.slice(0, MAX_PROCEDURE_STEPS), gaps },
  };
}

// ── run_tests: prove the suite runs ─────────────────────────────────────────

export interface TestGuard {
  /** The test file. */
  testFile: string;
  /** What it covers, as a readable name. */
  covers: string;
}

/**
 * "Run the tests, and know which test covers what." The verification is the
 * strongest of the three procedures — an exit status is not a matter of
 * opinion — which is why it is worth a slot whenever a test command exists.
 */
export function attemptRunTestsProcedure(
  env: RunEnvironment,
  facts: ConfigFacts,
  guards: TestGuard[],
): ProcedureAttempt {
  const test = env.test[0];
  if (!test) {
    return { ok: false, skip: { reason: 'no_test_command', detail: 'no test compose service and no test script in any package.json' } };
  }

  const gaps: ProcedureGap[] = [];
  const steps: ProcedureStep[] = [];
  const push = (s: UnorderedStep) => steps.push({ ...s, order: steps.length + 1 });

  push({
    kind: 'run',
    action: 'Run the whole test suite.',
    command: test.command,
    filePath: test.source,
    expected: test.expected,
    verify: test.verify,
    verifyCommand: test.verifyCommand,
    evidence: test.source,
  });

  for (const guard of guards.slice(0, 3)) {
    if (steps.length >= MAX_PROCEDURE_STEPS - 1) break;
    push({
      kind: 'inspect',
      action: `Open \`${guard.testFile}\`.`,
      filePath: guard.testFile,
      expected: `This is the file the dependency graph records as testing \`${guard.covers}\` — so a change to \`${guard.covers}\` is the change this file is meant to catch.`,
      verify: `\`${guard.covers}\` is named in the file. If it is not, the link came from an import rather than a direct assertion, and the coverage is weaker than it looks.`,
      verifyCommand: `grep -n '${guard.covers.replace(/'/g, "'\\''")}' ${guard.testFile}`,
      evidence: guard.testFile,
    });
  }
  if (guards.length === 0) {
    gaps.push({
      kind: 'no_test_edges',
      detail: 'no test file could be linked to the code it covers, so which behaviour this suite actually protects is unknown.',
    });
  }

  const pipeline = facts.ci[0];
  if (pipeline && pipeline.jobs.length > 0 && steps.length < MAX_PROCEDURE_STEPS) {
    push({
      kind: 'inspect',
      action: `Open \`${pipeline.path}\` and compare it with what you just ran.`,
      filePath: pipeline.path,
      expected: `${pipeline.jobs.length} job${pipeline.jobs.length === 1 ? '' : 's'} — ${pipeline.jobs.map((j) => j.name).join(', ')} — triggered by ${pipeline.triggers.length > 0 ? pipeline.triggers.join(', ') : 'push'}. These are the checks a pull request has to pass.`,
      verify: `You get the commands CI executes, with their line numbers. Anything there that step 1 did not run is a check that can only fail after you push.`,
      verifyCommand: `grep -n 'run:' ${pipeline.path}`,
      evidence: pipeline.path,
    });
  }

  if (steps.length < MIN_TEST_PROCEDURE_STEPS) {
    return { ok: false, skip: { reason: 'too_few_steps', detail: `only ${steps.length} verifiable step(s) could be built around \`${test.command}\`` } };
  }
  return {
    ok: true,
    draft: {
      kind: 'run_tests',
      title: guards.length > 0 ? 'Run the suite and find the test that guards a change' : 'Run the suite and read its exit status',
      steps,
      gaps,
    },
  };
}

// ── trace_flow: watch one real flow execute ─────────────────────────────────

export interface TraceStep {
  order: number;
  filePath: string;
  symbolName: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  stepKind: string | null;
  description: string;
  nodeId: string | null;
  nodeHash: string | null;
  snippet: string | null;
}

export interface TraceInput {
  title: string;
  purpose: string;
  tier: 'core' | 'supporting' | 'surface';
  triggerType: string;
  routePath: string | null;
  httpMethod: string | null;
  steps: TraceStep[];
  /** Test files linked to this flow's entry symbol, if any. */
  coveringTests: string[];
}

/** Step kinds that mean the flow changed something you can watch for. */
const EFFECT_KINDS = new Set(['data_write', 'async_work', 'side_effect', 'data_read']);
/** Files where a one-line marker is a safe, revertible edit we can spell out. */
const JS_LIKE = /\.(?:m|c)?[jt]sx?$/;

const identifier = (step: TraceStep): string => step.symbolName ?? baseOf(step.filePath);

/**
 * "Watch this flow actually run." The replacement for the four
 * "Trace the X page UI flow" essays.
 *
 * The reader starts the app, plants one revertible marker at the line the
 * trace claims does the work, triggers the flow for real, and reads back
 * whether the marker printed. That last part is the whole difference: the old
 * tutorial asserted that `fetchPokemonSpecies` fetches data; this one has the
 * reader make the code say so.
 *
 * Three hard requirements, each of which turns into a typed skip:
 *   • traced effects — a `surface` flow has none, so there is no line worth
 *     marking and nothing to confirm afterwards;
 *   • a marker site the procedure can spell out exactly (JS/TS with a line);
 *   • a way to set the flow off — a route to curl, a page to open, or a test
 *     that exercises it.
 */
export function attemptTraceProcedure(input: TraceInput, env: RunEnvironment): ProcedureAttempt {
  if (input.tier === 'surface') {
    return {
      ok: false,
      skip: {
        reason: 'surface_tier_no_traced_effects',
        detail: `"${input.title}" is a real entry point but no side effect was traced from it — there is no line to mark and no result to confirm.`,
      },
    };
  }

  const start = env.start[0];
  const test = env.test[0];
  if (!start && !test) {
    return {
      ok: false,
      skip: {
        reason: 'no_runnable_command',
        detail: 'nothing in this repository says how to run it — no compose file and no start or test script — so no step can be executed.',
      },
    };
  }

  const ordered = [...input.steps].sort((a, b) => a.order - b.order);
  const entry = ordered[0];
  const effects = ordered.filter((s) => s.stepKind != null && EFFECT_KINDS.has(s.stepKind));
  if (!entry || effects.length === 0) {
    return { ok: false, skip: { reason: 'surface_tier_no_traced_effects', detail: `"${input.title}" has no traced step that reads, writes, enqueues or calls out.` } };
  }

  // Mark the deepest effect we can name a line for: the further in it sits,
  // the more of the flow its printing actually proves.
  const probe = [...effects].reverse().find((s) => s.lineStart != null && JS_LIKE.test(s.filePath))
    ?? (entry.lineStart != null && JS_LIKE.test(entry.filePath) ? entry : undefined);
  if (!probe) {
    return {
      ok: false,
      skip: {
        reason: 'no_observable_probe',
        detail: `no step of "${input.title}" lands on a JavaScript or TypeScript line, so this procedure cannot tell the reader exactly what to add or where.`,
      },
    };
  }

  const gaps: ProcedureGap[] = [];
  // The port that serves THIS flow, not just the first one published. A repo
  // with `db`, `api` and `web` publishes three; curling the Postgres port
  // because it is listed first is the sort of confident-and-wrong instruction
  // that made the old tutorials untrustworthy. Prefer the service whose build
  // context contains the traced file; fall back to any HTTP port.
  const httpPorts = env.ports.filter((p) => p.kind === 'http');
  const port =
    (httpPorts.find((p) => p.buildContext && entry.filePath.startsWith(p.buildContext.replace(/\/$/, '') + '/'))
      ?? httpPorts[0])?.port ?? null;
  const isHttp = Boolean(input.routePath) && /^HTTP/i.test(input.triggerType);
  const isUi = input.triggerType === 'UI page' && Boolean(input.routePath);

  let trigger: { action: string; command?: string; expected: string; verify: string } | null = null;
  if (isHttp || isUi) {
    const host = port ? `http://localhost:${port}` : 'http://localhost:PORT';
    if (!port) {
      gaps.push({
        kind: 'port_unknown',
        detail: 'no compose file publishes a host port, so the port is whatever the start command printed — substitute it below.',
      });
    }
    if (input.routePath && /[:{*]/.test(input.routePath)) {
      gaps.push({
        kind: 'route_params_unfilled',
        detail: `\`${input.routePath}\` contains path parameters; substitute real values from your running instance before sending the request.`,
      });
    }
    if (isHttp) {
      const method = (input.httpMethod ?? 'GET').toUpperCase();
      trigger = {
        action: `Set the flow off: send ${method} ${input.routePath} to the app you started.`,
        command: `curl -i -X ${method} ${host}${input.routePath}`,
        expected: `curl prints a status line, and the \`[trace]\` marker from the previous step appears in the output of the process from step 1.`,
        verify: `The marker printed. If it did not, the request never reached \`${identifier(probe)}\` — check the port and that the path matches ${input.routePath}.`,
      };
    } else {
      trigger = {
        action: `Set the flow off: open ${host}${input.routePath} in a browser.`,
        expected: `The page renders, and the \`[trace]\` marker from the previous step appears — in the browser console for client code, in the terminal from step 1 for server code.`,
        verify: `The marker printed. If it did not, this page does not reach \`${identifier(probe)}\` on load; it may need an interaction first.`,
      };
    }
  } else if (input.coveringTests.length > 0 && test) {
    trigger = {
      action: `Set the flow off by running the test that covers it.`,
      command: test.command,
      expected: `The suite runs and the \`[trace]\` marker from the previous step appears in its output, printed from \`${input.coveringTests[0]}\`.`,
      verify: `The marker printed. If it did not, \`${input.coveringTests[0]}\` does not reach this line and the coverage is narrower than the graph suggests.`,
    };
  }

  if (!trigger) {
    return {
      ok: false,
      skip: {
        reason: 'no_way_to_trigger',
        detail: `"${input.title}" is triggered by ${input.triggerType}, and no route, page or covering test was found that a reader could use to set it off by hand.`,
      },
    };
  }

  const steps: ProcedureStep[] = [];
  const push = (s: UnorderedStep) => steps.push({ ...s, order: steps.length + 1 });
  const run = start ?? test!;

  // A script-backed run command fails on a fresh clone until dependencies are
  // installed, and "npm run dev" is the run command for every repo with no
  // compose file — which is most of them. Compose builds its own images, so
  // this step only exists where it is actually needed.
  if (/(^|\/)package\.json$/.test(run.source)) {
    push({
      kind: 'setup',
      action: 'Install dependencies.',
      command: run.cwd === '.' ? installCommand(env.packageManager) : `(cd ${run.cwd} && ${installCommand(env.packageManager)})`,
      filePath: run.source,
      expected: `A \`node_modules\` directory beside ${run.source}, matching the lockfile committed to the repo.`,
      verify: 'The install ends without an error. A peer-dependency or engine warning is not a failure; a non-zero exit is.',
      verifyCommand: 'echo $?',
      evidence: run.source,
    });
  }

  push(commandStep('run', start ? 'Start the app.' : 'Get the suite running first.', run));

  push({
    kind: 'inspect',
    action: `Open \`${entry.filePath}\`${entry.lineStart ? ` at line ${entry.lineStart}` : ''}${entry.symbolName ? ` (\`${entry.symbolName}\`)` : ''}.`,
    filePath: entry.filePath,
    symbolName: entry.symbolName,
    lineStart: entry.lineStart,
    lineEnd: entry.lineEnd,
    expected: `This is where the flow starts. The trace records it as: ${entry.description}`,
    verify: entry.lineStart
      ? `The lines you print are the body of \`${identifier(entry)}\`. If they are not, the file has moved on since this snapshot was analysed.`
      : `\`${identifier(entry)}\` is defined in this file.`,
    verifyCommand: entry.lineStart
      ? `sed -n '${entry.lineStart},${entry.lineEnd ?? entry.lineStart + 15}p' ${entry.filePath}`
      : undefined,
    evidence: entry.lineStart ? `${entry.filePath}:${entry.lineStart}` : entry.filePath,
    nodeId: entry.nodeId,
    nodeHash: entry.nodeHash,
    snippet: entry.snippet,
    workflowStepOrder: entry.order,
  });

  const marker = `console.log('[trace] ${identifier(probe)} reached');`;
  push({
    kind: 'edit',
    action: `Add one line at the top of \`${identifier(probe)}\` in \`${probe.filePath}\` (line ${probe.lineStart}): ${marker}`,
    filePath: probe.filePath,
    symbolName: probe.symbolName,
    lineStart: probe.lineStart,
    lineEnd: probe.lineEnd,
    expected: `Nothing changes yet — the marker only prints when the flow runs. This is the line the trace claims does the work: ${probe.description}`,
    verify: 'Exactly one file, one insertion. If the diff is larger, you edited more than the marker.',
    verifyCommand: `git diff --stat -- ${probe.filePath}`,
    evidence: `${probe.filePath}:${probe.lineStart}`,
    nodeId: probe.nodeId,
    nodeHash: probe.nodeHash,
    snippet: probe.snippet,
    workflowStepOrder: probe.order,
  });

  push({
    kind: 'trigger',
    action: trigger.action,
    command: trigger.command,
    filePath: entry.filePath,
    lineStart: entry.lineStart,
    expected: trigger.expected,
    verify: trigger.verify,
    evidence: entry.lineStart ? `${entry.filePath}:${entry.lineStart}` : entry.filePath,
  });

  // The terminal step, when it is not the line we already marked — otherwise
  // this would restate the previous step, which is exactly the essay habit.
  // It must also sit AFTER the marker: the verification below says the marker
  // printed before this point, and that is only true downstream of it.
  const terminal = [...ordered].reverse().find(
    (s) => s.order !== probe.order && s.order !== entry.order && s.order > probe.order,
  );
  if (terminal && steps.length < MAX_PROCEDURE_STEPS - 1) {
    push({
      kind: 'observe',
      action: `Confirm where the flow ended: open \`${terminal.filePath}\`${terminal.lineStart ? ` at line ${terminal.lineStart}` : ''}.`,
      filePath: terminal.filePath,
      symbolName: terminal.symbolName,
      lineStart: terminal.lineStart,
      lineEnd: terminal.lineEnd,
      expected: `The last traced step of this flow: ${terminal.description}`,
      verify: `The marker printed before this point, so execution did reach here. Anything this step is described as changing should now be visible in whatever it writes to.`,
      verifyCommand: terminal.lineStart
        ? `sed -n '${terminal.lineStart},${terminal.lineEnd ?? terminal.lineStart + 15}p' ${terminal.filePath}`
        : undefined,
      evidence: terminal.lineStart ? `${terminal.filePath}:${terminal.lineStart}` : terminal.filePath,
      nodeId: terminal.nodeId,
      nodeHash: terminal.nodeHash,
      snippet: terminal.snippet,
      workflowStepOrder: terminal.order,
    });
  }

  push({
    kind: 'revert',
    action: 'Remove the marker and leave the tree clean.',
    command: `git checkout -- ${probe.filePath}`,
    filePath: probe.filePath,
    expected: `\`${probe.filePath}\` is back to its committed contents.`,
    verify: 'No output means nothing of yours is left behind.',
    verifyCommand: `git status --short -- ${probe.filePath}`,
    evidence: probe.filePath,
  });

  if (ordered.length > steps.length) {
    gaps.push({
      kind: 'steps_not_walked',
      detail: `The trace has ${ordered.length} steps; this procedure stops at the ${effects.length} that change something. The full trace is on the Workflows tab.`,
    });
  }

  const renumbered = steps.slice(0, MAX_PROCEDURE_STEPS).map((s, i) => ({ ...s, order: i + 1 }));
  if (renumbered.length < MIN_PROCEDURE_STEPS) {
    return { ok: false, skip: { reason: 'too_few_steps', detail: `only ${renumbered.length} verifiable step(s) could be built for "${input.title}"` } };
  }
  return { ok: true, draft: { kind: 'trace_flow', title: `Watch ${input.title} run end to end`, steps: renumbered, gaps } };
}

// ── the procedural contract, checked ────────────────────────────────────────

/**
 * The procedural sibling of `explanationLint`. That validator asks whether
 * prose explains; this one asks whether a step is a step at all.
 *
 * Deliberately structural: an action that is not imperative, an expected
 * result with no repo-specific noun in it, or a verification that is just the
 * action restated are the three ways a "procedure" slides back into being an
 * essay, and none of them are visible to a prose linter.
 */
export interface ProcedureFinding {
  stepOrder: number;
  code: 'no_action' | 'not_imperative' | 'no_expected' | 'no_verify' | 'verify_restates_action' | 'no_evidence';
  detail: string;
}

const IMPERATIVE =
  /^(?:open|run|add|create|edit|copy|start|stop|install|verify|check|execute|update|replace|delete|set|export|cd|npm|pnpm|yarn|bun|docker|git|curl|locate|modify|navigate|remove|confirm|trigger|send|watch|read|bring|get|make|point|undo|restore|find|compare)\b/i;

const MIN_EXPECTED_CHARS = 24;
const MIN_VERIFY_CHARS = 16;

export function lintProcedure(draft: ProcedureDraft): ProcedureFinding[] {
  const findings: ProcedureFinding[] = [];
  for (const step of draft.steps) {
    const action = step.action.trim();
    if (!action) {
      findings.push({ stepOrder: step.order, code: 'no_action', detail: 'the step has no action' });
    } else if (!IMPERATIVE.test(action)) {
      findings.push({
        stepOrder: step.order,
        code: 'not_imperative',
        detail: `"${action.slice(0, 80)}" describes rather than instructs — a step starts with the verb the reader performs`,
      });
    }
    if (step.expected.trim().length < MIN_EXPECTED_CHARS) {
      findings.push({ stepOrder: step.order, code: 'no_expected', detail: 'no observable result the reader can compare against' });
    }
    if (step.verify.trim().length < MIN_VERIFY_CHARS) {
      findings.push({ stepOrder: step.order, code: 'no_verify', detail: 'no way to tell whether the step worked' });
    } else if (step.verifyCommand && step.command && step.verifyCommand.trim() === step.command.trim()) {
      findings.push({
        stepOrder: step.order,
        code: 'verify_restates_action',
        detail: 'the verification re-runs the action instead of checking its result',
      });
    }
    if (!step.evidence.trim() || !step.filePath.trim()) {
      findings.push({ stepOrder: step.order, code: 'no_evidence', detail: 'the step points at no file in this repository' });
    }
  }
  return findings;
}
