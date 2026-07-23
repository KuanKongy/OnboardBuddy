import { expect } from 'chai';
import { lintVoice } from '../voiceLint.js';

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

  it('does not flag legitimate technical uses of enhance without user context', () => {
    const r = lintVoice('The index enhances query performance by 3x according to the benchmark output.');
    expect(r.hits).to.deep.equal([]);
  });
});
