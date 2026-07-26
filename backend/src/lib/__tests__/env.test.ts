import { expect } from 'chai';
import { envInt } from '../env.js';

describe('envInt', () => {
  it('parses positive integers and falls back on unset/blank/garbage/non-positive', () => {
    const cases: Array<[string | undefined, number]> = [
      [undefined, 4],  // unset -> documented default
      ['', 4],         // blank (an empty compose/env line) -> default
      ['  ', 4],
      ['8', 8],        // the knob the owner actually turns
      [' 8 ', 8],
      ['four', 4],     // NaN would make BullMQ throw at construction
      ['0', 4],
      ['-2', 4],
      ['2.5', 4],
    ];
    const actual = cases.map(([raw]) => {
      if (raw === undefined) delete process.env.OB_TEST_CONCURRENCY;
      else process.env.OB_TEST_CONCURRENCY = raw;
      return envInt('OB_TEST_CONCURRENCY', 4);
    });
    delete process.env.OB_TEST_CONCURRENCY;
    expect(actual).to.deep.equal(cases.map(([, expected]) => expected));
  });
});
