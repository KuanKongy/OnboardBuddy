import { expect } from 'chai';
import * as path from 'path';
import { canonicalJsonHash, hashBody, sha256 } from '../hashUtils';
import { symbolKey, docKey, configKey, schemaKey, externalKey, slugify } from '../stableKeys';
import { isSecretPath } from '../privacyFilter';
import {
  scanRepositoryFiles,
  buildLanguageInventory,
  detectRepoInventory,
  buildRepoIndex,
} from '../repoIngester';
import { proposeScopes } from '../scopeProposal';
import { scanConfigNodes } from '../configScanner';
import { ingestDocs } from '../docsIngester';
import { buildEvidenceGraph } from '../evidenceGraphBuilder';
import { detectEntrypoints } from '../entrypointDetector';
import { detectSideEffects } from '../sideEffectDetector';
import { runPreflight } from '../preflightService';
import { typescriptParser } from '../parserInterface';
import type { FileAnalysis, RepoFileRecord, RepoInventory, EvidenceGraph } from '../../types/analysis';

const MIXED_DIR = path.resolve(__dirname, '../../fixtures/mixed');

describe('phase 2 — hashUtils', () => {
  it('canonicalJsonHash is insensitive to key order', () => {
    expect(canonicalJsonHash({ a: 1, b: [{ y: 2, x: 3 }] })).to.equal(
      canonicalJsonHash({ b: [{ x: 3, y: 2 }], a: 1 }),
    );
  });

  it('hashBody ignores trailing whitespace and blank-line runs', () => {
    expect(hashBody('function a() {\n  return 1;  \n}\n\n\n')).to.equal(
      hashBody('function a() {\n  return 1;\n}'),
    );
  });

  it('sha256 is deterministic and hex', () => {
    expect(sha256('x')).to.match(/^[0-9a-f]{64}$/);
  });
});

describe('phase 2 — stableKeys', () => {
  it('builds documented key formats', () => {
    expect(symbolKey('a/b.ts', 'fn')).to.equal('a/b.ts#fn');
    expect(symbolKey('a/b.ts', 'method', 'Klass')).to.equal('a/b.ts#Klass.method');
    expect(docKey('README.md', 'intro')).to.equal('doc:README.md#intro');
    expect(configKey('docker-compose.yml')).to.equal('config:docker-compose.yml');
    expect(schemaKey('migrations/001.sql', 'users')).to.equal('schema:migrations/001.sql#users');
    expect(externalKey('express')).to.equal('external:express');
  });

  it('normalizes windows separators', () => {
    expect(symbolKey('a\\b.ts', 'fn')).to.equal('a/b.ts#fn');
  });

  it('slugifies headings', () => {
    expect(slugify('Getting Started: Setup!')).to.equal('getting-started-setup');
  });
});

describe('phase 2 — privacyFilter', () => {
  it('drops secret-bearing files', () => {
    expect(isSecretPath('.env')).to.be.true;
    expect(isSecretPath('config/.env.production')).to.be.true;
    expect(isSecretPath('keys/server.pem')).to.be.true;
    expect(isSecretPath('.ssh/id_rsa')).to.be.true;
  });

  it('keeps example env files and normal source', () => {
    expect(isSecretPath('.env.example')).to.be.false;
    expect(isSecretPath('src/app.ts')).to.be.false;
  });
});

describe('phase 2 — repository scan + language inventory', () => {
  let records: RepoFileRecord[];

  before(async () => {
    records = await scanRepositoryFiles(MIXED_DIR);
  });

  it('never includes secret files', () => {
    expect(records.find((r) => r.relativePath === '.env')).to.be.undefined;
    expect(records.find((r) => r.relativePath === 'deploy/secrets.yml')).to.be.undefined;
  });

  it('keeps .env.example as config evidence', () => {
    const envExample = records.find((r) => r.relativePath === '.env.example');
    expect(envExample?.category).to.equal('config');
  });

  it('classifies categories and trust levels', () => {
    const byPath = new Map(records.map((r) => [r.relativePath, r]));
    expect(byPath.get('README.md')?.category).to.equal('doc');
    expect(byPath.get('README.md')?.trustLevel).to.equal('docs');
    expect(byPath.get('migrations/001_init.sql')?.category).to.equal('migration');
    expect(byPath.get('migrations/001_init.sql')?.trustLevel).to.equal('config');
    expect(byPath.get('src/app.ts')?.category).to.equal('source');
    expect(byPath.get('src/app.ts')?.supported).to.be.true;
    expect(byPath.get('main.py')?.supported).to.be.false;
  });

  it('language inventory buckets supported/unsupported/evidence-only', () => {
    const inv = buildLanguageInventory(records);
    expect(inv.supported.typescript).to.equal(2);
    expect(inv.unsupported.python).to.equal(1);
    expect(inv.evidenceOnly.markdown).to.be.greaterThan(0);
    expect(inv.supportedFileCount).to.equal(2);
    expect(inv.unsupportedFileCount).to.equal(1);
  });

  it('guardrail signal: unsupported-only scope has zero supported files', async () => {
    const pyOnly = records.filter((r) => r.language === 'python');
    const inv = buildLanguageInventory(pyOnly);
    expect(inv.supportedFileCount).to.equal(0);
  });

  it('scope prefix bounds the scan but keeps root inventory files', async () => {
    const scoped = await scanRepositoryFiles(MIXED_DIR, { pathPrefix: 'src' });
    const paths = scoped.map((r) => r.relativePath);
    expect(paths).to.include('src/app.ts');
    expect(paths).to.include('package.json');       // root inventory file
    expect(paths).to.not.include('main.py');        // outside scope
    expect(paths).to.not.include('migrations/001_init.sql');
  });
});

describe('phase 2 — repo inventory + scope proposal', () => {
  let records: RepoFileRecord[];
  let inventory: RepoInventory;

  before(async () => {
    records = await scanRepositoryFiles(MIXED_DIR);
    inventory = await detectRepoInventory(MIXED_DIR, records);
  });

  it('detects the package with dependencies and scripts', () => {
    const pkg = inventory.packages.find((p) => p.name === '@fixture/mixed');
    expect(pkg).to.exist;
    expect(pkg!.dependencies).to.include('express');
    expect(pkg!.scripts.dev).to.contain('node');
  });

  it('detects frameworks from dependencies', () => {
    expect(inventory.detectedFrameworks).to.include('express');
    expect(inventory.detectedFrameworks).to.include('docker');
  });

  it('parses docker compose services with build contexts', () => {
    const api = inventory.dockerServices.find((s) => s.name === 'api');
    expect(api).to.exist;
    expect(api!.buildContext).to.equal('src');
  });

  it('proposes whole-repo and docker-service scopes', () => {
    const proposals = proposeScopes(inventory, records);
    const kinds = proposals.map((p) => `${p.kind}:${p.pathPrefix}`);
    expect(kinds).to.include('whole_repo:');
    expect(kinds).to.include('docker_service:src');
  });
});

describe('phase 2 — config scanner + docs ingester', () => {
  let records: RepoFileRecord[];
  let inventory: RepoInventory;

  before(async () => {
    records = await scanRepositoryFiles(MIXED_DIR);
    inventory = await detectRepoInventory(MIXED_DIR, records);
  });

  it('emits config nodes and one schema node per created table', () => {
    const nodes = scanConfigNodes(records, inventory);
    const keys = nodes.map((n) => n.stableKey);
    expect(keys).to.include('config:package.json');
    expect(keys).to.include('config:docker-compose.yml');
    expect(keys).to.include('schema:migrations/001_init.sql#users');
    expect(keys).to.include('schema:migrations/001_init.sql#projects');
    for (const n of nodes) expect(n.trustLevel).to.equal('config');
  });

  it('splits docs into heading sections with docs trust and mention edges', () => {
    const known = new Set(records.map((r) => r.relativePath));
    const docs = ingestDocs(records, known);
    const architecture = docs.nodes.find((n) => n.stableKey === 'doc:README.md#architecture');
    expect(architecture).to.exist;
    expect(architecture!.trustLevel).to.equal('docs');
    const edge = docs.edges.find(
      (e) => e.sourceKey === 'doc:README.md#architecture' && e.targetKey === 'src/app.ts',
    );
    expect(edge).to.exist;
    expect(edge!.type).to.equal('documents');
  });
});

describe('phase 2 — symbol enrichment + evidence graph', () => {
  let fileAnalyses: FileAnalysis[];
  let records: RepoFileRecord[];
  let inventory: RepoInventory;
  let graph: EvidenceGraph;

  before(async () => {
    records = await scanRepositoryFiles(MIXED_DIR);
    inventory = await detectRepoInventory(MIXED_DIR, records);
    const index = await buildRepoIndex(MIXED_DIR);
    const ctx = await typescriptParser.createContext(index.files, MIXED_DIR);
    fileAnalyses = index.files.map((f) => typescriptParser.parseFile(ctx, f));

    const entrypoints = detectEntrypoints(fileAnalyses);
    const sideEffects = detectSideEffects(fileAnalyses);
    const configNodes = scanConfigNodes(records, inventory);
    const docs = ingestDocs(records, new Set(records.map((r) => r.relativePath)));

    graph = buildEvidenceGraph({
      fileAnalyses,
      fileRecords: records,
      entrypoints,
      sideEffects,
      configNodes,
      docs,
      rootPath: MIXED_DIR,
    });
  });

  it('symbols carry stable keys, hashes, and snippets', () => {
    const app = fileAnalyses.find((fa) => fa.relativePath.endsWith('app.ts'))!;
    const svc = app.symbols.find((s) => s.name === 'UserService')!;
    expect(svc.stableKey).to.equal('src/app.ts#UserService');
    expect(svc.bodyHash).to.match(/^[0-9a-f]{64}$/);
    expect(svc.signatureHash).to.match(/^[0-9a-f]{64}$/);
    expect(svc.snippet).to.contain('class UserService');
  });

  it('classifies trivial symbols deterministically', () => {
    const util = fileAnalyses.find((fa) => fa.relativePath.endsWith('util.ts'))!;
    const constSym = util.symbols.find((s) => s.name === 'MAX_USERS')!;
    const typeSym = util.symbols.find((s) => s.name === 'UserId')!;
    const fnSym = util.symbols.find((s) => s.name === 'formatUser')!;
    expect(constSym.isTrivial).to.be.true;
    expect(typeSym.isTrivial).to.be.true;
    expect(fnSym.isTrivial).to.be.true; // one-statement pass-through
  });

  it('resolves cross-file calls through the TypeChecker', () => {
    const app = fileAnalyses.find((fa) => fa.relativePath.endsWith('app.ts'))!;
    const svc = app.symbols.find((s) => s.name === 'UserService')!;
    const getLabel = svc.methods!.find((m) => m.name === 'getLabel')!;
    const resolved = getLabel.resolvedCalls?.find((c) => c.targetName === 'formatUser');
    expect(resolved).to.exist;
    expect(resolved!.targetRelativePath).to.equal('src/util.ts');
  });

  it('builds file, symbol, and method nodes with contains edges', () => {
    const keys = new Set(graph.nodes.map((n) => n.stableKey));
    expect(keys).to.include('src/app.ts');
    expect(keys).to.include('src/app.ts#UserService');
    expect(keys).to.include('src/app.ts#UserService.listUsers');
    const contains = graph.edges.filter((e) => e.type === 'contains').map((e) => `${e.sourceKey}>${e.targetKey}`);
    expect(contains).to.include('src/app.ts>src/app.ts#UserService');
    expect(contains).to.include('src/app.ts#UserService>src/app.ts#UserService.listUsers');
  });

  it('emits calls edges from resolved calls', () => {
    const call = graph.edges.find(
      (e) => e.type === 'calls' && e.sourceKey === 'src/app.ts#UserService.getLabel' && e.targetKey === 'src/util.ts#formatUser',
    );
    expect(call).to.exist;
    expect(call!.metadata.expression).to.equal('formatUser');
  });

  it('creates external boundary nodes for bare imports', () => {
    const ext = graph.nodes.find((n) => n.stableKey === 'external:express');
    expect(ext).to.exist;
    expect(ext!.type).to.equal('external');
    const edge = graph.edges.find(
      (e) => e.type === 'references_external' && e.sourceKey === 'src/app.ts' && e.targetKey === 'external:express',
    );
    expect(edge).to.exist;
  });

  it('links symbols to schema nodes they touch', () => {
    const edge = graph.edges.find(
      (e) => e.type === 'touches_schema' && e.targetKey === 'schema:migrations/001_init.sql#users',
    );
    expect(edge).to.exist;
  });

  it('includes doc and config nodes with correct trust levels', () => {
    const doc = graph.nodes.find((n) => n.type === 'doc');
    const config = graph.nodes.find((n) => n.stableKey === 'config:package.json');
    expect(doc?.trustLevel).to.equal('docs');
    expect(config?.trustLevel).to.equal('config');
  });

  it('keeps interim module type for file nodes (current UI contract)', () => {
    const file = graph.nodes.find((n) => n.stableKey === 'src/app.ts');
    expect(file!.type).to.equal('module');
  });
});

describe('phase 2 — preflight', () => {
  it('produces estimates, privacy summary, and size class', async () => {
    const preview = await runPreflight(MIXED_DIR, {
      depth: 'standard',
      privacyMode: 'full_ai',
    });
    expect(preview.estimates.supportedFiles).to.equal(2);
    expect(preview.estimates.symbols).to.be.greaterThan(0);
    expect(preview.estimates.llmCalls).to.be.greaterThan(0);
    expect(preview.sizeClass).to.equal('small');
    expect(preview.privacy.codeSnippetsLeaveSystem).to.be.true;
    expect(preview.proposedScopes.map((s) => s.kind)).to.include('whole_repo');
    expect(preview.limitations).to.contain('shallow');
  });

  it('ai_disabled plans zero LLM calls and sends nothing', async () => {
    const preview = await runPreflight(MIXED_DIR, {
      depth: 'standard',
      privacyMode: 'ai_disabled',
    });
    expect(preview.estimates.llmCalls).to.equal(0);
    expect(preview.privacy.llmCallsPlanned).to.be.false;
    expect(preview.privacy.evidenceSentToLlm).to.be.empty;
  });

  it('warns when nothing is supported', async () => {
    const preview = await runPreflight(MIXED_DIR, {
      pathPrefix: 'migrations',
      depth: 'standard',
      privacyMode: 'full_ai',
    });
    expect(preview.estimates.supportedFiles).to.equal(0);
    expect(preview.warnings.join(' ')).to.contain('No supported source files');
  });
});
