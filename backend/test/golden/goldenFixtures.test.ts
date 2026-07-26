/**
 * Guards the fixture set itself. `explanation-diff.ts` needs the network and
 * (for prose) the database, so it cannot run in `npm test` — but a fixture
 * with a typo'd field silently stops asserting anything, which is the worst
 * failure mode a gate can have. These checks are pure JSON and run everywhere.
 *
 * The interesting one is the last: the five fixtures must actually be five
 * DIFFERENT shapes. A generalization harness whose repos all look alike proves
 * nothing, and that is the exact criticism it exists to answer.
 */

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GOLDEN_DIR = path.resolve(import.meta.dirname);

interface Fixture {
  repo: string;
  clone: string;
  shape: string;
  whyThisShape: string;
  labeledOn: string;
  labeledFrom: string;
  expectShape: Record<string, unknown>;
  domainNouns: string[];
  mustDisclose?: string[];
  budgets: Record<string, number>;
  knownGaps?: string[];
  proseUnavailable?: string;
}

const files = fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'));
const fixtures = files.map((f) => ({
  slug: path.basename(f, '.json'),
  fx: JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, f), 'utf8')) as Fixture,
}));

const REQUIRED_BUDGETS = [
  'minDomainNounsInPackage',
  'minCitedShare',
  'maxNarrationErrors',
  'maxLevelErrors',
  'minSectionsDisclosingGaps',
];

describe('golden explanation fixtures', () => {
  it('covers at least the five repo shapes the harness promises', () => {
    expect(fixtures.length, `found: ${files.join(', ')}`).to.be.at.least(5);
  });

  for (const { slug, fx } of fixtures) {
    describe(slug, () => {
      it('declares who it is and where the labels came from', () => {
        for (const field of ['repo', 'clone', 'shape', 'whyThisShape', 'labeledOn', 'labeledFrom'] as const) {
          expect(fx[field], field).to.be.a('string').and.have.length.greaterThan(0);
        }
        expect(fx.repo).to.match(/^[\w.-]+\/[\w.-]+$/, 'repo must be owner/name so it can be joined to projects.repo_full_name');
      });

      it('carries enough domain vocabulary to judge genericness', () => {
        expect(fx.domainNouns).to.be.an('array').with.length.greaterThan(2);
        for (const n of fx.domainNouns) expect(n, `${slug}: "${n}"`).to.match(/^[a-z][a-z0-9-]{2,}$/);
        expect(new Set(fx.domainNouns).size, 'duplicate domain nouns').to.equal(fx.domainNouns.length);
      });

      it('sets every budget the runner reads, with a satisfiable citation share', () => {
        for (const key of REQUIRED_BUDGETS) {
          expect(fx.budgets, key).to.have.property(key).that.is.a('number');
        }
        expect(fx.budgets.minCitedShare).to.be.within(0, 1);
        expect(fx.budgets.minDomainNounsInPackage).to.be.at.most(fx.domainNouns.length);
      });

      it('explains itself when it cannot be scored on prose', () => {
        // A fixture the product cannot analyse is fine; a fixture that skips
        // without saying why is a silent pass.
        if (fx.proseUnavailable !== undefined) {
          expect(fx.proseUnavailable).to.have.length.greaterThan(40);
        }
      });
    });
  }

  it('the fixtures are genuinely different shapes, not five of the same repo', () => {
    // Every fixture must differ from every other on its declared entrypoint
    // profile — that is the whole premise of the set.
    const profile = (fx: Fixture) => JSON.stringify(fx.expectShape);
    const profiles = fixtures.map(({ fx }) => profile(fx));
    expect(new Set(profiles).size, `duplicate shape profiles:\n${profiles.join('\n')}`).to.equal(profiles.length);
  });

  it('at least one fixture is an honest-coverage case with unreadable source', () => {
    // Without this the set can never catch "the package implies the repo has
    // no backend", which is the failure FloowForge exists to expose.
    const withUnparsed = fixtures.filter(
      ({ fx }) => Array.isArray((fx.expectShape as { unparsedLanguages?: string[] }).unparsedLanguages),
    );
    expect(withUnparsed.map((f) => f.slug)).to.have.length.greaterThan(0);
    for (const { fx } of withUnparsed) {
      expect(fx.mustDisclose, 'a repo with unreadable source must require disclosure').to.be.an('array').with.length.greaterThan(0);
    }
  });

  it('at least one fixture has few or no detectable entrypoints', () => {
    const sparse = fixtures.filter(({ fx }) => (fx.expectShape as { maxEntrypoints?: number }).maxEntrypoints !== undefined);
    expect(sparse.map((f) => f.slug), 'no library-shaped fixture').to.have.length.greaterThan(0);
  });
});
