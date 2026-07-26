import { expect } from 'chai';
import { repairExplanation } from '../../src/worker/generation/sectionGenerator.js';

/**
 * Two contract breaches survived the model retry on real FloowForge output:
 * `capabilities` leaked `wf:`/`cluster:` join keys the prompt explicitly bans,
 * and no ORIENT section mentioned that 49 of the repo's 167 files are Python
 * nobody parsed. Asking a second time is the wrong mechanism for either — one
 * is a string a reader must never see, the other a fact we hold with certainty.
 */
describe('deterministic explanation repair', () => {
  describe('leaked internal keys', () => {
    it('reduces a workflow key to the symbol it names', () => {
      const { markdown, repairs } = repairExplanation(
        'The flow wf:web/app/p/[token]/page.tsx:PublicFormPage renders the form.',
        {},
      );
      expect(markdown).to.contain('PublicFormPage');
      expect(markdown).to.not.contain('wf:');
      expect(repairs).to.contain('internal_key_leak');
    });

    it('strips the cluster prefix but keeps the path a reader can act on', () => {
      const { markdown } = repairExplanation('Defined in cluster:web/modules today.', {});
      expect(markdown).to.contain('web/modules');
      expect(markdown).to.not.contain('cluster:');
    });

    it('leaves clean prose byte-identical', () => {
      const clean = 'The worker turns an analyzed snapshot into twelve sections.';
      const { markdown, repairs } = repairExplanation(clean, {});
      expect(markdown).to.equal(clean);
      expect(repairs).to.deep.equal([]);
    });
  });

  describe('undisclosed unread stacks', () => {
    it('appends the disclosure when the prose omits the language', () => {
      const { markdown, repairs } = repairExplanation(
        'FloowForge lets users define and run automated workflows.',
        { mustDisclose: ['python'] },
      );
      expect(markdown).to.match(/\bpython\b/i);
      expect(markdown).to.contain('Not covered here');
      expect(repairs).to.contain('undisclosed_gap');
    });

    it('adds nothing when the model already disclosed it', () => {
      // The repair must not duplicate a disclosure the prose already makes —
      // it is a floor, not a second voice.
      const compliant = 'The backend is written in Python and was not parsed by this analysis.';
      const { markdown, repairs } = repairExplanation(compliant, { mustDisclose: ['python'] });
      expect(markdown).to.equal(compliant);
      expect(repairs).to.not.contain('undisclosed_gap');
    });

    it('names every undisclosed language, not just the first', () => {
      const { markdown } = repairExplanation('A web app.', { mustDisclose: ['python', 'go'] });
      expect(markdown).to.match(/\bpython\b/i);
      expect(markdown).to.match(/\bgo\b/i);
    });

    it('does nothing when there is no unread stack to disclose', () => {
      const text = 'A TypeScript monorepo.';
      expect(repairExplanation(text, { mustDisclose: [] }).markdown).to.equal(text);
    });
  });

  it('never rewrites a claim — only identifiers and the appended gap', () => {
    // The repair is deliberately narrow: editing a claim would be inventing
    // prose the model did not write, which is the failure mode this whole
    // rework exists to remove.
    const claim = 'Sign-in writes a session row and returns a JWT. [1]';
    const { markdown } = repairExplanation(claim, {});
    expect(markdown).to.equal(claim);
  });
});
