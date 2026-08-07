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
        `Docker builds and starts ${names.length} service${names.length === 1 ? '' : 's'} ` +
        `(${names.join(', ')}), and the command stays in the foreground streaming their logs.`,
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
          expected: `The \`${name}\` script runs \`${manifest.scripts[name]}\`${where} and stays in the foreground. Note the URL or port it prints: later steps need it.`,
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
      ` The template carries names only. Every value is still blank and you must fill them in before the next step.`,
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
      detail: `${template.path} carries variable names only. The values are not in the repository and cannot be derived from it.`,
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
      action: `Open http://localhost:${p.port}. This is the \`${p.service}\` service.`,
      filePath: p.source,
      lineStart: p.line,
      expected:
        `Something answers on port ${p.port}. ${p.source}:${p.line} publishes it from \`${p.service}\`` +
        (service?.image ? ` (image \`${service.image}\`)` : service?.buildContext ? ` (built from \`${service.buildContext}\`)` : '') +
        '. What it serves depends on the service; that it answers at all is what this step checks.',
      verify: `Any HTTP status back means the container is listening. Connection refused means \`${p.service}\` is not up: check its logs in the terminal from the previous step.`,
      verifyCommand: `curl -sS -o /dev/null -w '%{http_code}\\n' http://localhost:${p.port}`,
      evidence: `${p.source}:${p.line}`,
    });
  }
  const datastorePorts = env.ports.filter((p) => p.kind === 'service');
  if (datastorePorts.length > 0) {
    gaps.push({
      kind: 'datastore_ports_not_opened',
      detail: `${datastorePorts.map((p) => `\`${p.service}\` on ${p.port}`).join(', ')} ${datastorePorts.length === 1 ? 'is a datastore port' : 'are datastore ports'}, reachable but not something to open in a browser. Use its own client.`,
    });
  }
  if (env.ports.length === 0) {
    gaps.push({
      kind: 'no_published_ports',
      detail: `${topology.composePath} publishes no host ports, so there is no URL to open. The services talk to each other only.`,
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
      expected: `This is the file the dependency graph records as testing \`${guard.covers}\`, so a change to \`${guard.covers}\` is the change this file is meant to catch.`,
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
      expected: `${pipeline.jobs.length} job${pipeline.jobs.length === 1 ? '' : 's'} (${pipeline.jobs.map((j) => j.name).join(', ')}) triggered by ${pipeline.triggers.length > 0 ? pipeline.triggers.join(', ') : 'push'}. These are the checks a pull request has to pass.`,
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

/**
 * A detected side effect attached to the step that performs it.
 *
 * `evidence` is the matched call expression text — the only thing that makes
 * deterministic highlighting possible, because `DetectedSideEffect` carries no
 * line number and graph edges carry no call-site lines. Highlights are
 * therefore LOCATED by scanning the verified snippet for this string, never
 * looked up (see `deriveHighlights`).
 */
export interface StepEffect {
  /** `side_effects.type` — a structural kind, never a domain word. */
  kind: string;
  target: string | null;
  evidence: string;
}

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
  /** Side effects recorded against this step's node, for highlight location. */
  effects?: StepEffect[];
  /** `workflow_steps.metadata` — see the WorkflowStep JSDoc in workflowExtractor. */
  metadata?: {
    syntheticReturn?: boolean;
    syntheticSeedEffect?: boolean;
    journeyMember?: string;
    journeyBoundary?: string;
  } | null;
}

export interface TraceInput {
  title: string;
  purpose: string;
  tier: 'core' | 'supporting' | 'surface';
  /** The flow's own trigger type; `journey` for a composed journey. */
  triggerType: string;
  /**
   * How a composed journey's FIRST member is triggered ("HTTP POST", "UI
   * page"). A journey's own trigger type is the word `journey`, which is not
   * something a reader can send — but its first member is a real route or
   * page, and that is what sets the whole chain off. Absent for ordinary
   * flows, where `triggerType` already describes the entry point.
   */
  entryTriggerType?: string | null;
  routePath: string | null;
  httpMethod: string | null;
  steps: TraceStep[];
  /** Test files linked to this flow's entry symbol, if any. */
  coveringTests: string[];
}

/** Step kinds that mean the flow changed something you can watch for. */
// `auth_guard` is here for the same reason it counts as a state change in the
// extractor: a login's observable effect IS the session it creates. Without
// it, every auth flow reached this function and was turned away with "no
// traced step that reads, writes, enqueues or calls out" — a false statement
// about a handler that calls an identity SDK, and the reason the shipped
// tutorial set had no login in it.
const EFFECT_KINDS = new Set(['data_write', 'async_work', 'side_effect', 'data_read', 'auth_guard']);
/** Files where a one-line marker is a safe, revertible edit we can spell out. */
const JS_LIKE = /\.(?:m|c)?[jt]sx?$/;

const identifier = (step: TraceStep): string => step.symbolName ?? baseOf(step.filePath);

// ── composed journeys ───────────────────────────────────────────────────────

/**
 * How far execution actually travels from ONE trigger.
 *
 * A queue hand-off is crossed by the job itself, so a marker on the consumer
 * side still prints after a single request. A `group` boundary means "another
 * entry point on the same surface" and a `redirect` hands control to a third
 * party — neither is reached by the request the reader sends, so a marker over
 * there would never print and the verification telling them to expect it would
 * be a lie.
 */
const CONTINUES_FROM_ONE_TRIGGER = new Set(['queue']);

interface JourneyWalk {
  /** The crossings between members, in order. One procedure step each. */
  boundaries: TraceStep[];
  /** The prefix of the chain that a single trigger really executes. */
  reachable: TraceStep[];
  /** Members past the first non-continuing boundary: reachable, but not from here. */
  separateEntryPoints: number;
  /** True when the reader's request hands off to a queue before the marker. */
  crossesQueue: boolean;
}

/**
 * Composed journeys (`journeyComposer.ts`) are persisted as workflows, but
 * they are stitched from several members and run to 14 steps against an
 * 8-step procedure budget. Walking all of them would blow the budget and cut
 * the revert step off the end, leaving the reader's marker in the tree.
 *
 * What a reader needs from a journey is its SPINE: where the request enters,
 * every place it crosses from one member to the next, and where it finally
 * lands — "request enters → crosses to the queue → worker consumes → sections
 * written". The composer already marks exactly those steps
 * (`metadata.journeyBoundary` on a crossing, `metadata.journeyMember` on a
 * member's own steps), so this reads its annotations rather than guessing at
 * the shape a second time.
 */
function journeyWalkOf(ordered: TraceStep[]): JourneyWalk | null {
  if (!ordered.some((s) => s.metadata?.journeyMember || s.metadata?.journeyBoundary)) return null;
  const boundaries = ordered.filter((s) => typeof s.metadata?.journeyBoundary === 'string');
  const stopAt = ordered.findIndex((s) =>
    typeof s.metadata?.journeyBoundary === 'string'
    && !CONTINUES_FROM_ONE_TRIGGER.has(s.metadata.journeyBoundary));
  const reachable = stopAt === -1 ? ordered : ordered.slice(0, stopAt);
  return {
    boundaries,
    reachable,
    separateEntryPoints: stopAt === -1
      ? 0
      : boundaries.filter((b) => b.order >= ordered[stopAt]!.order).length,
    crossesQueue: reachable.some((s) => s.metadata?.journeyBoundary === 'queue'),
  };
}

/** A trigger the reader can send by hand, with the marker's expected output. */
interface ManualTrigger {
  action: string;
  command?: string;
  expected: string;
  verify: string;
}

/**
 * The deepest effect we can name a line for: the further in it sits, the more
 * of the flow a marker printing there actually proves. Shared by the how-to
 * trace procedure and the walkthrough's optional "prove it live" appendix, so
 * the two can never disagree about which line is the observable one.
 */
function selectProbe(effects: TraceStep[], entry: TraceStep): TraceStep | undefined {
  return [...effects].reverse().find((s) => s.lineStart != null && JS_LIKE.test(s.filePath))
    ?? (entry.lineStart != null && JS_LIKE.test(entry.filePath) ? entry : undefined);
}

/**
 * How a reader sets this flow off by hand — a route to curl, a page to open,
 * or a covering test to run — plus whatever the evidence could not pin down.
 */
/**
 * The port that serves THIS flow, not just the first one published.
 *
 * A repo with `db`, `api` and `web` publishes three; curling the Postgres port
 * because it is listed first is the sort of confident-and-wrong instruction
 * that made the old tutorials untrustworthy. Prefer the service whose build
 * context contains the traced file; fall back to any HTTP port. Shared by the
 * how-to trigger and the walkthrough's entry statement so the two can never
 * print different hosts for the same flow.
 */
function servingPort(env: RunEnvironment, filePath: string): string | null {
  const httpPorts = env.ports.filter((p) => p.kind === 'http');
  return (
    httpPorts.find((p) => p.buildContext && filePath.startsWith(p.buildContext.replace(/\/$/, '') + '/'))
    ?? httpPorts[0]
  )?.port ?? null;
}

function buildTrigger(
  input: TraceInput,
  env: RunEnvironment,
  entry: TraceStep,
  probe: TraceStep,
): { trigger: ManualTrigger | null; gaps: ProcedureGap[] } {
  const gaps: ProcedureGap[] = [];
  const port = servingPort(env, entry.filePath);
  // A journey is set off by its first member, not by the word "journey".
  const triggerType = input.entryTriggerType ?? input.triggerType;
  const isHttp = Boolean(input.routePath) && /^HTTP/i.test(triggerType);
  const isUi = triggerType === 'UI page' && Boolean(input.routePath);
  const test = env.test[0];

  if (isHttp || isUi) {
    const host = port ? `http://localhost:${port}` : 'http://localhost:PORT';
    if (!port) {
      gaps.push({
        kind: 'port_unknown',
        detail: 'no compose file publishes a host port, so the port is whatever the start command printed. Substitute it below.',
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
      return {
        gaps,
        trigger: {
          action: `Set the flow off: send ${method} ${input.routePath} to the app you started.`,
          command: `curl -i -X ${method} ${host}${input.routePath}`,
          expected: `curl prints a status line, and the \`[trace]\` marker from the previous step appears in the output of the process from step 1.`,
          verify: `The marker printed. If it did not, the request never reached \`${identifier(probe)}\`: check the port and that the path matches ${input.routePath}.`,
        },
      };
    }
    return {
      gaps,
      trigger: {
        action: `Set the flow off: open ${host}${input.routePath} in a browser.`,
        expected: `The page renders, and the \`[trace]\` marker from the previous step appears: in the browser console for client code, in the terminal from step 1 for server code.`,
        verify: `The marker printed. If it did not, this page does not reach \`${identifier(probe)}\` on load; it may need an interaction first.`,
      },
    };
  }
  if (input.coveringTests.length > 0 && test) {
    return {
      gaps,
      trigger: {
        action: `Set the flow off by running the test that covers it.`,
        command: test.command,
        expected: `The suite runs and the \`[trace]\` marker from the previous step appears in its output, printed from \`${input.coveringTests[0]}\`.`,
        verify: `The marker printed. If it did not, \`${input.coveringTests[0]}\` does not reach this line and the coverage is narrower than the graph suggests.`,
      },
    };
  }
  return { trigger: null, gaps };
}

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
        detail: `"${input.title}" is a real entry point but no side effect was traced from it. There is no line to mark and no result to confirm.`,
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
        detail: 'nothing in this repository says how to run it (no compose file and no start or test script), so no step can be executed.',
      },
    };
  }

  const ordered = [...input.steps].sort((a, b) => a.order - b.order);
  const entry = ordered[0];
  // A journey's marker may only be planted in the part of the chain one
  // request reaches; see `journeyWalkOf`.
  const journey = journeyWalkOf(ordered);
  const effects = (journey?.reachable ?? ordered).filter((s) => s.stepKind != null && EFFECT_KINDS.has(s.stepKind));
  if (!entry || effects.length === 0) {
    return { ok: false, skip: { reason: 'surface_tier_no_traced_effects', detail: `"${input.title}" has no traced step that reads, writes, enqueues or calls out.` } };
  }

  const probe = selectProbe(effects, entry);
  if (!probe) {
    return {
      ok: false,
      skip: {
        reason: 'no_observable_probe',
        detail: `no step of "${input.title}" lands on a JavaScript or TypeScript line, so this procedure cannot tell the reader exactly what to add or where.`,
      },
    };
  }

  const built = buildTrigger(input, env, entry, probe);
  const gaps: ProcedureGap[] = [...built.gaps];
  let trigger = built.trigger;
  const triggerType = input.entryTriggerType ?? input.triggerType;

  if (!trigger) {
    return {
      ok: false,
      skip: {
        reason: 'no_way_to_trigger',
        detail: `"${input.title}" is triggered by ${triggerType}, and no route, page or covering test was found that a reader could use to set it off by hand.`,
      },
    };
  }
  // An async hand-off is not a delay in the request — say so, or the reader
  // reads a silent curl as a failure and starts debugging the wrong half.
  if (journey?.crossesQueue) {
    trigger = {
      ...trigger,
      expected: `${trigger.expected} The hand-off is asynchronous: the marker prints when the job is consumed, after the request has already returned.`,
    };
  }

  const steps: ProcedureStep[] = [];
  const push = (s: UnorderedStep) => steps.push({ ...s, order: steps.length + 1 });
  const run = start ?? test!;
  const needsInstall = /(^|\/)package\.json$/.test(run.source);

  // A script-backed run command fails on a fresh clone until dependencies are
  // installed, and "npm run dev" is the run command for every repo with no
  // compose file — which is most of them. Compose builds its own images, so
  // this step only exists where it is actually needed.
  if (needsInstall) {
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

  // The hops, between "where it starts" and "where it lands". Budgeted
  // explicitly rather than trimmed at the end: the tail of this procedure is
  // the revert step, and a slice() that drops it leaves the reader's marker
  // committed to their working tree.
  //
  // Fixed cost below: run, inspect-entry, edit-marker, trigger, revert
  // (+ install where the run command needs one).
  const hopBudget = Math.max(0, MAX_PROCEDURE_STEPS - (needsInstall ? 6 : 5));
  // When the budget cannot hold every hop, keep the FIRST ones and the LAST
  // one rather than a prefix: the final boundary is where the journey lands
  // ("connection complete — POST /api/projects registers the repository"),
  // and a walk that stops one hop short of the destination teaches the
  // hand-offs without ever showing what they were for.
  const hops = !journey ? []
    : journey.boundaries.length <= hopBudget ? journey.boundaries
    : [...journey.boundaries.slice(0, Math.max(0, hopBudget - 1)), journey.boundaries[journey.boundaries.length - 1]!];
  for (const hop of hops) {
    const continues = CONTINUES_FROM_ONE_TRIGGER.has(hop.metadata?.journeyBoundary ?? '');
    push({
      kind: 'inspect',
      action: `Open \`${hop.filePath}\`${hop.lineStart ? ` at line ${hop.lineStart}` : ''}${hop.symbolName ? ` (\`${hop.symbolName}\`)` : ''}. This is the next leg of this journey.`,
      filePath: hop.filePath,
      symbolName: hop.symbolName,
      lineStart: hop.lineStart,
      lineEnd: hop.lineEnd,
      expected: `Where this flow crosses from one part of the system into the next. The trace records the hop as: ${hop.description}`,
      verify: continues
        ? `The lines you print are the far side of the hand-off. Nothing calls them directly. The job does, which is why the next steps watch for a marker instead of a return value.`
        : `The lines you print are a separate entry point on the same surface. The request in the trigger step below does not reach them; set this one off on its own to watch it run.`,
      verifyCommand: hop.lineStart
        ? `sed -n '${hop.lineStart},${hop.lineEnd ?? hop.lineStart + 15}p' ${hop.filePath}`
        : undefined,
      evidence: hop.lineStart ? `${hop.filePath}:${hop.lineStart}` : hop.filePath,
      nodeId: hop.nodeId,
      nodeHash: hop.nodeHash,
      snippet: hop.snippet,
      workflowStepOrder: hop.order,
    });
  }
  if (journey && hops.length < journey.boundaries.length) {
    gaps.push({
      kind: 'journey_hops_not_walked',
      detail: `This journey crosses ${journey.boundaries.length} boundaries and the procedure has room for ${hops.length}: the first and the last. The middle hops are on the Workflows tab.`,
    });
  }
  if (journey && journey.separateEntryPoints > 0) {
    gaps.push({
      kind: 'journey_members_triggered_separately',
      detail: `${journey.separateEntryPoints} later leg${journey.separateEntryPoints === 1 ? ' is a' : 's are'} separate entry point${journey.separateEntryPoints === 1 ? '' : 's'} on the same surface. One request does not reach ${journey.separateEntryPoints === 1 ? 'it' : 'them'}, so the marker is planted in the leg this trigger really runs.`,
    });
  }

  const marker = `console.log('[trace] ${identifier(probe)} reached');`;
  push({
    kind: 'edit',
    action: `Add one line at the top of \`${identifier(probe)}\` in \`${probe.filePath}\` (line ${probe.lineStart}): ${marker}`,
    filePath: probe.filePath,
    symbolName: probe.symbolName,
    lineStart: probe.lineStart,
    lineEnd: probe.lineEnd,
    expected: `Nothing changes yet. The marker only prints when the flow runs. This is the line the trace claims does the work: ${probe.description}`,
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
  // Not for journeys: their last step usually sits past a boundary this
  // trigger never crosses, so "the marker printed before this point" would be
  // false — the hops above are where a journey's later legs are accounted for.
  const terminal = journey ? undefined : [...ordered].reverse().find(
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
      detail: journey
        ? `This journey is stitched from ${ordered.length} traced steps; the procedure walks its spine: where it starts, the boundaries it crosses, and the line that proves it ran. The full chain is on the Workflows tab.`
        : `The trace has ${ordered.length} steps; this procedure stops at the ${effects.length} that change something. The full trace is on the Workflows tab.`,
    });
  }

  const renumbered = steps.slice(0, MAX_PROCEDURE_STEPS).map((s, i) => ({ ...s, order: i + 1 }));
  if (renumbered.length < MIN_PROCEDURE_STEPS) {
    return { ok: false, skip: { reason: 'too_few_steps', detail: `only ${renumbered.length} verifiable step(s) could be built for "${input.title}"` } };
  }
  return { ok: true, draft: { kind: 'trace_flow', title: `Watch ${input.title} run end to end`, steps: renumbered, gaps } };
}

// ── walkthrough: an annotated reading of one real path ──────────────────────

/**
 * What a walkthrough step IS (doc/TUTORIAL_REDESIGN.md §2).
 *
 * The owner's sentence is the spec: *"code and it highlighted the important
 * lines, while explaining what it does, what is happening with handoff to next
 * step."* So one step is four things and nothing else:
 *
 *   1. a real snippet — the verified bytes already on `graph_nodes.snippet`,
 *      windowed to what fits a reader's eye (`window`);
 *   2. highlighted lines — LOCATED in those bytes, never guessed (§2.3);
 *   3. narration — 2-3 sentences on what this code does *in this flow*;
 *   4. one hand-off sentence naming where control or data goes next, or, on
 *      the last step, a landing statement naming what now exists.
 *
 * The `Do this / You should see / Check it worked` triptych is gone from here.
 * It was the right shape for a runbook and the wrong shape for a reading, and
 * it survives unchanged on the how-to procedures above.
 *
 * Every field below is deterministic. The model's whole remaining job is to
 * replace `narration` and `handoff.text` with better prose over a skeleton it
 * cannot alter — which is also why a facts-only package can render a complete
 * walkthrough with zero model calls.
 */
export type WalkthroughRole = 'entry' | 'hop' | 'effect' | 'landing';

export interface WalkthroughHighlight {
  /** Absolute file line numbers, always inside [lineStart, lineEnd]. */
  start: number;
  end: number;
  source: 'side_effect' | 'call_to_next' | 'boundary_token' | 'signature';
  /** Deterministic, from the evidence that located the range. */
  label: string;
}

export interface WalkthroughHandoff {
  text: string;
  /** `call` for an ordinary call edge; otherwise the boundary kind the composer emitted. */
  kind: string;
  toStep: number;
  toSymbol: string | null;
  toFile: string | null;
  source: 'ai' | 'deterministic';
}

export interface WalkthroughPhase {
  index: number;
  count: number;
  title: string;
  /** Journey member stable key; '' for a single flow's implicit phase. */
  member: string;
}

/** A call site in this repository that publishes the token a handler answers to. */
export interface WalkthroughEmitSite {
  filePath: string;
  symbolName: string | null;
  lineStart: number | null;
  /** Node span, for preferring the innermost enclosing symbol. */
  lineEnd: number | null;
}

/**
 * How this path is entered — stated, never assumed.
 *
 * The failure this closes: a walkthrough of a socket handler reads exactly like
 * a walkthrough of a route, so a reader assumes the same door. It is not the
 * same door — no request reaches a `socket:` registration, and a curl printed
 * beside one is a false instruction. `kind` comes from the entrypoint the
 * detector recorded, and `command` exists ONLY where a hand-sendable request
 * really is the trigger.
 */
export interface WalkthroughEntry {
  kind: 'http' | 'page' | 'ui_event' | 'event' | 'job' | 'cli' | 'export' | 'unknown';
  /** One or two sentences: what makes this code run. */
  text: string;
  /** `http` only. Anything else has no request to send, and prints none. */
  command?: string;
  /** The registration name a publisher has to write to reach this handler. */
  token?: string;
  /** Where that name is published inside this repository, innermost first. */
  emitters?: WalkthroughEmitSite[];
}

export interface WalkthroughStep {
  order: number;
  role: WalkthroughRole;
  filePath: string;
  symbolName: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  snippet: string | null;
  /** Absolute line span of the ~32-line reading window inside `snippet`. */
  window: { start: number; end: number } | null;
  narration: string;
  narrationSource: 'ai' | 'deterministic';
  highlights: WalkthroughHighlight[];
  handoff: WalkthroughHandoff | null;
  /** Last step only: what exists once the path has run. */
  landing: string | null;
  boundary: { kind: string; detail: string } | null;
  phase: WalkthroughPhase | null;
  /** First card only: what has to happen for this code to run at all. */
  entry?: WalkthroughEntry | null;
  /** Folded under its phase by default — nothing is cut, §3.2. */
  collapsed: boolean;
  evidence: string;
  nodeId?: string | null;
  nodeHash?: string | null;
  workflowStepOrder?: number;
  /** The optional "prove it live" appendix, on its own card. */
  appendix?: {
    marker: string;
    triggerAction: string;
    triggerCommand?: string;
    expected: string;
    revertCommand: string;
  };
}

export interface WalkthroughDraft {
  kind: 'walkthrough';
  title: string;
  steps: WalkthroughStep[];
  gaps: ProcedureGap[];
}

export type WalkthroughAttempt =
  | { ok: true; draft: WalkthroughDraft }
  | { ok: false; skip: ProcedureSkip };

/** Whatever `journeyComposer` emits on `workflows.metadata.journey`. */
export interface WalkthroughJourney {
  members: string[];
  memberTitles: string[];
  /** `kind` is read as an opaque string — boundary vocabulary is the composer's. */
  boundaries: Array<{ after: number; kind: string; detail?: string; token?: string; tokenRaw?: string }>;
}

export interface WalkthroughInput extends TraceInput {
  journey?: WalkthroughJourney | null;
  /** Each journey member's OWN traced steps, keyed by member stable key. */
  memberSteps?: Map<string, TraceStep[]>;
  /**
   * Sites in this repository that publish the token this flow's entry point is
   * registered under (`emit('…')`, `publish('…')`). For a handler that no
   * request can reach, this is the only honest answer to "how do I set it off".
   */
  emitSites?: WalkthroughEmitSite[];
}

/**
 * One card is enough.
 *
 * A reading has no setup overhead to amortise, so a flow whose trace is a
 * single symbol still yields something real: the snippet, the lines that
 * matter in it, and a landing statement saying what exists afterwards. That is
 * §7's "thin trace" fallback — render what was traced, state the thinness —
 * and it is strictly more honest than dropping the flow and showing nothing.
 */
export const MIN_WALKTHROUGH_STEPS = 1;
/** ~32 lines centred on the first highlight; the UI expands to the whole capture. */
export const WALKTHROUGH_WINDOW_LINES = 32;
/**
 * Ceiling on a window widened to reach distant highlights. Past this the card
 * would render most of a large symbol by default, so the primary window stays
 * and the reader opens the file instead.
 */
export const WALKTHROUGH_WINDOW_MAX_LINES = 120;
/** Visible cards per phase before the rest fold (§3.2, soft). */
export const PHASE_STEP_BUDGET = 3;
/**
 * Beyond this many visible cards the reader stops scrolling. Unlike
 * `MAX_PROCEDURE_STEPS` this is NOT a slice: it tightens the per-phase budget
 * and folds, because the completeness invariant forbids dropping a member or a
 * boundary. That is the direct fix for "the onboarding package generation is
 * just 2 steps".
 */
export const MAX_VISIBLE_WALKTHROUGH_STEPS = 16;
/** Folded sub-steps kept per phase; the remainder is stated as a gap. */
const MAX_COLLAPSED_PER_PHASE = 8;

/**
 * Structural boundary kinds → the one clause a reader needs about them.
 * Unknown kinds fall back to the composer's own `detail`, so a new boundary
 * vocabulary needs no edit here.
 */
const BOUNDARY_CLAUSE: Record<string, string> = {
  queue: 'asynchronous: the request has already returned, and the next step runs when the job is consumed',
  async_token: 'asynchronous: the request has already returned, and the next step runs when the job is consumed',
  redirect: 'control leaves this process and comes back on a different route',
  external_roundtrip: 'control leaves this process and comes back on a different route',
  group: 'the next step is a separate entry point on the same surface, so one request does not reach it',
  capability_unlock: 'the credential issued here is what the next step checks',
  resource_lifecycle: 'the identity created here is what the next step operates on',
};

/** `side_effects.type` → the verb a highlight label uses. Structural, not domain. */
const EFFECT_VERB: Record<string, string> = {
  database_write: 'writes',
  database_read: 'reads',
  http_request: 'calls out to',
  queue_enqueue: 'enqueues onto',
  queue_consume: 'consumes from',
  filesystem_read: 'reads the file',
  filesystem_write: 'writes the file',
  auth_check: 'checks identity with',
  env_read: 'reads configuration from',
  response_output: 'returns the response',
  external_integration: 'calls',
};

/** `side_effects.type` → what exists afterwards, for the landing statement. */
const EFFECT_RESULT: Record<string, string> = {
  database_write: 'rows written to',
  queue_enqueue: 'a job queued on',
  filesystem_write: 'a file written at',
  http_request: 'a call made to',
  external_integration: 'a call made to',
  auth_check: 'a session established through',
  response_output: 'a response returned by',
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The verbs above end on a preposition that only reads with a target after it. */
const DANGLING_PREPOSITION = /\s+(?:to|onto|on|at|from|with|through|by|out to|the file)$/;

/**
 * What a highlighted line does, in the detector's own vocabulary.
 *
 * `side_effects.target` is often null — the detector matched `.emit(` or
 * `.create(` without resolving a name — and the label then read "enqueues
 * onto", a sentence with its object missing. Falling back to the matched call
 * text keeps the label honest and says strictly more: the reader sees the
 * expression that put the highlight there.
 */
function effectLabel(effect: StepEffect): string {
  const verb = EFFECT_VERB[effect.kind] ?? effect.kind.replace(/_/g, ' ');
  if (effect.target) return `${verb} ${effect.target}`;
  const call = effect.evidence.trim().replace(/\s+/g, ' ').slice(0, 40);
  const base = verb.replace(DANGLING_PREPOSITION, '');
  return call ? `${base} (\`${call}\`)` : base;
}

/** Absolute line number of `index` in a snippet whose first line is `startLine`. */
function lineAt(snippet: string, index: number, startLine: number): number {
  let line = startLine;
  for (let i = 0; i < index && i < snippet.length; i++) {
    if (snippet.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * Where a literal appears in the verified snippet, as absolute lines.
 *
 * A miss returns null and the caller emits NO highlight — a guessed range on a
 * reformatted file is exactly the fabrication this tab exists to avoid. The
 * one concession is a retry on the needle's first line, because effect
 * evidence is often a multi-line call expression the snippet wraps differently.
 */
function locate(snippet: string, startLine: number, needle: string): { start: number; end: number } | null {
  const trimmed = needle.trim();
  if (trimmed.length < 3) return null;
  let idx = snippet.indexOf(trimmed);
  let match = trimmed;
  if (idx === -1) {
    const head = trimmed.split('\n')[0]!.trim();
    if (head.length < 6) return null;
    idx = snippet.indexOf(head);
    if (idx === -1) return null;
    match = head;
  }
  const start = lineAt(snippet, idx, startLine);
  return { start, end: lineAt(snippet, idx + match.length, startLine) };
}

/**
 * The lines that matter AT THIS STEP, in the priority order of §2.3. Every
 * range is located in the snippet's bytes — the same bytes the receipts prove
 * — and clamped to the step's own span. Zero highlights is a legal outcome.
 */
function deriveHighlights(step: TraceStep, next: TraceStep | undefined, boundary: { detail?: string; token?: string; tokenRaw?: string } | null): WalkthroughHighlight[] {
  const snippet = step.snippet;
  const startLine = step.lineStart;
  if (!snippet || startLine == null) return [];
  const endLine = step.lineEnd ?? startLine + snippet.split('\n').length;
  const out: WalkthroughHighlight[] = [];
  const seen = new Set<string>();
  const push = (range: { start: number; end: number } | null, source: WalkthroughHighlight['source'], label: string): void => {
    if (!range) return;
    const start = Math.max(range.start, startLine);
    const end = Math.min(Math.max(range.end, start), endLine);
    if (end < start) return;
    const key = `${start}-${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ start, end, source, label });
  };

  // 1. side_effect — the recorded call expression, found in the snippet.
  for (const effect of step.effects ?? []) {
    if (!effect.evidence) continue;
    push(locate(snippet, startLine, effect.evidence), 'side_effect', effectLabel(effect));
  }

  // 2. call_to_next — where this step hands control to the next one.
  if (next?.symbolName && next.symbolName !== step.symbolName && /^[\w$]+$/.test(next.symbolName)) {
    const re = new RegExp(`(?<![\\w$.])${escapeRe(next.symbolName)}\\s*(?=[(.])`);
    const m = re.exec(snippet);
    if (m) {
      push(
        { start: lineAt(snippet, m.index, startLine), end: lineAt(snippet, m.index + m[0].length, startLine) },
        'call_to_next',
        `calls ${next.symbolName}`,
      );
    }
  }

  // 3. boundary_token — the literal the hand-off matches on. The composer's
  //    raw token first, then its normalized one, and otherwise any literal
  //    quoted in its detail text. No boundary vocabulary is assumed either way.
  //
  //    Raw first because `locate` searches the snippet case-sensitively and
  //    the normalized token is lowercased with a trailing 's' stripped: the
  //    queue hand-off's own token, 'analysi', is in no snippet that spells it
  //    `getAnalysisQueue`, so the step lost the one highlight it had.
  if (boundary) {
    const tokens = boundary.tokenRaw || boundary.token
      ? [boundary.tokenRaw || boundary.token!]
      : [...(boundary.detail ?? '').matchAll(/['"`]([\w.:@/-]{3,})['"`]/g)].map((m) => m[1]!);
    for (const token of tokens) {
      const found = locate(snippet, startLine, `'${token}'`)
        ?? locate(snippet, startLine, `"${token}"`)
        ?? locate(snippet, startLine, `\`${token}\``)
        ?? locate(snippet, startLine, token);
      push(found, 'boundary_token', `the token this hand-off matches on: ${token}`);
    }
  }

  // 4. signature — always known, so a step is never left with nothing to look at.
  if (out.length === 0 && step.symbolName) {
    push({ start: startLine, end: startLine }, 'signature', `${step.symbolName} is declared here`);
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The lines the card shows by default: ~32 centred on the first highlight, then
 * widened to reach every other highlight that fits inside
 * `WALKTHROUGH_WINDOW_MAX_LINES`. The whole snippet when it is shorter.
 *
 * Measured on a live walkthrough: a step whose capture ran past line 600 was
 * highlighted at 423, 508 and 609 while the window showed 399-421, so the card
 * labelled three lines the reader could not see. Widening is capped because the
 * alternative on a long symbol is rendering the whole body by default; when the
 * highlights are too far apart the primary window stays and the reader uses the
 * UI's expand-to-whole-capture instead.
 */
function windowFor(step: TraceStep, highlights: WalkthroughHighlight[]): { start: number; end: number } | null {
  if (!step.snippet || step.lineStart == null) return null;
  const total = step.snippet.replace(/\n$/, '').split('\n').length;
  const first = step.lineStart;
  const last = first + total - 1;
  if (total <= WALKTHROUGH_WINDOW_LINES) return { start: first, end: last };
  const focus = highlights[0]?.start ?? first;
  let start = Math.max(first, focus - Math.floor(WALKTHROUGH_WINDOW_LINES / 2));
  const end = Math.min(last, start + WALKTHROUGH_WINDOW_LINES - 1);
  start = Math.max(first, end - WALKTHROUGH_WINDOW_LINES + 1);

  // Only a highlight inside the capture can be reached by widening; one beyond
  // it is a capture-size limit, which the expand link already covers.
  const inside = highlights.filter((h) => h.end >= first && h.start <= last);
  let lo = start;
  let hi = end;
  // Absorb the cheapest still-uncovered highlight until the cap blocks it.
  // Widening all-or-nothing instead would drop back to the primary window
  // whenever ONE highlight sits far off, hiding the near ones it could afford:
  // on the 399-620 capture highlighted at 423/508/609 that is 1 of 3 shown
  // rather than 2.
  for (;;) {
    let best: { lo: number; hi: number; cost: number } | null = null;
    for (const h of inside) {
      if (h.start >= lo && h.end <= hi) continue;
      const nlo = Math.max(first, Math.min(lo, h.start));
      const nhi = Math.min(last, Math.max(hi, h.end));
      const cost = (nhi - nlo) - (hi - lo);
      if (!best || cost < best.cost) best = { lo: nlo, hi: nhi, cost };
    }
    if (!best || best.hi - best.lo + 1 > WALKTHROUGH_WINDOW_MAX_LINES) break;
    lo = best.lo;
    hi = best.hi;
  }
  return { start: lo, end: hi };
}

/**
 * The 1-3 cards a phase shows by default: where the member is entered, its
 * strongest effects (distinct kinds first — a chain of `transform`s teaches
 * nothing), and, when a boundary follows, the step that performs the hand-off.
 */
function selectVisible(steps: TraceStep[], budget: number, mustEndOnHandoff: boolean): TraceStep[] {
  if (steps.length === 0) return [];
  const chosen = new Map<number, TraceStep>();
  chosen.set(steps[0]!.order, steps[0]!);

  const effects = steps.filter((s) =>
    s.order !== steps[0]!.order && s.stepKind != null && EFFECT_KINDS.has(s.stepKind) && !s.metadata?.syntheticReturn);
  const distinctKinds = new Set<string>();
  const distinctFirst = effects.filter((s) => {
    if (distinctKinds.has(s.stepKind!)) return false;
    distinctKinds.add(s.stepKind!);
    return true;
  });
  const handoffStep = mustEndOnHandoff
    ? (effects[effects.length - 1] ?? steps[steps.length - 1]!)
    : undefined;
  if (handoffStep) chosen.set(handoffStep.order, handoffStep);

  for (const s of [...distinctFirst, ...effects]) {
    if (chosen.size >= budget) break;
    chosen.set(s.order, s);
  }
  if (chosen.size < budget) {
    const last = steps[steps.length - 1]!;
    chosen.set(last.order, last);
  }
  return [...chosen.values()].sort((a, b) => a.order - b.order);
}

/** What exists once the path has run, from the terminal step's own effects. */
function landingStatement(step: TraceStep, phaseTitle: string | null): string {
  const facts = (step.effects ?? [])
    .map((e) => {
      const noun = EFFECT_RESULT[e.kind];
      if (!noun) return null;
      return e.target ? `${noun} \`${e.target}\`` : noun.replace(/ (to|on|at|through|by)$/, '');
    })
    .filter((f): f is string => Boolean(f));
  const unique = [...new Set(facts)];
  if (unique.length > 0) {
    return `When this path finishes: ${unique.join('; ')}.`;
  }
  return `This is where the path ends${phaseTitle ? ` in ${phaseTitle}` : ''}: ${step.description}`;
}

/** A test-shaped path: a real emitter, but not the one a product reader means. */
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;

/**
 * The publishers a reader should look at, innermost first.
 *
 * Two exclusions, both structural: a site inside the handler's own file is the
 * receiving side re-publishing (a broadcast), not the door in; and the widest
 * node that contains a call also "contains" it (a class body matches every
 * method's literal), so the narrowest span wins. Test harnesses are kept but
 * ranked last — they really do send the event, and saying so is more honest
 * than hiding the only emitter a repo has.
 */
function rankEmitters(sites: WalkthroughEmitSite[], handlerFile: string): WalkthroughEmitSite[] {
  const span = (s: WalkthroughEmitSite): number =>
    s.lineStart != null && s.lineEnd != null ? s.lineEnd - s.lineStart : Number.MAX_SAFE_INTEGER;
  const isTest = (s: WalkthroughEmitSite): boolean => TEST_PATH.test(s.filePath);
  const ranked = sites
    .filter((s) => s.filePath !== handlerFile)
    .sort((a, b) => (Number(isTest(a)) - Number(isTest(b))) || (span(a) - span(b)) || a.filePath.localeCompare(b.filePath));
  // A class body matches every literal its methods contain, so the enclosing
  // node is the SAME call seen from further out. Counting it twice would let
  // the entry statement claim two publishers where the repo has one.
  const kept: WalkthroughEmitSite[] = [];
  for (const site of ranked) {
    const contained = kept.some((k) =>
      k.filePath === site.filePath && site.lineStart != null && site.lineEnd != null
      && k.lineStart != null && k.lineStart >= site.lineStart && k.lineStart <= site.lineEnd);
    if (!contained) kept.push(site);
  }
  return kept.slice(0, 3);
}

/** `file:line (\`symbol\`)`, the one form every entry statement cites sites in. */
const siteRef = (s: WalkthroughEmitSite): string =>
  `\`${s.filePath}${s.lineStart != null ? `:${s.lineStart}` : ''}\`${s.symbolName ? ` (\`${s.symbolName}\`)` : ''}`;

function emitterClause(token: string, sites: WalkthroughEmitSite[]): string {
  if (sites.length === 0) {
    return ` No call publishing \`${token}\` was found in the analysed files, so whatever sends it lives outside this repository or was not parsed.`;
  }
  if (sites.length === 1) return ` In this repository that call is made at ${siteRef(sites[0]!)}.`;
  return ` In this repository ${sites.length} call sites publish it: ${sites.map(siteRef).join(', ')}.`;
}

/**
 * What has to happen for this code to run — the fact a reading cannot omit.
 *
 * Everything here is read off the entrypoint the detector recorded, so a
 * handler that no request can reach says so in those words and prints no
 * command. A curl appears in exactly one branch: an HTTP route.
 */
function deriveEntry(input: WalkthroughInput, entryStep: TraceStep, env?: RunEnvironment): WalkthroughEntry {
  // A journey is entered by its first member, not by the word "journey".
  const trigger = input.entryTriggerType ?? input.triggerType;
  const route = input.routePath;
  const emitters = rankEmitters(input.emitSites ?? [], entryStep.filePath);

  if (route && /^HTTP/i.test(trigger)) {
    const method = (input.httpMethod ?? 'GET').toUpperCase();
    const port = env ? servingPort(env, entryStep.filePath) : null;
    const parameterised = /[:{*]/.test(route);
    return {
      kind: 'http',
      text: `This path runs when a client sends \`${method} ${route}\` to the running app.`
        + (parameterised ? ` \`${route}\` carries path parameters: substitute real values from your own instance.` : '')
        + (port ? '' : ' No compose file publishes a host port, so use whichever port the start command printed.'),
      ...(port ? { command: `curl -i -X ${method} http://localhost:${port}${route}` } : {}),
    };
  }
  if (trigger === 'UI page' && route) {
    return { kind: 'page', text: `This path runs when someone opens \`${route}\` in the browser.` };
  }
  if (trigger === 'UI action') {
    const what = entryStep.symbolName ? `\`${entryStep.symbolName}\`` : baseOf(entryStep.filePath);
    return {
      kind: 'ui_event',
      text: `This path runs when a person interacts with ${what} on whichever page renders it. There is no URL of its own to open and nothing to send by hand.`,
    };
  }
  if (trigger === 'event_handler' || trigger === 'message_consumer') {
    // `prefix:name` is how the detector distinguishes registration surfaces
    // (`socket:`, `dom:`) without a new enum value; the bare name is the token
    // a publisher writes.
    const colon = route ? route.indexOf(':') : -1;
    const surface = colon > 0 ? route!.slice(0, colon) : null;
    const token = colon > 0 ? route!.slice(colon + 1) : route ?? null;
    if (surface === 'dom') {
      return {
        kind: 'ui_event',
        text: `This path runs when the browser fires \`${token}\` on the element this handler is bound to. No request reaches it. The event comes from the page itself.`,
        ...(token ? { token } : {}),
      };
    }
    if (token) {
      const registration = surface
        ? `the \`${surface}\` connection this handler is registered on`
        : 'the channel this handler is registered on';
      return {
        kind: surface === 'socket' ? 'event' : 'job',
        token,
        emitters,
        text: `Nothing you can curl reaches this code. It runs when something publishes \`${token}\` on ${registration}, and that publishing call is the real trigger.`
          + emitterClause(token, emitters),
      };
    }
    return { kind: 'event', text: 'This path runs when the event it is registered for is published; the graph did not record the event name.' };
  }
  if (trigger === 'cli_command') {
    return {
      kind: 'cli',
      text: `This path runs when the command in ${baseOf(entryStep.filePath)} is executed from a shell, not from the running app.`,
    };
  }
  if (trigger === 'export') {
    const what = entryStep.symbolName ? `\`${entryStep.symbolName}\`` : baseOf(entryStep.filePath);
    return { kind: 'export', text: `This path runs when another module imports ${what} and calls it. It has no trigger of its own.` };
  }
  return {
    kind: 'unknown',
    text: `The graph recorded no trigger for this path. Open ${baseOf(entryStep.filePath)} to see how it is registered.`,
  };
}

/**
 * One card per PLACE IN THE CODE, not one per traced step.
 *
 * The extractor records a trigger step and then one step per effect kind
 * against the same symbol, so a handler that writes and enqueues produced three
 * cards showing byte-identical lines with three different sentences under them.
 * Nothing is lost by merging them: the effects union, the descriptions join,
 * and the freed budget goes to the next distinct location — which is the only
 * kind of card that teaches a reader where anything happens.
 */
const MAX_MERGED_DESCRIPTIONS = 3;

function coalesceByLocation(steps: TraceStep[]): TraceStep[] {
  const out: TraceStep[] = [];
  const byKey = new Map<string, TraceStep>();
  const descriptions = new Map<string, string[]>();
  for (const step of steps) {
    const key = step.nodeId ?? `${step.filePath}:${step.lineStart ?? '?'}:${step.symbolName ?? ''}`;
    const held = byKey.get(key);
    if (!held) {
      const copy: TraceStep = { ...step, effects: [...(step.effects ?? [])] };
      byKey.set(key, copy);
      descriptions.set(key, [copy.description]);
      out.push(copy);
      continue;
    }
    const seen = new Set((held.effects ?? []).map((e) => `${e.kind}|${e.target ?? ''}|${e.evidence}`));
    for (const effect of step.effects ?? []) {
      const id = `${effect.kind}|${effect.target ?? ''}|${effect.evidence}`;
      if (seen.has(id)) continue;
      seen.add(id);
      held.effects!.push(effect);
    }
    const list = descriptions.get(key)!;
    if (!list.includes(step.description)) list.push(step.description);
    // A crossing recorded on a later duplicate still belongs to the merged card.
    if (step.metadata?.journeyBoundary && !held.metadata?.journeyBoundary) {
      held.metadata = { ...held.metadata, journeyBoundary: step.metadata.journeyBoundary };
    }
    // An effect kind outranks `trigger` for phase selection: the merged card
    // really does perform the write the duplicate recorded.
    if (held.stepKind === 'trigger' && step.stepKind != null && EFFECT_KINDS.has(step.stepKind)) {
      held.stepKind = step.stepKind;
    }
  }
  for (const step of out) {
    const list = descriptions.get(step.nodeId ?? `${step.filePath}:${step.lineStart ?? '?'}:${step.symbolName ?? ''}`) ?? [];
    step.description = list.slice(0, MAX_MERGED_DESCRIPTIONS).join('; ');
  }
  return out;
}

/** `Next: \`sym\` in file (clause)`. Always available, never shipped broken. */
function handoffTemplate(next: TraceStep, boundary: { kind: string; detail?: string } | null): string {
  const where = next.symbolName ? `\`${next.symbolName}\` in ${baseOf(next.filePath)}` : baseOf(next.filePath);
  if (!boundary) return `Execution continues in ${where}.`;
  const clause = BOUNDARY_CLAUSE[boundary.kind] ?? boundary.detail ?? `a ${boundary.kind.replace(/_/g, ' ')} hand-off`;
  return `Control crosses into ${where} (${clause}).`;
}

/**
 * The reading walkthrough, whole (doc/TUTORIAL_REDESIGN.md §2 and §3).
 *
 * The bound here is STRUCTURAL, not numeric. Every journey member becomes a
 * phase and every boundary becomes a connector; compression may only fold
 * sub-steps, never drop a member or a crossing. That invariant is the whole
 * answer to "the onboarding package generation is just 2 steps": v3's fixed
 * overhead (install, marker, trigger, revert) left a 4-member pipeline two
 * slots, and a reading has no setup overhead at all — the entire budget is the
 * path.
 */
export function attemptWalkthrough(input: WalkthroughInput, env?: RunEnvironment): WalkthroughAttempt {
  const ordered = coalesceByLocation([...input.steps].sort((a, b) => a.order - b.order));
  if (ordered.length === 0) {
    return { ok: false, skip: { reason: 'too_few_steps', detail: `"${input.title}" has no persisted steps to read.` } };
  }
  const gaps: ProcedureGap[] = [];
  const journey = input.journey && input.journey.members.length > 0 ? input.journey : null;

  // ── phases: one per journey member, always ────────────────────────────────
  const phaseSources: Array<{ member: string; title: string; steps: TraceStep[] }> = [];
  if (journey) {
    journey.members.forEach((member, i) => {
      const own = input.memberSteps?.get(member) ?? [];
      // The composer's compressed spine is the fallback when a member's own
      // workflow row could not be loaded — the member still gets its phase.
      const spine = ordered.filter((s) => s.metadata?.journeyMember === member);
      const source = own.length > 0 ? own : spine;
      phaseSources.push({
        member,
        title: journey.memberTitles[i] ?? member,
        steps: coalesceByLocation([...source].sort((a, b) => a.order - b.order)),
      });
    });
    const untraced = phaseSources.filter((p) => p.steps.length === 0);
    if (untraced.length > 0) {
      gaps.push({
        kind: 'phase_not_traced',
        detail: `${untraced.length} leg${untraced.length === 1 ? '' : 's'} of this path (${untraced.map((p) => p.title).join(', ')}) had no persisted trace, so ${untraced.length === 1 ? 'it has' : 'they have'} no card below.`,
      });
    }
  } else {
    phaseSources.push({ member: '', title: input.title, steps: ordered });
  }
  const phases = phaseSources.filter((p) => p.steps.length > 0);
  if (phases.length === 0) {
    return { ok: false, skip: { reason: 'too_few_steps', detail: `no leg of "${input.title}" has a traced step to read.` } };
  }

  const boundaryAfter = new Map((journey?.boundaries ?? []).map((b) => [b.after, b]));
  // Boundaries are indexed against the composer's full member list; the phases
  // that survived tracing keep their original index so a fold never silently
  // renumbers a crossing away.
  const memberIndex = new Map(phaseSources.map((p, i) => [p.member, i]));

  // ── per-phase visible budget, tightened rather than sliced ────────────────
  let budget = PHASE_STEP_BUDGET;
  let picked = phases.map((p) => selectVisible(p.steps, budget, boundaryAfter.has(memberIndex.get(p.member) ?? -1)));
  if (picked.reduce((n, s) => n + s.length, 0) > MAX_VISIBLE_WALKTHROUGH_STEPS && budget > 2) {
    budget = 2;
    picked = phases.map((p) => selectVisible(p.steps, budget, boundaryAfter.has(memberIndex.get(p.member) ?? -1)));
  }
  const visibleTotal = picked.reduce((n, s) => n + s.length, 0);
  if (visibleTotal > MAX_VISIBLE_WALKTHROUGH_STEPS) {
    gaps.push({
      kind: 'walkthrough_longer_than_budget',
      detail: `This path has ${phases.length} legs and renders ${visibleTotal} cards. That is past the ${MAX_VISIBLE_WALKTHROUGH_STEPS} a reader normally scrolls. Nothing was dropped: every leg and every crossing is still below.`,
    });
  }

  // ── flatten into ordered cards, visible first then this phase's folded rest ─
  interface Slot { trace: TraceStep; phaseIdx: number; collapsed: boolean }
  const slots: Slot[] = [];
  phases.forEach((phase, i) => {
    const visible = picked[i]!;
    const visibleOrders = new Set(visible.map((s) => s.order));
    for (const s of visible) slots.push({ trace: s, phaseIdx: i, collapsed: false });
    const folded = phase.steps.filter((s) => !visibleOrders.has(s.order));
    for (const s of folded.slice(0, MAX_COLLAPSED_PER_PHASE)) {
      slots.push({ trace: s, phaseIdx: i, collapsed: true });
    }
    if (folded.length > MAX_COLLAPSED_PER_PHASE) {
      gaps.push({
        kind: 'phase_substeps_truncated',
        detail: `${folded.length - MAX_COLLAPSED_PER_PHASE} further traced step${folded.length - MAX_COLLAPSED_PER_PHASE === 1 ? '' : 's'} inside "${phase.title}" ${folded.length - MAX_COLLAPSED_PER_PHASE === 1 ? 'is' : 'are'} on the Workflows tab.`,
      });
    }
  });
  if (slots.length < MIN_WALKTHROUGH_STEPS) {
    return { ok: false, skip: { reason: 'too_few_steps', detail: `"${input.title}" has no traced step that could be read.` } };
  }
  if (slots.length === 1) {
    gaps.push({
      kind: 'trace_is_one_step',
      detail: `Only one step was traced from "${input.title}", so this reading is a single card. The flow reaches no further symbol the graph could follow.`,
    });
  }

  // Hand-offs chain the VISIBLE cards; folded sub-steps are detail inside a
  // phase, not links in the path.
  const visibleSlots = slots.filter((s) => !s.collapsed);
  const orderOf = new Map<Slot, number>();
  slots.forEach((s, i) => orderOf.set(s, i + 1));

  const steps: WalkthroughStep[] = slots.map((slot) => {
    const t = slot.trace;
    const order = orderOf.get(slot)!;
    const phase = phases[slot.phaseIdx]!;
    const vIdx = slot.collapsed ? -1 : visibleSlots.indexOf(slot);
    const nextSlot = vIdx >= 0 ? visibleSlots[vIdx + 1] : undefined;
    const isLastVisible = vIdx >= 0 && vIdx === visibleSlots.length - 1;
    // A crossing sits after a phase's LAST visible card, and only when the
    // composer recorded one after that member.
    const crossesHere = Boolean(
      nextSlot && nextSlot.phaseIdx !== slot.phaseIdx
      && boundaryAfter.has(memberIndex.get(phase.member) ?? -1),
    );
    const rawBoundary = crossesHere ? boundaryAfter.get(memberIndex.get(phase.member) ?? -1)! : null;
    const boundary = rawBoundary ? { kind: rawBoundary.kind, detail: rawBoundary.detail ?? `${rawBoundary.kind.replace(/_/g, ' ')} hand-off` } : null;

    const highlights = deriveHighlights(t, nextSlot?.trace, boundary);
    const win = windowFor(t, highlights);
    const role: WalkthroughRole =
      order === 1 ? 'entry'
      : isLastVisible ? 'landing'
      : crossesHere ? 'hop'
      : (t.stepKind != null && EFFECT_KINDS.has(t.stepKind)) ? 'effect'
      : 'hop';

    return {
      order,
      role,
      filePath: t.filePath,
      symbolName: t.symbolName,
      lineStart: t.lineStart,
      lineEnd: t.lineEnd,
      snippet: t.snippet,
      window: win,
      narration: t.symbolName ? `\`${t.symbolName}\`: ${t.description}` : t.description,
      narrationSource: 'deterministic',
      highlights,
      handoff: nextSlot
        ? {
          text: handoffTemplate(nextSlot.trace, boundary),
          kind: boundary?.kind ?? 'call',
          toStep: orderOf.get(nextSlot)!,
          toSymbol: nextSlot.trace.symbolName,
          toFile: nextSlot.trace.filePath,
          source: 'deterministic',
        }
        : null,
      landing: isLastVisible ? landingStatement(t, journey ? phase.title : null) : null,
      boundary,
      phase: journey
        ? { index: slot.phaseIdx + 1, count: phases.length, title: phase.title, member: phase.member }
        : null,
      // Only the first card: a reading that does not say what makes the code
      // run leaves the reader to assume the door, and for a handler no request
      // can reach, the assumption is always wrong.
      entry: order === 1 ? deriveEntry(input, t, env) : null,
      collapsed: slot.collapsed,
      evidence: t.lineStart ? `${t.filePath}:${t.lineStart}` : t.filePath,
      nodeId: t.nodeId,
      nodeHash: t.nodeHash,
      workflowStepOrder: t.order,
    };
  });

  // ── the optional "prove it live" appendix (§5) ────────────────────────────
  // v3's marker / trigger / revert trio, compressed onto one collapsed card.
  // The verification machinery survives as an appendix instead of the spine.
  if (env) {
    const effects = ordered.filter((s) => s.stepKind != null && EFFECT_KINDS.has(s.stepKind));
    const probe = selectProbe(effects, ordered[0]!);
    const built = probe ? buildTrigger(input, env, ordered[0]!, probe) : null;
    if (probe && built?.trigger && probe.lineStart != null) {
      gaps.push(...built.gaps);
      steps.push({
        order: steps.length + 1,
        role: 'landing',
        filePath: probe.filePath,
        symbolName: probe.symbolName,
        lineStart: probe.lineStart,
        lineEnd: probe.lineEnd,
        snippet: null,
        window: null,
        narration: `Optional. Plant one revertible marker at the line this reading claims does the work, set the flow off, and watch it print.`,
        narrationSource: 'deterministic',
        highlights: [],
        handoff: null,
        landing: null,
        boundary: null,
        phase: null,
        collapsed: true,
        evidence: `${probe.filePath}:${probe.lineStart}`,
        nodeId: probe.nodeId,
        nodeHash: probe.nodeHash,
        appendix: {
          marker: `console.log('[trace] ${identifier(probe)} reached');`,
          triggerAction: built.trigger.action,
          triggerCommand: built.trigger.command,
          expected: built.trigger.expected,
          revertCommand: `git checkout -- ${probe.filePath}`,
        },
      });
    }
  }

  const title = journey
    ? `Read ${input.title} end to end`
    : `Read ${input.title} in the code`;
  return { ok: true, draft: { kind: 'walkthrough', title, steps, gaps } };
}

/**
 * The reading contract, checked — sibling of `lintProcedure`, which stays for
 * how-tos. Its most load-bearing check is path completeness: the moment a
 * member or a boundary can vanish silently, the tab is back to claiming a
 * four-stage pipeline is two steps.
 */
export interface WalkthroughFinding {
  stepOrder: number;
  code:
    | 'handoff_missing' | 'handoff_does_not_name_next' | 'landing_missing'
    | 'highlight_out_of_range' | 'narration_cites_absent_highlight'
    | 'member_not_covered' | 'boundary_not_covered' | 'narration_invents_a_request'
    | 'narration_filler' | 'narration_em_dash' | 'handoff_em_dash';
  detail: string;
}

/**
 * Openings that spend the reader's attention naming the thing they are already
 * looking at. The output that forced this gate, verbatim off a live step:
 * "This step involves interacting with the database table named
 * `analysis_jobs`. This interaction is a database read operation as part of
 * the overall job resumption process." — 27 words whose only fact, a read of
 * `analysis_jobs`, is already printed on the card as the step's own effect.
 */
const NARRATION_FILLER_OPENER =
  /^\s*(?:this (?:step|interaction|code|snippet)\b|this (?:function|method|file|handler|component|module) is responsible for\b)/i;

/** True of every step in every flow, therefore evidence of nothing. */
const NARRATION_FILLER_PHRASE = /\bas part of the (?:overall|larger|broader|wider|whole)\b/i;

/**
 * Whether narration describes the step instead of the code. Applied where the
 * model's prose is accepted, not in `lintWalkthrough`: a rejected narration is
 * replaced by the deterministic template before the lint ever sees the draft.
 */
export function narrationIsFiller(text: string): boolean {
  return NARRATION_FILLER_OPENER.test(text) || NARRATION_FILLER_PHRASE.test(text);
}

/**
 * Prose that tells the reader to send something. Harmless on an HTTP route,
 * false on every other entry kind — a socket handler is not reached by a
 * request, and a walkthrough that implies it is has invented the door.
 */
const CLAIMS_A_REQUEST = /\bcurl\b|\bsend(?:s|ing)? (?:a|an|the) (?:HTTP )?request\b|\bPOST(?:ing)? to\b|\bGET(?:ting)? from\b|\bhit(?:s|ting)? (?:the )?endpoint\b/i;

/** True when `text` names the next step's symbol or its file basename. */
export function handoffNamesNext(text: string, handoff: WalkthroughHandoff): boolean {
  const symbol = handoff.toSymbol;
  const base = handoff.toFile ? baseOf(handoff.toFile) : null;
  const lower = text.toLowerCase();
  return Boolean((symbol && lower.includes(symbol.toLowerCase())) || (base && lower.includes(base.toLowerCase())));
}

const HIGHLIGHT_REFERENCE = /\bhighlighted\b|\bthe highlight\b|\bhighlights? (?:above|below)\b/i;

export function lintWalkthrough(draft: WalkthroughDraft, journey?: WalkthroughJourney | null): WalkthroughFinding[] {
  const findings: WalkthroughFinding[] = [];
  const visible = draft.steps.filter((s) => !s.collapsed);
  visible.forEach((step, i) => {
    const isLast = i === visible.length - 1;
    if (!isLast && !step.handoff) {
      findings.push({ stepOrder: step.order, code: 'handoff_missing', detail: 'no hand-off sentence says where the path goes next' });
    }
    if (!isLast && step.handoff && !handoffNamesNext(step.handoff.text, step.handoff)) {
      findings.push({ stepOrder: step.order, code: 'handoff_does_not_name_next', detail: 'the hand-off names neither the next symbol nor its file' });
    }
    if (isLast && !step.landing) {
      findings.push({ stepOrder: step.order, code: 'landing_missing', detail: 'the last step does not say what now exists' });
    }
    if (step.highlights.length === 0 && HIGHLIGHT_REFERENCE.test(step.narration)) {
      findings.push({ stepOrder: step.order, code: 'narration_cites_absent_highlight', detail: 'the narration points at a highlight this step does not have' });
    }
  });
  const entry = draft.steps.find((s) => s.entry)?.entry ?? null;
  if (entry && entry.kind !== 'http') {
    for (const step of visible) {
      if (CLAIMS_A_REQUEST.test(step.narration) || (step.handoff && CLAIMS_A_REQUEST.test(step.handoff.text))) {
        findings.push({
          stepOrder: step.order,
          code: 'narration_invents_a_request',
          detail: `this path is entered by a ${entry.kind.replace(/_/g, ' ')}, not by a request, but the prose here tells the reader to send one`,
        });
      }
    }
  }
  for (const step of draft.steps) {
    for (const h of step.highlights) {
      if (step.lineStart != null && (h.start < step.lineStart || (step.lineEnd != null && h.end > step.lineEnd))) {
        findings.push({ stepOrder: step.order, code: 'highlight_out_of_range', detail: `highlight ${h.start}-${h.end} falls outside ${step.lineStart}-${step.lineEnd ?? '?'}` });
      }
    }
  }
  // Completeness invariant (§3.2): a fold may never lose a leg or a crossing.
  if (journey) {
    const covered = new Set(draft.steps.map((s) => s.phase?.member).filter(Boolean));
    journey.members.forEach((member, i) => {
      if (!covered.has(member)) {
        findings.push({ stepOrder: 0, code: 'member_not_covered', detail: `${journey.memberTitles[i] ?? member} is part of this path but has no card` });
      }
    });
    for (const b of journey.boundaries) {
      const seen = draft.steps.filter((s) => s.boundary && s.handoff?.kind === b.kind).length;
      if (seen === 0 && b.after < journey.members.length - 1) {
        findings.push({ stepOrder: 0, code: 'boundary_not_covered', detail: `the ${b.kind.replace(/_/g, ' ')} crossing after ${journey.memberTitles[b.after] ?? journey.members[b.after]} is not shown as a connector` });
      }
    }
  }
  return findings;
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
        detail: `"${action.slice(0, 80)}" describes rather than instructs: a step starts with the verb the reader performs`,
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
