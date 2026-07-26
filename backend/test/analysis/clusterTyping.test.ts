import { expect } from 'chai';
import { clusterArchitecture } from '../../src/worker/engine/architectureClusterer';
import type { EvidenceGraph, EvidenceNode, RepoInventory, RepoPackage } from '../../src/worker/types/analysis';

/**
 * `fallbackKind` typed every path-rule-miss from the REPO-WIDE framework set —
 * the union of every package.json in the repo. One React dependency anywhere
 * therefore made `Backend · Modules` and `Server · Modules` `frontend_ui`; in
 * the audit that was 19 of 21 `* Modules` clusters.
 *
 * The fixture below is the minimum shape that reproduces it: a workspace with
 * a React frontend and an Express backend, plus files in each that no path
 * rule names (`frontend/src/features/…`, `backend/src/engine-ish/…`).
 */

const pkg = (root: string, deps: string[]): RepoPackage => ({
  root,
  packageJsonPath: root ? `${root}/package.json` : 'package.json',
  name: root || 'root',
  scripts: {},
  dependencies: deps,
  devDependencies: [],
  workspaces: [],
});

const fileNode = (stableKey: string): EvidenceNode => ({
  stableKey,
  type: 'module',
  name: stableKey.split('/').pop()!,
  filePath: stableKey,
  trustLevel: 'code',
  metadata: {},
});

const externalNode = (name: string): EvidenceNode => ({
  stableKey: `external:${name}`,
  type: 'external',
  name,
  filePath: null,
  trustLevel: 'code',
  metadata: { specifier: name },
});

function buildInput(opts: { extraEdges?: EvidenceGraph['edges'] } = {}) {
  const nodes: EvidenceNode[] = [
    // Unnamed by every PATH_RULE — these are the "* Modules" buckets.
    fileNode('frontend/src/features/billing.ts'),
    fileNode('frontend/src/features/BillingCard.tsx'),
    fileNode('backend/src/domain/pricing.ts'),
    fileNode('backend/src/domain/invoice.ts'),
    externalNode('react'),
    externalNode('express'),
  ];

  const edges: EvidenceGraph['edges'] = [
    {
      sourceKey: 'backend/src/domain/pricing.ts',
      targetKey: 'external:express',
      type: 'imports',
      confidence: 'high',
      metadata: {},
    },
    ...(opts.extraEdges ?? []),
  ];

  const inventory: RepoInventory = {
    packages: [pkg('', []), pkg('frontend', ['react', 'react-dom']), pkg('backend', ['express', 'pg'])],
    configs: [],
    dockerServices: [],
    // The union — what the old code read, and what must no longer decide.
    detectedFrameworks: ['react', 'express', 'postgres'],
  };

  return { graph: { nodes, edges }, inventory, workflows: [], rankings: [] };
}

const kindOf = (map: ReturnType<typeof clusterArchitecture>, label: string): string | undefined =>
  map.clusters.find((c) => c.label === label)?.kind;

describe('architecture cluster typing', () => {
  it('does not type a backend module bucket as frontend_ui because React is elsewhere in the repo', () => {
    const map = clusterArchitecture(buildInput());
    expect(kindOf(map, 'Backend · Modules')).to.not.equal('frontend_ui');
  });

  it('types the backend module bucket from what its files import', () => {
    // pricing.ts imports express; the bucket is server code.
    expect(kindOf(clusterArchitecture(buildInput()), 'Backend · Modules')).to.equal('api_layer');
  });

  it('still types the frontend module bucket as frontend_ui', () => {
    expect(kindOf(clusterArchitecture(buildInput()), 'Frontend · Modules')).to.equal('frontend_ui');
  });

  it('prefers a JSX majority over any manifest signal', () => {
    // A bucket of .tsx files is UI even if its package declares only express.
    const input = buildInput();
    input.graph.nodes = [
      fileNode('backend/src/domain/Widget.tsx'),
      fileNode('backend/src/domain/Panel.tsx'),
      fileNode('backend/src/domain/helper.ts'),
    ];
    input.graph.edges = [];
    expect(kindOf(clusterArchitecture(input), 'Backend · Modules')).to.equal('frontend_ui');
  });

  it('falls back to `other` rather than guessing when nothing is evidenced', () => {
    const input = buildInput();
    input.graph.nodes = [fileNode('tooling/src/domain/thing.ts')];
    input.graph.edges = [];
    input.inventory.packages = [pkg('', []), pkg('tooling', [])];
    expect(kindOf(clusterArchitecture(input), 'Tooling · Modules')).to.equal('other');
  });
});

describe('architecture cluster counts', () => {
  const schemaNode = (table: string): EvidenceNode => ({
    stableKey: `schema:migrations/001.sql#${table}`,
    type: 'schema',
    name: table,
    filePath: 'migrations/001.sql',
    trustLevel: 'config',
    metadata: {},
  });

  it('describes a schema cluster by its tables, not as "0 files"', () => {
    const input = buildInput();
    input.graph.nodes = [...input.graph.nodes, schemaNode('users'), schemaNode('projects'), schemaNode('runs')];
    const map = clusterArchitecture(input);
    const schema = map.clusters.find((c) => c.label === 'Database Schema')!;

    expect(schema.metadata.fileCount).to.equal(0); // genuinely no file members
    expect(schema.metadata.primaryMemberNoun).to.equal('table');
    expect(schema.deterministicSummary).to.contain('3 tables');
    expect(schema.deterministicSummary).to.not.contain('0 files');
  });

  it('describes a mostly-config cluster by its config files, not by its one module', () => {
    const configNode = (n: number): EvidenceNode => ({
      stableKey: `config:deploy/${n}.yml`,
      type: 'config',
      name: `${n}.yml`,
      filePath: `deploy/${n}.yml`,
      trustLevel: 'config',
      metadata: {},
    });
    const input = buildInput();
    input.graph.nodes = [fileNode('config/setup.ts'), configNode(1), configNode(2), configNode(3)];
    input.graph.edges = [];
    const cluster = clusterArchitecture(input).clusters.find((c) => c.label === 'Configuration & Deployment')!;
    expect(cluster.metadata.primaryMemberNoun).to.equal('config file');
    expect(cluster.deterministicSummary).to.contain('3 config files');
  });

  it('reports fileCount over file members only, and a type breakdown beside it', () => {
    const map = clusterArchitecture(buildInput());
    const backend = map.clusters.find((c) => c.label === 'Backend · Modules')!;
    expect(backend.metadata.fileCount).to.equal(2);
    expect(backend.metadata.primaryMemberNoun).to.equal('file');
    expect(backend.metadata.memberCountsByType).to.deep.equal({ module: 2 });
  });
});
