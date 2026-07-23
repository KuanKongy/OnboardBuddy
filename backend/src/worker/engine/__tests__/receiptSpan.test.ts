import { expect } from 'chai';
import { capReceiptSpan, MAX_RECEIPT_SPAN_LINES } from '../receiptSpan.js';

describe('receiptSpan.capReceiptSpan', () => {
  it('caps long spans to the first 40 lines and keeps the original extent', () => {
    const snippet = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join('\n');
    const capped = capReceiptSpan({ lineStart: 69, lineEnd: 627, snippet });
    expect(capped.lineEnd).to.equal(69 + MAX_RECEIPT_SPAN_LINES - 1);
    expect(capped.truncatedFromLineEnd).to.equal(627);
    expect(capped.snippet!.split('\n')).to.have.length(MAX_RECEIPT_SPAN_LINES);
    expect(capped.snippet!.split('\n')[0]).to.equal('line 1');
  });

  it('leaves short spans and their snippets untouched', () => {
    const r = { lineStart: 23, lineEnd: 26, snippet: 'a\nb\nc\nd' };
    expect(capReceiptSpan(r)).to.deep.equal(r);
  });

  it('is a no-op without line numbers', () => {
    const r = { lineStart: null, lineEnd: null, snippet: 'x' };
    expect(capReceiptSpan(r)).to.deep.equal(r);
  });

  it('preserves an existing truncation marker instead of overwriting it', () => {
    const capped = capReceiptSpan({
      lineStart: 1,
      lineEnd: 100,
      snippet: 'x',
      truncatedFromLineEnd: 900,
    });
    expect(capped.truncatedFromLineEnd).to.equal(900);
    expect(capped.lineEnd).to.equal(MAX_RECEIPT_SPAN_LINES);
  });

  it('exactly-at-cap spans pass through', () => {
    const r = { lineStart: 1, lineEnd: MAX_RECEIPT_SPAN_LINES, snippet: 'x' };
    expect(capReceiptSpan(r)).to.deep.equal(r);
  });
});
