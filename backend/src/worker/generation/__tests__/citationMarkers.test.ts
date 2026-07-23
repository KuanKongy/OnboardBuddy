import { expect } from 'chai';
import { rewriteInlineCitations, stripLegacyCitationAliases } from '../citationMarkers.js';

const aliasToId = new Map<string, string>([
  ['r1', 'uuid-1'],
  ['r3', 'uuid-3'],
  ['r14', 'uuid-14'],
]);
const used = new Set(['uuid-1', 'uuid-3']);

describe('citationMarkers.rewriteInlineCitations', () => {
  it('rewrites "(receipt rN)" for used receipts into [[receipt:uuid]] markers', () => {
    const r = rewriteInlineCitations(
      'Executes database queries essential for data management (receipt r1).',
      aliasToId,
      used,
    );
    expect(r.content).to.equal(
      'Executes database queries essential for data management [[receipt:uuid-1]].',
    );
    expect(r.resolved).to.deep.equal(['r1']);
    expect(r.dropped).to.deep.equal([]);
  });

  it('drops aliases that map to unused receipts and unknown aliases', () => {
    // r14 exists in the bundle but was not used/persisted; r7 never existed.
    const r = rewriteInlineCitations(
      'Key for settings (receipt r14). Secure access (receipt r7).',
      aliasToId,
      used,
    );
    expect(r.content).to.equal('Key for settings. Secure access.');
    expect(r.dropped).to.have.members(['r14', 'r7']);
  });

  it('handles multi-ref groups, bare parens, brackets, and mixed resolvability', () => {
    const r = rewriteInlineCitations(
      'Writes happen here (Receipts r1, r14). Ranked list [r3]. Impacts users (r4).',
      aliasToId,
      used,
    );
    expect(r.content).to.equal(
      'Writes happen here [[receipt:uuid-1]]. Ranked list [[receipt:uuid-3]]. Impacts users.',
    );
    expect(r.resolved).to.have.members(['r1', 'r3']);
    expect(r.dropped).to.have.members(['r14', 'r4']);
  });

  it('rewrites reference-only bullets and drops unresolvable ones', () => {
    const r = rewriteInlineCitations(
      ['- Dependents: 47', '- Receipt: [r3]', '- Receipt: [r13]', 'Done.'].join('\n'),
      aliasToId,
      used,
    );
    expect(r.content).to.equal(['- Dependents: 47', '- Backed by: [[receipt:uuid-3]]', 'Done.'].join('\n'));
  });

  it('removes trailing "## Claims" / "## Used Receipt IDs" bookkeeping blocks', () => {
    const r = rewriteInlineCitations(
      [
        '## Schema Objects',
        'There are tables.',
        '## Claims',
        '- The schema includes 25 tables (r3).',
        '## Used Receipt IDs',
        '- r3',
      ].join('\n'),
      aliasToId,
      used,
    );
    expect(r.content).to.equal(['## Schema Objects', 'There are tables.'].join('\n'));
  });

  it('resumes normal processing at the next heading after a bookkeeping block', () => {
    const r = rewriteInlineCitations(
      ['## Claims', '- bookkeeping (r1)', '## Real Section', 'Kept (receipt r1).'].join('\n'),
      aliasToId,
      used,
    );
    expect(r.content).to.equal(['## Real Section', 'Kept [[receipt:uuid-1]].'].join('\n'));
  });

  it('leaves non-citation parentheticals and identifiers alone', () => {
    const text =
      'The r2 score (r squared) improves. Radius (r1cm) differs. See section (part 3).';
    const r = rewriteInlineCitations(text, aliasToId, used);
    expect(r.content).to.equal(text);
  });

  it('never rewrites inside fenced code blocks and preserves indentation', () => {
    const text = [
      'Cited (receipt r1).',
      '```ts',
      'const x = fn(r1);   // literal, untouched',
      '    indented(r3);',
      '```',
      '- outer',
      '  - nested list item (receipt r1)',
    ].join('\n');
    const r = rewriteInlineCitations(text, aliasToId, used);
    expect(r.content).to.equal(
      [
        'Cited [[receipt:uuid-1]].',
        '```ts',
        'const x = fn(r1);   // literal, untouched',
        '    indented(r3);',
        '```',
        '- outer',
        '  - nested list item [[receipt:uuid-1]]',
      ].join('\n'),
    );
  });
});

describe('citationMarkers.stripLegacyCitationAliases', () => {
  it('strips every alias form from pre-marker content', () => {
    const legacy = [
      'This file manages onboarding (receipt r6).',
      'Settings unlock the environment (receipt r14).',
      'High fan-in module (Receipt: [r3]).',
      '- Receipt: [r13]',
      '## Used Receipt IDs',
      '- r3',
    ].join('\n');
    const r = stripLegacyCitationAliases(legacy);
    expect(r.content).to.equal(
      [
        'This file manages onboarding.',
        'Settings unlock the environment.',
        'High fan-in module.',
      ].join('\n'),
    );
    expect(r.resolved).to.deep.equal([]);
    // The "- r3" inside the bookkeeping block is deleted with the block,
    // so it never registers as a dropped alias.
    expect(r.dropped).to.have.members(['r6', 'r14', 'r3', 'r13']);
  });
});
