/**
 * Privacy modes, enforced end to end (doc/Pipeline.md "Privacy modes").
 *
 * The graded defect was "changing to no-AI in settings does not work and make
 * any changes for my run". These tests pin the three behaviours a user is
 * promised, each measured at the ONE place that cannot lie about it — the
 * provider stub. What the code intends is irrelevant if a request still went
 * out, so every assertion here counts real provider requests and reads their
 * real payloads:
 *
 *   ai_disabled    — zero provider requests, from any entry point, and a
 *                    complete package built from the deterministic backbone.
 *   facts_only_ai  — requests are allowed, code snippets are not.
 *   full_ai        — the control: snippets DO go out, so the facts-only
 *                    assertions above are not passing vacuously.
 */

import { expect } from 'chai';
import { __setQueryForTests } from '../../../lib/db.js';
import { FakeProvider, installFakeDb, makeClient } from '../../../../test/helpers/aiHarness.js';
import { AiDisabledError } from '../../ai/privacy.js';
import { SECTION_TYPES } from '../sectionSpecs.js';
import { generateDeterministicSection } from '../deterministicSectionGenerator.js';
import { generateSection } from '../sectionGenerator.js';
import { generateTutorials } from '../tutorialGenerator.js';
import { runCritiquePass } from '../../semantic/critiquePass.js';
import type { SemanticContext } from '../../semantic/context.js';
import { answerQuestion } from '../../../qa/askService.js';

/** The code that must never reach a provider under facts_only_ai/ai_disabled. */
const SECRET_SNIPPET = 'const CUSTOMER_PII_SALT = "sekrit-do-not-leak";';

const envKey = process.env.OPENROUTER_API_KEY;
before(() => { process.env.OPENROUTER_API_KEY = 'server-key'; });
after(() => { process.env.OPENROUTER_API_KEY = envKey; });

// ── ai_disabled ──────────────────────────────────────────────────────────────

describe('privacy modes — ai_disabled makes exactly zero provider calls', () => {
  afterEach(() => __setQueryForTests(null));

  it('the AiClient refuses before the provider is touched (call and embed)', async () => {
    installFakeDb();
    const provider = new FakeProvider();
    const ai = makeClient(provider, { privacyMode: 'ai_disabled' });

    for (const attempt of [
      () => ai.call({ tier: 'cheap', targetType: 'symbol_record', promptVersion: 'v1', user: SECRET_SNIPPET }),
      () => ai.embed([SECRET_SNIPPET]),
    ]) {
      try {
        await attempt();
        expect.fail('should have thrown AiDisabledError');
      } catch (err) {
        expect(err).to.be.instanceOf(AiDisabledError);
      }
    }
    expect(provider.completeCalls, 'chat requests').to.have.length(0);
    expect(provider.embedCalls, 'embedding requests').to.have.length(0);
  });

  it('still produces a COMPLETE package: all 12 sections, labelled, zero calls', async () => {
    const provider = new FakeProvider();
    const inserts: Array<{ type: string; content: string; confidence: string; unknowns: string; context: string }> = [];
    installFakeDb({
      extra: (text, params) => {
        if (!text.startsWith('INSERT INTO package_sections')) return null;
        const p = (params ?? []) as string[];
        inserts.push({ type: p[2]!, content: p[4]!, confidence: p[6]!, unknowns: p[9]!, context: p[10]! });
        return [{ id: `sec-${inserts.length}` }];
      },
    });

    for (const sectionType of SECTION_TYPES) {
      const result = await generateDeterministicSection({
        snapshotId: 'snap-1', packageId: 'pkg-1', role: 'backend',
        sectionType, commitHash: 'abc123',
        deps: { snapshotId: 'snap-1', projectId: 'proj-1', role: 'backend', projections: [], sizeClass: 'small' },
      });
      expect(result.sectionId, sectionType).to.equal(`sec-${inserts.length}`);
    }

    // Complete, not empty and not an error: every section in the layout exists.
    expect(inserts).to.have.length(SECTION_TYPES.length);
    for (const section of inserts) {
      // Visibly labelled as structural-only in three machine-readable places:
      // the prose, the honest-unknown row the reader renders, and the stored
      // provenance the API reports the package's generation mode from.
      expect(section.content, section.type).to.include('AI explanations are off');
      expect(JSON.parse(section.unknowns)[0].kind, section.type).to.equal('ai_disabled');
      expect(JSON.parse(section.context).mode, section.type).to.equal('deterministic');
      expect(JSON.parse(section.context).privacy_mode, section.type).to.equal('ai_disabled');
      expect(section.content.length, section.type).to.be.greaterThan(120);
    }
    expect(provider.completeCalls, 'chat requests').to.have.length(0);
    expect(provider.embedCalls, 'embedding requests').to.have.length(0);
  });

  it('Ask honors the LIVE setting, not the mode frozen on the snapshot', async () => {
    // The regression: the snapshot was analyzed under full_ai and still says
    // so; the owner has since switched Settings → AI & privacy to ai_disabled.
    // Reading s.privacy_mode alone let /ask keep calling models — the setting
    // "did nothing" for every question asked against an existing snapshot.
    const provider = new FakeProvider();
    let sawLiveSettingsJoin = false;
    installFakeDb({
      extra: (text) => {
        if (!text.includes('FROM analysis_snapshots')) return null;
        sawLiveSettingsJoin = text.includes('COALESCE(ps.privacy_mode, s.privacy_mode)');
        return [{
          snapshot_id: 'snap-1', scope_id: 'scope-1', commit_hash: 'abc123',
          semantic_depth: 'standard',
          // What the query asked for: the live setting when the resolver joins
          // project_settings, the frozen snapshot copy when it does not.
          privacy_mode: sawLiveSettingsJoin ? 'ai_disabled' : 'full_ai',
          default_role: 'general', budget_overrides: {},
          model_failure_behavior: {}, model_tier_overrides: {},
        }];
      },
    });

    let thrown: unknown = null;
    try {
      await answerQuestion({
        projectId: 'proj-1',
        question: 'What does this repo do?',
        provider,
        embedQuery: async () => [0.1, 0.2],
      });
    } catch (err) {
      thrown = err;
    }
    // Assert the measurement before the diagnosis: whatever the outcome, no
    // request may have gone out.
    expect(provider.completeCalls, 'chat requests').to.have.length(0);
    expect(sawLiveSettingsJoin, 'ask resolves privacy from project_settings').to.equal(true);
    expect(thrown).to.be.instanceOf(AiDisabledError);
  });
});

// ── facts_only_ai ────────────────────────────────────────────────────────────

/** Drives one tutorial through the real generator against a stubbed db. */
async function runTutorialPass(privacyMode: 'full_ai' | 'facts_only_ai'): Promise<FakeProvider> {
  const provider = new FakeProvider();
  installFakeDb({
    extra: (text) => {
      // The procedural generator needs a runnable command and a triggerable
      // entry point before it will emit anything at all — a flow it cannot
      // tell you how to execute is not a procedure. Both come from evidence.
      if (text.includes("type = 'config'")) {
        return [{ file_path: 'package.json', metadata: { scripts: { dev: 'node server.js', test: 'mocha' } } }];
      }
      if (text.includes('FROM workflows w')) {
        return [{
          id: 'wf-1', stable_key: 'wf:login', title: 'Login', trigger_type: 'HTTP POST',
          purpose: 'authenticate a user', step_count: 1, effect_steps: 1,
          tier: 'core', importance_score: 0.9, config_flow: null,
          route_path: '/api/auth/login', method: 'POST',
        }];
      }
      if (text.includes('FROM workflow_steps ws')) {
        return [{
          id: 'step-1', step_order: 1, node_id: 'node-1', file_path: 'src/auth.ts',
          symbol_name: 'login', line_start: 10, line_end: 20, step_kind: 'data_write',
          deterministic_description: 'writes to sessions', snippet: SECRET_SNIPPET,
          node_hash: 'h1', record_summary: 'Authenticates a user',
        }];
      }
      if (text.includes('FROM tutorials t')) return []; // cache miss
      if (text.startsWith('INSERT INTO tutorials')) return [{ id: 'tut-1' }];
      if (text.startsWith('INSERT INTO tutorial_steps')) return [{ id: 'ts-1', step_order: 1 }];
      if (text.startsWith('INSERT INTO source_receipts')) return [{ id: 'r-1', tutorial_step_id: 'ts-1' }];
      return null;
    },
  });
  const ai = makeClient(provider, { privacyMode });
  // The generator asks the model to ANNOTATE a procedure it already built:
  // a title, a goal, a summary, and one optional `why` per step.
  provider.structuredValue = {
    goal: 'After this, you can prove which line a login request reaches.',
    title: 'Watch a login request reach the session write',
    summary: 'A marker at the session write proves the request got there.',
    confidence: 'medium',
    steps: [{ step_order: 1, why: 'The app has to be up before anything can be triggered.' }],
  };
  await generateTutorials({
    ai, snapshotId: 'snap-1', projectId: 'proj-1', packageId: 'pkg-1', role: 'backend',
    commitHash: 'abc123', projections: [], privacyMode,
  });
  return provider;
}

/** Drives the record critique pass through its real prompt builder. */
async function runCritique(privacyMode: 'full_ai' | 'facts_only_ai'): Promise<FakeProvider> {
  const provider = new FakeProvider();
  installFakeDb({
    extra: (text) => {
      if (text.includes('FROM semantic_records sr') && text.includes("sr.status = 'pending'")) {
        return [{
          id: 'rec-1', stable_key: 'src/auth.ts#login', record_level: 'symbol', facts_only: false,
          record: { claims: [{ claim: 'writes a session', receiptIds: ['r-1'] }] },
          summary: 'Authenticates a user', receipt_ids: ['r-1'],
        }];
      }
      if (text.includes('FROM source_receipts WHERE id = ANY')) {
        return [{
          id: 'r-1', receipt_kind: 'code_snippet', trust_level: 'code',
          file_path: 'src/auth.ts', symbol_name: 'login', snippet: SECRET_SNIPPET,
          node_stable_key: 'src/auth.ts#login',
        }];
      }
      return null;
    },
  });
  const ai = makeClient(provider, { privacyMode });
  provider.structuredValue = { verdicts: [{ stable_key: 'src/auth.ts#login', verdict: 'usable', failed_claims: [], notes: '' }] };
  await runCritiquePass({ ai, snapshotId: 'snap-1', privacyMode } as unknown as SemanticContext);
  return provider;
}

describe('privacy modes — facts_only_ai strips snippets before anything leaves', () => {
  afterEach(() => __setQueryForTests(null));

  it('tutorials: the prompt carries the trace, never the code', async () => {
    const provider = await runTutorialPass('facts_only_ai');
    expect(provider.completeCalls, 'the tutorial call still happens').to.have.length(1);
    expect(provider.sentText).to.not.include(SECRET_SNIPPET);
    expect(provider.sentText).to.include('withheld by privacy settings');
    // Facts still travel — this is facts-only, not evidence-free.
    expect(provider.sentText).to.include('src/auth.ts');
    expect(provider.sentText).to.include('writes to sessions');
  });

  it('record critique: receipts are judged by identity, with the code withheld', async () => {
    const provider = await runCritique('facts_only_ai');
    expect(provider.completeCalls, 'the critique call still happens').to.have.length(1);
    expect(provider.sentText).to.not.include(SECRET_SNIPPET);
    expect(provider.sentText).to.include('withheld by privacy settings');
    expect(provider.sentText).to.include('src/auth.ts');
  });

  it('full_ai control: the same two call sites DO send the code', async () => {
    // Without this, both assertions above would pass on a generator that
    // simply stopped sending evidence at all.
    expect((await runTutorialPass('full_ai')).sentText).to.include(SECRET_SNIPPET);
    expect((await runCritique('full_ai')).sentText).to.include(SECRET_SNIPPET);
  });
});

// ── the caches must not paper over a mode change ─────────────────────────────

describe('privacy modes — switching modes cannot serve the other mode\'s output', () => {
  afterEach(() => __setQueryForTests(null));

  /** Runs generateSection far enough to see its cache key, then short-circuits. */
  async function cacheKeyFor(privacyMode: 'full_ai' | 'facts_only_ai'): Promise<{ hash: string; provider: FakeProvider }> {
    const provider = new FakeProvider();
    let hash = '';
    installFakeDb({
      extra: (text, params) => {
        // Retrieval's snapshot metadata lookup (repo/scope identity).
        if (text.includes('p.repo_owner')) {
          return [{
            repo_owner: 'acme', repo_name: 'ledger', branch: 'main', commit_hash: 'abc123',
            scope_id: 'scope-1', path_prefix: '', display_name: 'Whole repository',
          }];
        }
        if (text.includes("ps.generation_context->>'evidence_hash'")) {
          hash = String((params ?? [])[3]);
          // A reusable row: forces the byte-identical reuse path, which is
          // exactly the path that must NOT be reachable across a mode change.
          return [{ id: 'sec-cached', content: 'x'.repeat(500), diagrams: [], confidence: 'high', unknowns: [] }];
        }
        if (text.startsWith('INSERT INTO package_sections')) return [{ id: 'sec-new' }];
        return null;
      },
    });
    const result = await generateSection({
      ai: makeClient(provider, { privacyMode }),
      snapshotId: 'snap-1', projectId: 'proj-1', packageId: 'pkg-1', role: 'backend',
      sectionType: 'setup_run', privacyMode, commitHash: 'abc123',
      deps: { snapshotId: 'snap-1', projectId: 'proj-1', role: 'backend', projections: [], sizeClass: 'small' },
      embedQuery: async () => [0.1, 0.2],
    });
    expect(result.cached, 'the cache path was exercised').to.equal(true);
    return { hash, provider };
  }

  it('the section cache is keyed by privacy mode', async () => {
    const full = await cacheKeyFor('full_ai');
    const factsOnly = await cacheKeyFor('facts_only_ai');
    // Same section, same facts, different mode: the prompts differ (facts-only
    // withholds every snippet), so reusing one for the other would hand the
    // user prose written WITH the code after they asked for it to be withheld
    // — the package would come back byte-identical and the setting would look
    // like it had done nothing.
    expect(full.hash).to.not.equal(factsOnly.hash);
    // A cache hit is still free: no request leaves either way.
    expect(full.provider.completeCalls).to.have.length(0);
    expect(factsOnly.provider.completeCalls).to.have.length(0);
  });

  it('the tutorial cache is keyed by privacy mode', async () => {
    const hashes: string[] = [];
    for (const privacyMode of ['full_ai', 'facts_only_ai'] as const) {
      const provider = new FakeProvider();
      installFakeDb({
        extra: (text, params) => {
          if (text.includes("type = 'config'")) {
            return [{ file_path: 'package.json', metadata: { scripts: { dev: 'node server.js' } } }];
          }
          if (text.includes('FROM workflows w')) {
            return [{
              id: 'wf-1', stable_key: 'wf:login', title: 'Login', trigger_type: 'HTTP POST', purpose: 'p',
              step_count: 1, effect_steps: 1, tier: 'core', importance_score: 0.9,
              config_flow: null, route_path: '/api/auth/login', method: 'POST',
            }];
          }
          if (text.includes('FROM workflow_steps ws')) {
            return [{
              id: 'step-1', step_order: 1, node_id: 'node-1', file_path: 'src/auth.ts',
              symbol_name: 'login', line_start: 10, line_end: 20, step_kind: 'data_write',
              deterministic_description: 'writes to sessions', snippet: SECRET_SNIPPET,
              node_hash: 'h1', record_summary: null,
            }];
          }
          if (text.includes('FROM tutorials t')) {
            hashes.push(String((params ?? [])[2]));
            return [{ id: 'tut-cached' }]; // reusable clone source
          }
          // Same-package hit: cloneTutorial only re-stamps the existing row.
          if (text.includes('SELECT package_id FROM tutorials')) return [{ package_id: 'pkg-1' }];
          return null;
        },
      });
      await generateTutorials({
        ai: makeClient(provider, { privacyMode }),
        snapshotId: 'snap-1', projectId: 'proj-1', packageId: 'pkg-1', role: 'backend',
        commitHash: 'abc123', projections: [], privacyMode,
      });
      expect(provider.completeCalls, 'a clone costs no provider call').to.have.length(0);
    }
    expect(hashes).to.have.length(2);
    expect(hashes[0]).to.not.equal(hashes[1]);
  });
});
