import { expect } from 'chai';
import {
  buildClusterNarrative,
  type ClusterBoundaryLink,
  type ClusterNarrativeFacts,
} from '../../src/worker/engine/architectureClusterer';

/**
 * The boundary paragraph is the only prose on an architecture card that is
 * generated at BOTH analysis time (`deterministic_summary`) and request time
 * (`loadClusterNarratives`). Nothing downstream compares the two, so a change
 * that makes them disagree — or one that quietly drops a partner — fails
 * silently and ships. These cover the shape, not the wording.
 */

const link = (other: string, type: ClusterBoundaryLink['type'], carries: string[] = []): ClusterBoundaryLink =>
  ({ other, type, carries });

const facts = (over: Partial<ClusterNarrativeFacts> = {}): ClusterNarrativeFacts => ({
  label: 'Backend · Workers',
  kind: 'worker_layer',
  commonPath: 'backend/src/worker',
  tables: [],
  exclusiveExternals: [],
  inbound: [],
  outbound: [],
  ...over,
});

describe('buildClusterNarrative — boundary paragraph', () => {
  it('splits the boundary by direction and verb, and drops the shared area from partner names', () => {
    // The real `Backend · Workers` boundary off the dogfood snapshot.
    const n = buildClusterNarrative(facts({
      outbound: [
        link('Database Schema', 'reads_writes_data'),
        link('Backend · Shared Utilities', 'calls'),
        link('Backend · Modules', 'imports'),
        link('Backend · Modules', 'calls'),
      ],
      inbound: [
        link('Backend · Tests', 'tests'),
        link('Backend · Modules', 'calls'),
        link('Backend · Configuration & Deployment', 'calls'),
        link('Backend · API Routes', 'calls', ['POST /api/projects/:id/ask']),
      ],
    }));

    expect(n.boundary).to.contain('It reads and writes Database Schema. It calls into Shared Utilities and Modules.');
    // Strongest verb first, and a partner that both imports and calls is named
    // once — under `calls`, not in two clauses saying the same thing.
    expect(n.boundary).to.contain('Modules, Configuration & Deployment and API Routes call into it.');
    // …but the clause that would read "Tests tests it" keeps its area rather
    // than doubling the word.
    expect(n.boundary).to.contain('Backend · Tests tests it.');
    // A partner in another area keeps its area: that is the fact about it.
    expect(n.boundary).to.contain('Database Schema');
  });

  it('names two crossing flows without their journey suffixes and counts the rest', () => {
    const n = buildClusterNarrative(facts({
      inbound: [
        link('Backend · API Routes', 'calls', [
          'POST /api/projects/:id/ask',
          'POST /api/projects/:id/analysis-jobs/:jobId/resume → what it reads from onboarding_packages',
          'Queue consumer: ANALYSIS_QUEUE',
        ]),
      ],
    }));

    expect(n.boundary).to.contain(
      'Flows that cross this boundary include POST /api/projects/:id/ask, '
      + 'POST /api/projects/:id/analysis-jobs/:jobId/resume and 1 other.',
    );
    // The terminus belongs on the flow's own card; here it swallows the "and".
    expect(n.boundary).to.not.contain('→');
  });

  it('keeps both areas when shortening would print two components under one name', () => {
    // A root-scope `Modules` cluster alongside `Backend · Modules` is rare and
    // legal. Collapsing the second onto the first would be a wrong fact, not a
    // shorter sentence, so the shortening turns itself off.
    const n = buildClusterNarrative(facts({
      outbound: [link('Backend · Modules', 'calls'), link('Modules', 'calls')],
    }));

    expect(n.boundary).to.contain('It calls into Backend · Modules and Modules.');
  });

  it('says one flow crosses in the singular, and records a missing crossing as an unknown', () => {
    const one = buildClusterNarrative(facts({
      outbound: [link('Database Schema', 'reads_writes_data', ['POST /api/projects/:id/ask'])],
    }));
    expect(one.boundary).to.contain('One traced flow crosses this boundary: POST /api/projects/:id/ask.');

    const none = buildClusterNarrative(facts({ outbound: [link('Backend · Shared Utilities', 'imports')] }));
    expect(none.boundary).to.contain('No traced flow crosses that boundary');
    expect(none.unknowns.join(' ')).to.contain('what actually travels between these components');
  });
});
