import * as fs from 'node:fs';
import type { RepoFileRecord, RepoInventory, EvidenceNode } from '../types/analysis.js';
import { andList, type ExtractedWorkflow, type WorkflowStep } from './workflowExtractor.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';
import { configKey } from './stableKeys.js';

/**
 * Config-as-flow extraction (doc/DETECTION_COVERAGE.md §3): "flow is not
 * just code". Compose files, Dockerfiles, package scripts, CI yaml, and
 * .env.example ARE the DevOps journeys — parsed deterministically (no LLM,
 * no YAML dependency: indentation-scoped line parsing, degrades to nothing
 * on exotic files, never guesses).
 *
 * Outputs:
 *  - runtime topology (compose services + wiring) — the big_picture anchor
 *    diagram's data, stamped into the compose config node's metadata;
 *  - dev-workflow journeys ("docker compose up", the one-command test run,
 *    "what happens on push") as workflow rows referencing config nodes;
 *  - env var names (never values) and package scripts stamped into their
 *    config nodes for the reference sections.
 */

export interface ComposeService {
  name: string;
  line: number;
  image?: string;
  buildContext?: string;
  dockerfile?: string;
  command?: string;
  ports: string[];
  dependsOn: string[];
  envFiles: string[];
}

export interface RuntimeTopology {
  composePath: string;
  services: ComposeService[];
}

export interface CiPipeline {
  path: string;
  triggers: string[];
  jobs: Array<{ name: string; needs: string[] }>;
}

export interface EnvVarDoc {
  name: string;
  comment?: string;
}

export interface ConfigFlowResult {
  /** Main compose topology (basename without 'test'), if any. */
  topology: RuntimeTopology | null;
  /** Test compose topology (docker-compose.test.yml and friends), if any. */
  testTopology: RuntimeTopology | null;
  ci: CiPipeline[];
  envVars: Array<{ path: string; vars: EnvVarDoc[] }>;
  packageScripts: Array<{ root: string; packageJsonPath: string; scripts: Record<string, string> }>;
  /** Dev-workflow journeys, ready to persist beside code workflows. */
  workflows: ExtractedWorkflow[];
}

export interface ExtractConfigFlowsInput {
  fileRecords: RepoFileRecord[];
  inventory: RepoInventory;
  /** Mutated in place: topology/env/scripts/ci stamped into node metadata. */
  configNodes: EvidenceNode[];
}

export function extractConfigFlows(input: ExtractConfigFlowsInput): ConfigFlowResult {
  const nodeByPath = new Map(input.configNodes.map((n) => [n.filePath, n]));
  const recordByPath = new Map(input.fileRecords.map((r) => [r.relativePath, r]));

  // ── Compose topologies ────────────────────────────────────────────────────
  const composePaths = input.fileRecords
    .filter((r) => /^docker-compose[\w.-]*\.ya?ml$|^compose\.ya?ml$/.test(basename(r.relativePath)))
    .map((r) => r.relativePath)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

  let topology: RuntimeTopology | null = null;
  let testTopology: RuntimeTopology | null = null;
  for (const p of composePaths) {
    const parsed = parseCompose(p, readSafe(recordByPath.get(p)));
    if (!parsed || parsed.services.length === 0) continue;
    const isTest = /test/i.test(basename(p));
    if (isTest && !testTopology) testTopology = parsed;
    else if (!isTest && !topology) topology = parsed;
    const node = nodeByPath.get(p);
    if (node) node.metadata.topology = parsed;
  }

  // ── CI pipelines ──────────────────────────────────────────────────────────
  const ci: CiPipeline[] = [];
  for (const r of input.fileRecords) {
    if (!/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(r.relativePath)) continue;
    const pipeline = parseCiWorkflow(r.relativePath, readSafe(r));
    if (!pipeline) continue;
    ci.push(pipeline);
    const node = nodeByPath.get(r.relativePath);
    if (node) node.metadata.ci = pipeline;
  }

  // ── .env.example variable names (names + comments only, never values) ────
  const envVars: ConfigFlowResult['envVars'] = [];
  for (const r of input.fileRecords) {
    if (!/\.env\.(example|sample|template)$/.test(basename(r.relativePath))) continue;
    const vars = parseEnvExample(readSafe(r));
    if (vars.length === 0) continue;
    envVars.push({ path: r.relativePath, vars });
    const node = nodeByPath.get(r.relativePath);
    if (node) node.metadata.envVars = vars;
  }

  // ── package.json scripts (already parsed by the inventory) ───────────────
  const packageScripts: ConfigFlowResult['packageScripts'] = [];
  for (const pkg of input.inventory.packages) {
    const scripts = pkg.scripts ?? {};
    if (Object.keys(scripts).length === 0) continue;
    packageScripts.push({ root: pkg.root, packageJsonPath: pkg.packageJsonPath, scripts });
    const node = nodeByPath.get(pkg.packageJsonPath);
    if (node) node.metadata.scripts = scripts;
  }

  // ── Dev-workflow journeys ────────────────────────────────────────────────
  const workflows: ExtractedWorkflow[] = [];
  if (topology) workflows.push(composeUpWorkflow(topology));
  if (testTopology) workflows.push(composeTestWorkflow(testTopology));
  for (const pipeline of ci) {
    const wf = ciWorkflow(pipeline);
    if (wf) workflows.push(wf);
  }

  return { topology, testTopology, ci, envVars, packageScripts, workflows };
}

// ─── Journey builders ────────────────────────────────────────────────────────

function configEntrypoint(path: string): DetectedEntrypoint {
  // Synthetic: persistWorkflows only uses it for the (absent) entrypoint-row
  // lookup; steps carry the real config-node references.
  return { nodeStableKey: configKey(path), kind: 'export', filePath: path };
}

function step(
  order: number,
  path: string,
  kind: WorkflowStep['stepKind'],
  description: string,
  line?: number,
): WorkflowStep {
  return {
    stepOrder: order,
    nodeStableKey: configKey(path),
    filePath: path,
    lineStart: line,
    stepKind: kind,
    deterministicDescription: description,
  };
}

function describeService(s: ComposeService): string {
  const bits: string[] = [];
  if (s.image) bits.push(`image ${s.image}`);
  if (s.buildContext || s.dockerfile) {
    bits.push(`build ${s.dockerfile ?? s.buildContext ?? '.'}`);
  }
  if (s.ports.length > 0) bits.push(`ports ${s.ports.join(', ')}`);
  if (s.dependsOn.length > 0) bits.push(`depends on ${s.dependsOn.join(', ')}`);
  if (s.command) bits.push(`runs \`${s.command}\``);
  return bits.length > 0 ? ` (${bits.join('; ')})` : '';
}

const MAX_SERVICE_STEPS = 8;

function composeUpWorkflow(topology: RuntimeTopology): ExtractedWorkflow {
  const p = topology.composePath;
  // depends_on order: dependencies first, so the steps read as the real
  // startup sequence.
  const services = orderByDependsOn(topology.services);
  const steps: WorkflowStep[] = [
    step(1, p, 'trigger', `Run \`docker compose up --build\` (${p})`),
  ];
  for (const s of services.slice(0, MAX_SERVICE_STEPS)) {
    steps.push(step(steps.length + 1, p, 'side_effect', `Starts service ${s.name}${describeService(s)}`, s.line));
  }
  const names = services.map((s) => s.name).join(', ');
  return {
    title: 'Local dev: docker compose up',
    triggerType: 'dev_command',
    purpose: `Starts the local development environment: ${services.length} services (${names})`,
    stableKey: `wf:config:compose-up:${p}`,
    confidence: 'high',
    entrypoint: configEntrypoint(p),
    steps,
    importanceScore: 2 + services.length * 0.1,
    tier: 'supporting',
  rankingReasons: ['developer/CI command, not a user-facing flow'],
  externalDependencies: [],
    metadata: { config_flow: 'compose_up', compose_path: p },
  };
}

function composeTestWorkflow(topology: RuntimeTopology): ExtractedWorkflow {
  const p = topology.composePath;
  const runner = topology.services[0]!;
  const steps: WorkflowStep[] = [
    step(1, p, 'trigger', `Run \`docker compose -f ${p} run --rm ${runner.name}\``),
  ];
  for (const s of orderByDependsOn(topology.services).slice(0, MAX_SERVICE_STEPS)) {
    steps.push(step(steps.length + 1, p, 'side_effect', `Runs ${s.name}${describeService(s)}`, s.line));
  }
  return {
    title: 'Run the test suite (one command)',
    triggerType: 'dev_command',
    purpose: `Runs every automated test in containers via ${p}`,
    stableKey: `wf:config:compose-test:${p}`,
    confidence: 'high',
    entrypoint: configEntrypoint(p),
    steps,
    importanceScore: 1.8,
    tier: 'supporting',
  rankingReasons: ['developer/CI command, not a user-facing flow'],
  externalDependencies: [],
    metadata: { config_flow: 'compose_test', compose_path: p },
  };
}

function ciWorkflow(pipeline: CiPipeline): ExtractedWorkflow | null {
  if (pipeline.jobs.length === 0) return null;
  const p = pipeline.path;
  const triggers = pipeline.triggers.length > 0 ? pipeline.triggers.join(', ') : 'push';
  const steps: WorkflowStep[] = [
    step(1, p, 'trigger', `Triggered by ${triggers} (${basename(p)})`),
  ];
  for (const job of orderJobsByNeeds(pipeline.jobs).slice(0, MAX_SERVICE_STEPS)) {
    const needs = job.needs.length > 0 ? ` (needs: ${job.needs.join(', ')})` : '';
    steps.push(step(steps.length + 1, p, 'side_effect', `Runs job ${job.name}${needs}`));
  }
  return {
    title: `CI: on ${triggers}`,
    triggerType: 'ci_pipeline',
    // A colon followed by a bare job list read as a label, not a sentence:
    // a one-job workflow shipped "Continuous integration pipeline (ci.yml):
    // verify". The job names are still verbatim — they are the fact — but they
    // now sit in a clause that says what the pipeline does with them.
    purpose: `Continuous integration pipeline (${basename(p)}); runs the ${
      andList(pipeline.jobs.map((j) => j.name))
    } job${pipeline.jobs.length === 1 ? '' : 's'}.`,
    stableKey: `wf:config:ci:${p}`,
    confidence: 'high',
    entrypoint: configEntrypoint(p),
    steps,
    importanceScore: 1.5,
    tier: 'supporting',
  rankingReasons: ['developer/CI command, not a user-facing flow'],
  externalDependencies: [],
    metadata: { config_flow: 'ci_pipeline', ci_path: p },
  };
}

/** Dependencies before dependents; stable order otherwise. */
function orderByDependsOn(services: ComposeService[]): ComposeService[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const ordered: ComposeService[] = [];
  const seen = new Set<string>();
  const visit = (s: ComposeService, depth: number): void => {
    if (seen.has(s.name) || depth > 10) return;
    seen.add(s.name);
    for (const dep of s.dependsOn) {
      const d = byName.get(dep);
      if (d) visit(d, depth + 1);
    }
    ordered.push(s);
  };
  for (const s of services) visit(s, 0);
  return ordered;
}

function orderJobsByNeeds(jobs: CiPipeline['jobs']): CiPipeline['jobs'] {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  const ordered: CiPipeline['jobs'] = [];
  const seen = new Set<string>();
  const visit = (j: CiPipeline['jobs'][number], depth: number): void => {
    if (seen.has(j.name) || depth > 10) return;
    seen.add(j.name);
    for (const dep of j.needs) {
      const d = byName.get(dep);
      if (d) visit(d, depth + 1);
    }
    ordered.push(j);
  };
  for (const j of jobs) visit(j, 0);
  return ordered;
}

// ─── Parsers (indentation-scoped, no YAML dependency) ───────────────────────

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function readSafe(record: RepoFileRecord | undefined): string {
  if (!record) return '';
  try {
    return fs.readFileSync(record.absolutePath, 'utf8');
  } catch {
    return '';
  }
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Compose parser: `services:` block, per-service scalar/list fields. Handles
 * both inline (`build: ./src`) and block (`build:\n  context: .`) forms and
 * both list- and map-style depends_on. Comment and blank lines are skipped;
 * unknown keys are ignored.
 */
export function parseCompose(relativePath: string, text: string): RuntimeTopology | null {
  if (!text) return null;
  const lines = text.split('\n');
  const services: ComposeService[] = [];
  let inServices = false;
  let current: ComposeService | null = null;
  let listField: 'ports' | 'dependsOn' | 'envFiles' | null = null;
  let blockField: 'build' | 'dependsOnMap' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = indentOf(line);

    if (/^services:\s*$/.test(trimmed) && indent === 0) { inServices = true; current = null; continue; }
    if (indent === 0) { inServices = false; current = null; continue; }
    if (!inServices) continue;

    if (indent === 2) {
      const m = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
      current = m ? { name: m[1]!, line: i + 1, ports: [], dependsOn: [], envFiles: [] } : null;
      if (current) services.push(current);
      listField = null;
      blockField = null;
      continue;
    }
    if (!current) continue;

    if (indent === 4) {
      listField = null;
      blockField = null;
      const kv = trimmed.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, value] = kv;
      const val = stripQuotes(value!.trim());
      switch (key) {
        case 'image': if (val) current.image = val; break;
        case 'command': if (val) current.command = val; break;
        case 'container_name': break;
        case 'build':
          if (val) current.buildContext = val.replace(/^\.\//, '');
          else blockField = 'build';
          break;
        case 'ports': listField = 'ports'; break;
        case 'env_file':
          if (val) current.envFiles.push(val);
          else listField = 'envFiles';
          break;
        case 'depends_on':
          if (val) current.dependsOn.push(val);
          else { listField = 'dependsOn'; blockField = 'dependsOnMap'; }
          break;
        default: break;
      }
      continue;
    }

    if (indent >= 6) {
      const item = trimmed.match(/^-\s*(.+)$/);
      if (item && listField) {
        (current[listField] as string[]).push(stripQuotes(item[1]!.trim()));
        continue;
      }
      if (blockField === 'build') {
        const ctx = trimmed.match(/^context:\s*(\S+)/);
        if (ctx) current.buildContext = stripQuotes(ctx[1]!).replace(/^\.\/?$/, '.').replace(/^\.\//, '');
        const df = trimmed.match(/^dockerfile:\s*(\S+)/);
        if (df) current.dockerfile = stripQuotes(df[1]!);
        continue;
      }
      if (blockField === 'dependsOnMap' && indent === 6) {
        // map-style: `depends_on:\n      api:\n        condition: ...`
        const dep = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
        if (dep) current.dependsOn.push(dep[1]!);
      }
    }
  }

  return { composePath: relativePath, services };
}

/** GitHub Actions: `on:` triggers + job names with their needs-graph. */
export function parseCiWorkflow(relativePath: string, text: string): CiPipeline | null {
  if (!text) return null;
  const lines = text.split('\n');
  const triggers: string[] = [];
  const jobs: Array<{ name: string; needs: string[] }> = [];
  let section: 'on' | 'jobs' | null = null;
  let currentJob: { name: string; needs: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = indentOf(line);

    if (indent === 0) {
      currentJob = null;
      const onInline = trimmed.match(/^(?:on|"on"):\s*(.+)$/);
      if (onInline) {
        section = null;
        const val = onInline[1]!.trim();
        const list = val.match(/^\[(.*)\]$/);
        if (list) triggers.push(...list[1]!.split(',').map((s) => stripQuotes(s.trim())).filter(Boolean));
        else triggers.push(stripQuotes(val));
        continue;
      }
      if (/^(?:on|"on"):\s*$/.test(trimmed)) { section = 'on'; continue; }
      if (/^jobs:\s*$/.test(trimmed)) { section = 'jobs'; continue; }
      section = null;
      continue;
    }

    if (section === 'on' && indent === 2) {
      const key = trimmed.match(/^([A-Za-z_]+):/);
      if (key) triggers.push(key[1]!);
      continue;
    }

    if (section === 'jobs') {
      if (indent === 2) {
        const m = trimmed.match(/^([A-Za-z0-9_-]+):\s*$/);
        currentJob = m ? { name: m[1]!, needs: [] } : null;
        if (currentJob) jobs.push(currentJob);
        continue;
      }
      if (currentJob && indent === 4) {
        const needsInline = trimmed.match(/^needs:\s*(.+)$/);
        if (needsInline) {
          const val = needsInline[1]!.trim();
          const list = val.match(/^\[(.*)\]$/);
          if (list) currentJob.needs.push(...list[1]!.split(',').map((s) => stripQuotes(s.trim())).filter(Boolean));
          else currentJob.needs.push(stripQuotes(val));
        }
      }
    }
  }

  return { path: relativePath, triggers, jobs };
}

/** KEY names + immediately-preceding comment. Values are never captured. */
export function parseEnvExample(text: string): EnvVarDoc[] {
  if (!text) return [];
  const vars: EnvVarDoc[] = [];
  let pendingComment: string | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      const comment = line.replace(/^#+\s?/, '');
      pendingComment = pendingComment ? `${pendingComment} ${comment}` : comment;
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) {
      vars.push({ name: m[1]!, ...(pendingComment ? { comment: pendingComment.slice(0, 200) } : {}) });
    }
    pendingComment = undefined;
  }
  return vars;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '');
}
