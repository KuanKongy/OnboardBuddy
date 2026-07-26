/**
 * The two narration-layer misses from the golden checklist
 * (doc/ONBOARDING_QUALITY_LATENCY_PLAN.md step 6, 17/19):
 *
 *   - `concepts` named 9 solid terms but skipped "snapshot" and "receipt";
 *   - `architecture_deep` described structure with no decision→consequence
 *     language.
 *
 * Both were diagnosed as extraction-layer-clean: the data was already right, the
 * prose under-used it. So these tests check the two things that follow from that
 * diagnosis — that the ranking picks the right nouns out of real schema shape,
 * and that the gates fail on structure-only prose and pass on prose that says
 * why. The schema fixture below is this repo's own table graph, which is the
 * case the misses were found on.
 */

import { expect } from 'chai';
import { SECTION_SPECS, mustDefineStems } from '../sectionSpecs.js';
import { extractDecisionNotes } from '../decisionComments.js';

// ── concepts: must-define stems ─────────────────────────────────────────────

/**
 * A trimmed version of OnboardBuddy's own schema graph: `refs` is the tables a
 * table points AT, which is what the schema parser records.
 */
const OWN_SCHEMA = [
  { name: 'projects', refs: ['users'] },
  { name: 'analysis_snapshots', refs: ['projects', 'analysis_scopes'] },
  { name: 'analysis_scopes', refs: ['projects'] },
  { name: 'analysis_jobs', refs: ['projects', 'analysis_snapshots', 'analysis_scopes', 'users'] },
  { name: 'graph_nodes', refs: ['analysis_snapshots'] },
  { name: 'graph_edges', refs: ['analysis_snapshots', 'graph_nodes'] },
  { name: 'workflows', refs: ['analysis_snapshots', 'entrypoints'] },
  { name: 'workflow_steps', refs: ['workflows', 'graph_nodes'] },
  { name: 'entrypoints', refs: ['analysis_snapshots', 'graph_nodes'] },
  { name: 'semantic_records', refs: ['projects'] },
  { name: 'onboarding_packages', refs: ['analysis_snapshots', 'projects'] },
  { name: 'package_sections', refs: ['onboarding_packages', 'analysis_snapshots'] },
  { name: 'tutorials', refs: ['analysis_snapshots', 'onboarding_packages', 'workflows'] },
  { name: 'tutorial_steps', refs: ['tutorials', 'graph_nodes'] },
  // The table the old in-degree-only ranking missed: it points at seven things
  // and almost nothing points back at it.
  { name: 'source_receipts', refs: ['projects', 'analysis_snapshots', 'package_sections', 'graph_nodes', 'workflows', 'tutorial_steps', 'semantic_records'] },
  { name: 'capabilities', refs: ['analysis_snapshots', 'semantic_records'] },
  { name: 'capability_members', refs: ['capabilities'] },
];

describe('concepts — must-define stems (the "skips snapshot/receipt" miss)', () => {
  const stems = mustDefineStems(OWN_SCHEMA);

  it('includes BOTH of the terms the checklist found missing', () => {
    expect(stems, `got: ${stems.join(', ')}`).to.include('snapshot');
    expect(stems, `got: ${stems.join(', ')}`).to.include('receipt');
  });

  it('ranks snapshot first — half the schema hangs off it', () => {
    expect(stems[0]).to.equal('snapshot');
  });

  it('would have missed "receipt" on referenced-BY degree alone', () => {
    // Documents WHY out-degree is counted: nothing in the schema points at
    // source_receipts, so an in-degree-only ranking cannot see it, which is
    // exactly the bug the first attempt at this fix had.
    const inDegreeOnly = new Map<string, number>();
    for (const t of OWN_SCHEMA) for (const r of t.refs) inDegreeOnly.set(r, (inDegreeOnly.get(r) ?? 0) + 1);
    expect(inDegreeOnly.get('source_receipts') ?? 0).to.equal(0);
    expect(stems).to.include('receipt');
  });

  it('strips the pipeline prefixes and plural so the stem is the word prose uses', () => {
    expect(mustDefineStems([
      { name: 'analysis_snapshots', refs: ['projects'] },
      { name: 'projects', refs: ['analysis_snapshots'] },
    ])).to.have.members(['snapshot', 'project']);
  });

  it('drops stems too short to be a meaningful coverage signal', () => {
    const short = mustDefineStems([{ name: 'ids', refs: ['runs'] }, { name: 'runs', refs: ['ids'] }]);
    expect(short).to.deep.equal([]);
  });

  it('returns nothing for a schema with no relationships rather than guessing', () => {
    expect(mustDefineStems([{ name: 'lonely_table', refs: [] }])).to.deep.equal([]);
    expect(mustDefineStems([])).to.deep.equal([]);
  });

  it('the coverage gate complains with the exact terms the prompt was told to start from', () => {
    const spec = SECTION_SPECS.concepts;
    const det = { mustDefineTerms: ['snapshot', 'receipt', 'package', 'workflow'] };
    // Structure-only vocabulary: names four terms, none of them the core nouns.
    const offTarget = ['### alpha', 'a', '### beta', 'b', '### gamma', 'c', '### delta', 'd',
      '### eps', 'e', '### zeta', 'f', '### eta', 'g', '### theta', 'h'].join('\n');
    const issues = spec.completenessCheck!(offTarget, det);
    expect(issues.join(' ')).to.include('snapshot');
    expect(issues.join(' ')).to.include('receipt');
  });

  it('the gate passes once the core nouns are defined', () => {
    const spec = SECTION_SPECS.concepts;
    const det = { mustDefineTerms: ['snapshot', 'receipt', 'package', 'workflow'] };
    const good = [
      '### snapshot', 'One analysis run over one commit.',
      '### receipt', 'A file+line pointer backing a claim.',
      '### package', 'The generated onboarding set.',
      '### workflow', 'A traced entrypoint-to-effect path.',
      '### scope', 's', '### cluster', 'c', '### record', 'r', '### capability', 'c',
    ].join('\n');
    expect(spec.completenessCheck!(good, det)).to.deep.equal([]);
  });
});

// ── architecture_deep: decision→consequence ─────────────────────────────────

describe('decision-comment extraction (the "no decision→consequence" miss)', () => {
  it('finds a wrapped rationale paragraph and joins its lines', () => {
    // This is a real comment from this repo's docker-compose.yml.
    const snippet = [
      'services:',
      '  # DATABASE_URL is the transaction-mode pooler: clients multiplex, so',
      '  # each process sizes its pool for its own fan-out',
      '  # (doc/DEVOPS.md "Connection pooling").',
      '  backend-api:',
    ].join('\n');
    const notes = extractDecisionNotes(snippet);
    expect(notes).to.have.length(1);
    expect(notes[0]!.text).to.include('transaction-mode pooler');
    expect(notes[0]!.text).to.include('each process sizes its pool');
    expect(notes[0]!.lineOffset).to.equal(1, 'points at the first comment line, not the file top');
  });

  it('ignores comments that describe WHAT rather than WHY', () => {
    const snippet = [
      '// Returns the user id.',
      'function id() {}',
      '// TODO: rename this',
      '// eslint-disable-next-line',
    ].join('\n');
    expect(extractDecisionNotes(snippet)).to.deep.equal([]);
  });

  it('recognises rationale across comment syntaxes', () => {
    for (const line of [
      '// Kept as one statement because a per-row loop cost 40 round trips.',
      '# Queue suffix is per-developer so that a stale worker cannot eat this run.',
      '-- Cascade here instead of a trigger: the FK order is already enforced.',
      ' * Content-addressed by design ⇒ an unchanged file never re-runs the model.',
    ]) {
      expect(extractDecisionNotes(line), line).to.have.length(1);
    }
  });

  it('splits distinct paragraphs of a block comment into separate notes', () => {
    const snippet = [
      '/**',
      ' * Cached because regenerating costs a full model call.',
      ' *',
      ' * Not snapshot-scoped, so an unrelated commit still reuses the row.',
      ' */',
    ].join('\n');
    expect(extractDecisionNotes(snippet)).to.have.length(2);
  });

  it('ranks a note carrying more distinct reasoning markers higher', () => {
    const rich = extractDecisionNotes('// Chosen deliberately because the alternative would break resume.')[0]!;
    const thin = extractDecisionNotes('// Kept because it is simpler than the alternative approach here.')[0]!;
    expect(rich.markerCount).to.be.greaterThan(thin.markerCount);
  });

  it('counts a repeated marker once — one idea stated twice is not two reasons', () => {
    const note = extractDecisionNotes('// Because of the pooler, and because of the queue, we split them here.')[0]!;
    expect(note.markerCount).to.equal(1);
  });

  it('caps a runaway comment instead of carrying it whole into a receipt', () => {
    const long = `// because ${'x'.repeat(2000)}`;
    expect(extractDecisionNotes(long)[0]!.text.length).to.be.at.most(320);
  });

  it('handles empty and comment-free input', () => {
    expect(extractDecisionNotes(null)).to.deep.equal([]);
    expect(extractDecisionNotes('')).to.deep.equal([]);
    expect(extractDecisionNotes('const x = 1;\nconst y = 2;')).to.deep.equal([]);
  });
});

describe('architecture_deep — the gate that forces decision→consequence prose', () => {
  const spec = SECTION_SPECS.architecture_deep;
  const det = {
    // `clusters` is now the BOUNDED list the prompt was handed, so the gate can
    // only ever demand what was asked for. It used to be every cluster in the
    // snapshot with the check re-filtering by file count, which is how a
    // 9-component repo got told to cover nine and wrote past its output budget.
    clusters: [
      { label: 'API Routes' },
      { label: 'Worker Pipeline' },
    ],
    otherClusters: ['Tiny Helper'],
    decisionNotes: [
      { where: 'docker-compose.yml:9', rationale: 'transaction-mode pooler; clients multiplex' },
      { where: 'lib/queue.ts:20', rationale: 'queue suffix per developer so a stale worker cannot eat this run' },
      { where: 'worker/index.ts:80', rationale: 'content-addressed records because an unchanged file must not re-run the model' },
    ],
  };

  const structureOnly = [
    '## How a request flows',
    'A request enters API Routes and is handed to Worker Pipeline.',
    '## API Routes',
    'Holds 12 files. Receives HTTP requests and enqueues jobs.',
    '## Worker Pipeline',
    'Holds 30 files. Consumes jobs and writes results.',
    '## Tensions to know about',
    'The queue module has the highest fan-in.',
  ].join('\n');

  it('fails on prose that describes structure without saying why — the exact miss', () => {
    const issues = spec.completenessCheck!(structureOnly, det);
    expect(issues.join(' ')).to.include('decision→consequence');
    expect(issues.join(' ')).to.include('0 of 3');
  });

  /** The same prose, now citing — which is the section's other half. */
  const cited = (markdown: string): string =>
    markdown
      .replace('## API Routes\n', '## API Routes\n')
      .replace('enqueues jobs.', 'enqueues jobs (r3).')
      .replace('writes results.', 'writes results (r7).');

  it('passes once decisions are stated in the required form', () => {
    const withDecisions = structureOnly.replace(
      'Holds 12 files. Receives HTTP requests and enqueues jobs.',
      'Holds 12 files. Transaction-mode pooler ⇒ no session state ⇒ every lock is a row lock (r3).',
    ).replace(
      'Holds 30 files. Consumes jobs and writes results.',
      [
        'Holds 30 files. Per-developer queue suffix ⇒ a stale worker cannot consume this run\'s jobs (r7).',
        'Content-addressed records ⇒ an unchanged file never re-runs the model.',
      ].join(' '),
    );
    expect(spec.completenessCheck!(withDecisions, det)).to.deep.equal([]);
  });

  // Measured on the stored corpus before this gate existed: SEVEN of eleven
  // architecture_deep sections shipped with no receipt marker, no `rN` alias
  // and no file:line anywhere in 3,000-4,900 characters — and every one passed
  // this check, because it counted headings and arrows and nothing else.
  it('fails a section that cites nothing at all — the citation desert', () => {
    const issues = spec.completenessCheck!(structureOnly, det);
    expect(issues.join(' ')).to.include('cites NOTHING');
  });

  it('fails when the decisions cite but the component subsections do not', () => {
    const decisionsOnly = structureOnly.replace(
      'Holds 12 files. Receives HTTP requests and enqueues jobs.',
      'Holds 12 files. Transaction-mode pooler ⇒ no session state ⇒ every lock is a row lock (r3).',
    );
    const issues = spec.completenessCheck!(decisionsOnly, det);
    // The desert complaint is gone — one citation exists — but the component
    // the reader cannot open a file of is named.
    expect(issues.join(' ')).to.not.include('cites NOTHING');
    expect(issues.join(' ')).to.include('Worker Pipeline');
    expect(issues.join(' ')).to.include('cite nothing');
  });

  it('accepts a bare file:line locator as a citation, and the post-rewrite marker form', () => {
    // Cached rows are re-judged against today's rules, and by then the aliases
    // are already `[[receipt:uuid]]` markers — a check that knew only `(rN)`
    // would reject every cached section and regenerate the package on hash luck.
    const locators = structureOnly
      .replace('enqueues jobs.', 'enqueues jobs — see src/api/routes/projects.ts:41.')
      .replace('writes results.', 'writes results [[receipt:3f2a1b4c-1234-4abc-9def-0123456789ab]].');
    const issues = spec.completenessCheck!(locators, { ...det, decisionNotes: [] });
    expect(issues.join(' ')).to.not.include('cites NOTHING');
    expect(issues.join(' ')).to.not.include('cite nothing');
  });

  it('never complains about citations in a subsection too short to carry a claim', () => {
    // "<label> — purpose not established from the code" is a ONE-LINE answer
    // the prompt explicitly asks for; gating it on a receipt would force the
    // model to invent one for the component it just admitted it cannot explain.
    const oneLiner = cited(structureOnly).replace(
      'Holds 30 files. Consumes jobs and writes results (r7).',
      'Worker Pipeline — purpose not established from the code.',
    );
    expect(spec.completenessCheck!(oneLiner, { ...det, decisionNotes: [] }).join(' ')).to.not.include('cite nothing');
  });

  it('does not demand decisions when no rationale was extracted — never invent one', () => {
    // The spec's own rule is "inventing them is not" correct, so a repo whose
    // comments say nothing must not be gated into making things up.
    const issues = spec.completenessCheck!(structureOnly, { ...det, decisionNotes: [] });
    expect(issues.join(' ')).to.not.include('decision→consequence');
  });

  it('scales the requirement to how much rationale actually exists', () => {
    const twoNotes = { ...det, decisionNotes: det.decisionNotes.slice(0, 2) };
    const oneStatement = structureOnly.replace('Holds 12 files.', 'Pooler in transaction mode ⇒ no session state.');
    expect(spec.completenessCheck!(oneStatement, twoNotes).join(' ')).to.include('1 of 2');
  });

  it('still requires cluster coverage and the closing tensions section', () => {
    // replaceAll, not replace: the cluster is also named in the opening flow
    // sentence, and coverage is "is this cluster mentioned at all".
    const missingCluster = structureOnly.replaceAll('Worker Pipeline', 'Something Else');
    expect(spec.completenessCheck!(missingCluster, det).join(' ')).to.include('Worker Pipeline');
    const noTensions = structureOnly.replace('## Tensions to know about', '## Notes');
    expect(spec.completenessCheck!(noTensions, det).join(' ')).to.include('Tensions');
  });

  it('does not require a subsection for a cluster the prompt was told to leave out', () => {
    // "Tiny Helper" is in `otherClusters`, not `clusters` — the section names it
    // in one line and gives it no subsection, so the gate must not ask for one.
    expect(spec.completenessCheck!(structureOnly, det).join(' ')).to.not.include('Tiny Helper');
  });
});
