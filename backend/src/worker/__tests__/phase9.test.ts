import { expect } from 'chai';
import { propagateInvalidation, type InvalidationInput, type PrevRecordRef } from '../incrementalAnalyzer.js';

/**
 * Phase 9 unit tests: upward invalidation is driven by evidence hashes, so
 * staleness climbs symbol -> file -> module -> service -> system only when a
 * child's evidence actually changed — never from raw file-hash churn.
 */

function rec(stableKey: string, level: PrevRecordRef['level'], evidenceHash = `hash-${stableKey}`): PrevRecordRef {
  return { recordId: `id-${level}-${stableKey}`, stableKey, level, evidenceHash };
}

/** A small two-cluster repo: auth (a.ts, b.ts) and util (c.ts). */
function baseInput(overrides: Partial<InvalidationInput> = {}): InvalidationInput {
  const prevRecords = [
    rec('src/a.ts#login', 'symbol'),
    rec('src/a.ts#logout', 'symbol'),
    rec('src/b.ts#store', 'symbol'),
    rec('src/c.ts#pad', 'symbol'),
    rec('src/a.ts', 'file'),
    rec('src/b.ts', 'file'),
    rec('src/c.ts', 'file'),
    rec('cluster:auth', 'module'),
    rec('cluster:util', 'module'),
    rec('service:app', 'service'),
    rec('system', 'system'),
    rec('wf:login', 'workflow'),
    rec('capabilities', 'capability'),
  ];
  const unchanged = new Map(
    prevRecords.filter((r) => r.level === 'symbol').map((r) => [r.stableKey, r.evidenceHash]),
  );
  return {
    prevRecords,
    newSymbolEvidence: unchanged,
    addedSymbolFiles: new Set(),
    removedSymbolFiles: new Set(),
    removedFiles: new Set(),
    newClusterMembers: new Map([
      ['cluster:auth', new Set(['src/a.ts', 'src/b.ts'])],
      ['cluster:util', new Set(['src/c.ts'])],
    ]),
    prevClusterMembers: new Map([
      ['cluster:auth', new Set(['src/a.ts', 'src/b.ts'])],
      ['cluster:util', new Set(['src/c.ts'])],
    ]),
    clusterToService: new Map([
      ['cluster:auth', 'service:app'],
      ['cluster:util', 'service:app'],
    ]),
    prevWorkflowFingerprints: new Map([['wf:login', 'fp-1']]),
    newWorkflowFingerprints: new Map([['wf:login', 'fp-1']]),
    ...overrides,
  };
}

describe('phase 9 — upward invalidation', () => {
  it('invalidates nothing when no evidence changed (whitespace-only edits)', () => {
    // A comment-only edit changes the file hash but no symbol evidence hash,
    // no membership, no workflow fingerprint — propagation must stop cold.
    expect(propagateInvalidation(baseInput())).to.deep.equal([]);
  });

  it('climbs symbol -> file -> module -> service -> system -> capability on a body change', () => {
    const input = baseInput();
    input.newSymbolEvidence.set('src/a.ts#login', 'hash-DIFFERENT');
    const out = propagateInvalidation(input);
    const by = new Map(out.map((r) => [`${r.level}:${r.stableKey}`, r.reason]));
    expect(by.get('symbol:src/a.ts#login')).to.equal('evidence_changed');
    expect(by.get('file:src/a.ts')).to.equal('children_changed');
    expect(by.get('module:cluster:auth')).to.equal('children_changed');
    expect(by.get('service:service:app')).to.equal('children_changed');
    expect(by.get('system:system')).to.equal('children_changed');
    expect(by.get('capability:capabilities')).to.equal('children_changed');
    // The untouched branch stays valid.
    expect(by.has('file:src/c.ts')).to.equal(false);
    expect(by.has('module:cluster:util')).to.equal(false);
    expect(by.has('symbol:src/a.ts#logout')).to.equal(false);
  });

  it('treats a missing symbol as removed and stales its file record', () => {
    const input = baseInput();
    input.newSymbolEvidence.delete('src/b.ts#store');
    const out = propagateInvalidation(input);
    const by = new Map(out.map((r) => [`${r.level}:${r.stableKey}`, r.reason]));
    expect(by.get('symbol:src/b.ts#store')).to.equal('symbol_removed');
    expect(by.get('file:src/b.ts')).to.equal('children_changed');
  });

  it('flags added/removed symbols as file-structure changes even with no record change', () => {
    const out = propagateInvalidation(baseInput({ addedSymbolFiles: new Set(['src/c.ts']) }));
    const by = new Map(out.map((r) => [`${r.level}:${r.stableKey}`, r.reason]));
    expect(by.get('file:src/c.ts')).to.equal('children_changed');
    expect(by.get('module:cluster:util')).to.equal('children_changed');
  });

  it('detects removed files, membership changes, and cluster removal', () => {
    const input = baseInput({
      removedFiles: new Set(['src/c.ts']),
      newClusterMembers: new Map([
        ['cluster:auth', new Set(['src/a.ts', 'src/b.ts', 'src/d.ts'])], // gained a member
      ]), // cluster:util gone
    });
    const out = propagateInvalidation(input);
    const by = new Map(out.map((r) => [`${r.level}:${r.stableKey}`, r.reason]));
    expect(by.get('file:src/c.ts')).to.equal('file_removed');
    expect(by.get('module:cluster:auth')).to.equal('membership_changed');
    expect(by.get('module:cluster:util')).to.equal('cluster_removed');
    expect(by.get('system:system')).to.equal('children_changed');
  });

  it('invalidates workflow records on step fingerprint change or removal', () => {
    const changed = propagateInvalidation(baseInput({
      newWorkflowFingerprints: new Map([['wf:login', 'fp-2']]),
    }));
    expect(changed.find((r) => r.stableKey === 'wf:login')?.reason).to.equal('steps_changed');

    const removed = propagateInvalidation(baseInput({
      newWorkflowFingerprints: new Map(),
    }));
    expect(removed.find((r) => r.stableKey === 'wf:login')?.reason).to.equal('workflow_removed');
  });
});
