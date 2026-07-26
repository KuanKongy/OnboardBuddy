import { expect } from 'chai';
import { detectSideEffects, normalizeQueueToken } from '../sideEffectDetector';
import type { FileAnalysis } from '../../types/analysis';

/**
 * DETECTION_COVERAGE.md §2 sinks: auth/identity SDKs, named external
 * services, process exec, enqueue queue-hints, and the unknown-external
 * honesty fallback. Before these, an auth handler's only effects were
 * invisible and the whole User Auth journey traced to nothing.
 */

function fileWith(overrides: Partial<FileAnalysis>): FileAnalysis[] {
  return [
    {
      relativePath: 'src/api/routes/auth.ts',
      symbols: [],
      imports: [],
      ...overrides,
    } as unknown as FileAnalysis,
  ];
}

describe('side-effect sink detection (DETECTION_COVERAGE.md §2)', () => {
  it('classifies supabase.auth SDK calls as auth_call with a provider target', () => {
    const effects = detectSideEffects(fileWith({
      symbols: [{
        name: 'loginHandler',
        callsSymbols: ['supabase.auth.signInWithPassword'],
        snippet: `const { data } = await supabase.auth.signInWithPassword({ email, password });`,
      }],
    } as never));
    const auth = effects.filter((e) => e.kind === 'auth_call');
    expect(auth).to.have.length(1);
    expect(auth[0]!.target).to.equal('supabase.auth');
    expect(auth[0]!.symbolStableKey).to.equal('src/api/routes/auth.ts#loginHandler');
  });

  it('classifies jwt.sign and bcrypt as auth_call', () => {
    const effects = detectSideEffects(fileWith({
      symbols: [
        { name: 'mint', callsSymbols: [], snippet: `return jwt.sign(payload, secret);` },
        { name: 'check', callsSymbols: [], snippet: `return bcrypt.compare(pw, hash);` },
      ],
    } as never));
    expect(effects.filter((e) => e.kind === 'auth_call').map((e) => e.target))
      .to.have.members(['jwt', 'bcrypt']);
  });

  it('names managed-service SDK calls as external_service', () => {
    const effects = detectSideEffects(fileWith({
      symbols: [{
        name: 'listRepos',
        callsSymbols: ['octokit.rest.repos.listForOrg'],
        snippet: `await octokit.rest.repos.listForOrg({ org });`,
      }],
    } as never));
    const ext = effects.filter((e) => e.kind === 'external_service');
    expect(ext).to.have.length(1);
    expect(ext[0]!.target).to.equal('github api');
  });

  it('extracts job name and normalized queue hint from enqueue call sites', () => {
    const effects = detectSideEffects(fileWith({
      symbols: [{
        name: 'chainGeneration',
        callsSymbols: ['getSummaryQueue'],
        snippet: `await getSummaryQueue().add('generate_summary', { snapshotId });`,
      }],
    } as never));
    const publish = effects.filter((e) => e.kind === 'message_publish');
    expect(publish).to.have.length(1);
    expect(publish[0]!.target).to.equal('generate_summary');
    expect(publish[0]!.queueHint).to.equal('summary');
  });

  it('normalizeQueueToken aligns producer variables with consumer constants', () => {
    expect(normalizeQueueToken('getSummaryQueue')).to.equal(normalizeQueueToken('SUMMARY_QUEUE'));
    expect(normalizeQueueToken('analysisQueue')).to.equal(normalizeQueueToken('ANALYSIS_QUEUE'));
    // Singular producer variable vs plural queue name still matches.
    expect(normalizeQueueToken('reportQueue')).to.equal(normalizeQueueToken('reports'));
    // Distinct queues stay distinct.
    expect(normalizeQueueToken('SUMMARY_QUEUE')).to.not.equal(normalizeQueueToken('ANALYSIS_QUEUE'));
  });

  it('detects an enqueue from callsSymbols alone when the snippet is truncated', () => {
    // Giant functions get their snippet capped; the callee expression
    // survives in callsSymbols without arguments — queue known, job unknown.
    const effects = detectSideEffects(fileWith({
      symbols: [{
        name: 'processAnalysisJob',
        callsSymbols: ['query', 'getSummaryQueue().add', 'getSummaryQueue'],
        snippet: `/* … 12k chars of earlier body, enqueue truncated away … */`,
      }],
    } as never));
    const publish = effects.filter((e) => e.kind === 'message_publish');
    expect(publish).to.have.length(1);
    expect(publish[0]!.queueHint).to.equal('summary');
    expect(publish[0]!.target).to.equal(undefined);
  });

  it('Set.add with a string arg is not a queue enqueue', () => {
    const effects = detectSideEffects(fileWith({
      symbols: [{
        name: 'detectRepoInventory',
        callsSymbols: ['frameworks.add'],
        snippet: `frameworks.add('docker'); seen.add('x');`,
      }],
    } as never));
    expect(effects.filter((e) => e.kind === 'message_publish')).to.have.length(0);
  });

  it('plain res.send is no longer a message publish', () => {
    const effects = detectSideEffects(fileWith({
      symbols: [{
        name: 'pingHandler',
        callsSymbols: ['res.send'],
        snippet: `res.send('pong');`,
      }],
    } as never));
    expect(effects.filter((e) => e.kind === 'message_publish')).to.have.length(0);
  });

  it('emits one low-confidence unknown_external per (file, package) under the honesty rule', () => {
    const effects = detectSideEffects(fileWith({
      relativePath: 'src/lib/geo.ts',
      imports: [
        { toSpecifier: 'mystery-geo-sdk', namedImports: [{ name: 'locate', isTypeOnly: false, alias: null }], isTypeOnly: false },
      ],
      symbols: [
        { name: 'whereAmI', callsSymbols: ['locate'], snippet: `return locate(ip);` },
        { name: 'whereAreYou', callsSymbols: ['locate'], snippet: `return locate(other);` },
      ],
    } as never));
    const unknown = effects.filter((e) => e.kind === 'unknown_external');
    expect(unknown).to.have.length(1);
    expect(unknown[0]!.target).to.equal('mystery-geo-sdk');
    expect(unknown[0]!.confidence).to.equal('low');
  });

  it('never emits unknown_external for pure packages or recognized symbols', () => {
    const effects = detectSideEffects(fileWith({
      relativePath: 'src/components/Chart.tsx',
      imports: [
        { toSpecifier: 'react', namedImports: [{ name: 'useState', isTypeOnly: false, alias: null }], isTypeOnly: false },
      ],
      symbols: [
        { name: 'Chart', callsSymbols: ['useState'], snippet: `const [v] = useState(0);` },
      ],
    } as never));
    expect(effects.filter((e) => e.kind === 'unknown_external')).to.have.length(0);
  });
  // Contract: a data client that is not an ORM still writes. `Jobs.insertOne`
  // matched no pattern before, so the flows that were the product measured as
  // changing nothing and never bound a capability.
  it('detects a document-store write through a file-level resource binding and names the resource', () => {
    const effects = detectSideEffects(fileWith({
      relativePath: 'api/src/index.js',
      symbols: [
        { name: 'Jobs', kind: 'variable', initializer: `db.collection("jobs")` },
        { name: 'createJob', callsSymbols: ['Jobs.insertOne'], snippet: `const { insertedId } = await Jobs.insertOne(job);` },
      ],
    } as never));
    const write = effects.find((e) => e.kind === 'database_write' && e.symbolName === 'createJob');
    expect(write, 'insertOne through a bound collection is a write').to.not.equal(undefined);
    expect(write!.target).to.equal('jobs');
  });

  // Contract: declaration is not mutation. A module-scope literal used to match
  // its OWN declaration text, so every constant table in a repo shipped as a
  // low-confidence write and crowded the real mutators out of the top slice.
  it('reads a module-scope declaration as a declaration and only a later write as a mutation', () => {
    const effects = detectSideEffects(fileWith({
      relativePath: 'src/lib/data.ts',
      symbols: [
        { name: 'LINKS', kind: 'variable', initializer: `[{ href: "/a" }]`, snippet: `export const LINKS = [{ href: "/a" }];` },
        { name: 'reset', kind: 'arrow-function', callsSymbols: [], snippet: `LINKS = [];` },
      ],
    } as never));
    expect(effects.map((e) => e.symbolName)).to.deep.equal(['reset']);
  });
});
