import { expect } from 'chai';
import { lintVoice } from '../voiceLint.js';
import { narrationIsFiller } from '../tutorialProcedure.js';

describe('voiceLint', () => {
  it('flags the audited slop register', () => {
    const r = lintVoice(
      'This crucial module is essential for seamless integration, ' +
        'enhancing user engagement and avoiding a poor first impression.',
    );
    expect(r.issues).to.have.length(1);
    expect(r.hits).to.include.members(['crucial', 'essential', 'seamless', 'first-impression speculation']);
  });

  it('passes flat engineering prose', () => {
    const r = lintVoice(
      '`db.ts#query` executes SQL against the pool. 47 files import it; ' +
        'a signature change breaks all of them. Failure handling is not visible in the trace.',
    );
    expect(r.issues).to.deep.equal([]);
    expect(r.hits).to.deep.equal([]);
  });

  it('ignores banned words inside code fences', () => {
    const r = lintVoice(['```ts', 'const essential = "crucial";', '```', 'The function returns 3.'].join('\n'));
    expect(r.hits).to.deep.equal([]);
  });

  it('flags an em dash, except inside a code fence', () => {
    const r = lintVoice('The worker retries once — then gives up.');
    expect(r.hits).to.deep.equal(['em dash (write a comma, colon, or a new sentence)']);
    // Repo content quoted in a fence is not prose the model wrote.
    expect(lintVoice(['```ts', 'const s = "a — b";', '```', 'It returns 3.'].join('\n')).hits).to.deep.equal([]);
  });

  it('does not flag legitimate technical uses of enhance without user context', () => {
    const r = lintVoice('The index enhances query performance by 3x according to the benchmark output.');
    expect(r.hits).to.deep.equal([]);
  });
});

/**
 * The walkthrough narration gate. It is not part of `lintVoice` because it runs
 * where the model's prose is ACCEPTED, not where a finished draft is checked:
 * filler is swapped back out for the deterministic template, so by lint time
 * there is nothing left to find.
 */
describe('narrationIsFiller', () => {
  it('rejects the openers that describe the step instead of the code', () => {
    // Verbatim off a live walkthrough step, both sentences.
    expect(narrationIsFiller(
      'This step involves interacting with the database table named `analysis_jobs`. '
      + 'This interaction is a database read operation as part of the overall job resumption process.',
    )).to.equal(true);
    expect(narrationIsFiller('This code loads the row and returns it.')).to.equal(true);
    expect(narrationIsFiller('This function is responsible for validating the token.')).to.equal(true);
    // Anywhere in the narration, not only at the front: true of every step in
    // every flow, so it is evidence of nothing.
    expect(narrationIsFiller('Reads the row as part of the overall resumption process.')).to.equal(true);
  });

  it('keeps narration that opens on the action', () => {
    // Over-rejecting costs a real sentence and silently downgrades the card to
    // the template, so the patterns must stay narrow.
    expect(narrationIsFiller('Reads the queued job row from `analysis_jobs` and rejects it when the snapshot is gone.')).to.equal(false);
    expect(narrationIsFiller('This handler reads the job row, then hands the snapshot id to `resumeAnalysis`.')).to.equal(false);
    expect(narrationIsFiller('Part of the row is cached here so the retry does not re-read it.')).to.equal(false);
  });
});
