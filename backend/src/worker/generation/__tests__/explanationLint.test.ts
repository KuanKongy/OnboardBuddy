/**
 * Tests for the explanation contract.
 *
 * Two thirds of these are false-positive tests. That is deliberate: a
 * narration detector that fires on good prose is worse than none, because
 * every wrong finding buys a model call to rewrite text that was already
 * correct. So for every "does it catch X" test there is a "does it leave the
 * legitimate near-miss of X alone" test.
 *
 * The failing fixtures are REAL sentences from `package_sections` (Skribbl
 * package, snapshot 6da73e74) — quoted verbatim, not invented. Where a
 * sentence is quoted it is marked OBSERVED.
 */

import { expect } from 'chai';
import { lintExplanation, splitSentences, type ExplanationFinding } from '../explanationLint.js';

const codes = (findings: ExplanationFinding[]): string[] => findings.map((f) => f.code);
const has = (findings: ExplanationFinding[], code: string): boolean => codes(findings).includes(code);
const of_ = (findings: ExplanationFinding[], code: string): ExplanationFinding[] =>
  findings.filter((f) => f.code === code);

/**
 * A genuinely good explanation of a real subsystem: right altitude, every
 * paragraph cited, a named gap, no narration. Nothing in this text may ever
 * produce a finding — it is the regression guard for the whole module.
 */
const GOOD_EXPLANATION = [
  '## Room lifecycle',
  '',
  'A room is created when a client emits `create-room`; `server/src/roomManager.js:31` allocates the',
  'GameRoom and returns its six-character code. The code is the only handle a player ever sends back,',
  'so a lost code is an unrecoverable room. [[receipt:11111111-1111-1111-1111-111111111111]]',
  '',
  'Every drawing operation is rate-limited before it reaches the canvas: `sanitizeDrawOps` in',
  '`server/src/validate.js:74` drops batches above the per-second budget, which is why a fast',
  'stylus loses strokes rather than stalling the room. [[receipt:22222222-2222-2222-2222-222222222222]]',
  '',
  'Rooms are destroyed on the last disconnect, so state lives only in memory — nothing is persisted',
  'and a server restart ends every game in progress. [[receipt:33333333-3333-3333-3333-333333333333]]',
  '',
  'Reconnection behaviour after a server restart is not visible in the trace; no test covers it.',
].join('\n');

describe('explanationLint — the good-prose guard', () => {
  it('a real explanation of a real subsystem produces no findings at all', () => {
    const r = lintExplanation(GOOD_EXPLANATION, {
      scope: { kind: 'cluster', subject: 'Room lifecycle' },
      domainNouns: ['room', 'canvas', 'player', 'draw'],
      mode: 'explanation',
    });
    expect(r.findings, JSON.stringify(r.findings, null, 1)).to.deep.equal([]);
    expect(r.issues).to.deep.equal([]);
  });

  it('reports the stats a harness scores on', () => {
    const r = lintExplanation(GOOD_EXPLANATION, {
      scope: { kind: 'cluster', subject: 'Room lifecycle' },
      domainNouns: ['room', 'canvas', 'player', 'draw'],
    });
    expect(r.stats.claimBlocks).to.equal(3);
    expect(r.stats.citedBlocks).to.equal(3);
    expect(r.stats.disclosesGaps).to.equal(true);
    expect(r.stats.namesSubject).to.equal(true);
    expect(r.stats.domainNounsHit).to.include.members(['room', 'canvas']);
  });
});

// ── rule 4: screen narration ────────────────────────────────────────────────

describe('narration — the text describing itself', () => {
  it('flags "This section details …" (OBSERVED ×5)', () => {
    const r = lintExplanation(
      '**TL;DR:** This section details the core capabilities of the Skribbl system, outlining the user value delivered.',
    );
    expect(has(r.findings, 'document_self_reference')).to.equal(true);
    expect(of_(r.findings, 'document_self_reference')[0]!.sentence).to.include('This section details');
  });

  it('flags "This document outlines …" and "This journey describes …" (OBSERVED)', () => {
    expect(has(lintExplanation('This document outlines the data model of the Skribbl application.').findings, 'document_self_reference')).to.equal(true);
    expect(has(lintExplanation('This journey describes how users connect to the server, create rooms, and join existing ones.').findings, 'artifact_self_reference')).to.equal(true);
  });

  it('does NOT flag a container doing something — the verb class is the discriminator', () => {
    // "manages"/"is responsible for" are things a component does; only a
    // write-up "outlines". Both of these are real, correct sentences.
    for (const good of [
      'This cluster manages the frontend state and is imported by every page.',
      'This capability allows users to draw on a shared canvas with changes synchronised in real time.',
      'The module validates every payload before the room state is mutated.',
      'This section of the canvas is redrawn on every stroke.',
    ]) {
      const r = lintExplanation(good);
      expect(r.findings.map((f) => f.code), good).to.not.include('document_self_reference');
      expect(r.findings.map((f) => f.code), good).to.not.include('artifact_self_reference');
    }
  });

  it('does NOT confuse "details" the noun with "details" the verb', () => {
    const r = lintExplanation('The module details are listed in the reference table below and the guide details live in Consult.');
    expect(has(r.findings, 'document_self_reference')).to.equal(false);
    expect(has(r.findings, 'artifact_self_reference')).to.equal(false);
  });

  it('flags reader-address framing "After reading you can …" (OBSERVED ×6)', () => {
    const r = lintExplanation('After reading you can understand the system\'s feature set and how to extend it.');
    expect(has(r.findings, 'reader_address')).to.equal(true);
  });

  it('flags "as you can see" and tour-guide framing', () => {
    expect(has(lintExplanation('As you can see, the queue sits between the API and the worker.').findings, 'reader_address')).to.equal(true);
    expect(has(lintExplanation('Let us take a look at how the worker consumes jobs from Redis.').findings, 'reader_address')).to.equal(true);
  });

  it('flags narrating a diagram instead of explaining it', () => {
    const r = lintExplanation('The diagram above shows five components connected by four edges.');
    expect(has(r.findings, 'visual_narration')).to.equal(true);
  });

  it('does NOT flag prose that explains what the diagram MEANS', () => {
    const r = lintExplanation(
      'Every arrow crossing into the worker is a queue hop, which is why a failed job never blocks the HTTP request. [[receipt:aaaaaaaa-1111-1111-1111-111111111111]]',
    );
    expect(has(r.findings, 'visual_narration')).to.equal(false);
  });
});

describe('narration — inventory used as an explanation', () => {
  it('flags a sentence whose only content is a count (OBSERVED)', () => {
    // Verbatim from the architecture_deep section of the Skribbl package.
    const r = lintExplanation('Modules comprises 6 files and 3 symbols.');
    expect(has(r.findings, 'inventory_narration')).to.equal(true);
    expect(of_(r.findings, 'inventory_narration')[0]!.sentence).to.equal('Modules comprises 6 files and 3 symbols.');
  });

  it('flags "there are N files here"', () => {
    expect(has(lintExplanation('There are 12 files in this group.').findings, 'inventory_narration')).to.equal(true);
  });

  it('does NOT flag a count that rides along with a real claim', () => {
    // sectionSpecs.ts asks architecture_deep for "its real file count" — the
    // check must not fight the prompt it is grading.
    const r = lintExplanation(
      'The UI cluster owns the canvas, the lobby and the chat panel, and consists of 61 files and 320 symbols.',
    );
    expect(has(r.findings, 'inventory_narration')).to.equal(false);
  });

  it('does NOT flag a dependency count — "imported by 44 files" is a load-bearing fact', () => {
    const r = lintExplanation('`src/lib/utils.ts` is imported by 44 files, so a signature change there is repo-wide.');
    expect(has(r.findings, 'inventory_narration')).to.equal(false);
  });
});

describe('narration — pipeline internals reaching the reader', () => {
  it('flags leaked stable keys (OBSERVED ×8 in the section the reviewer called out)', () => {
    const r = lintExplanation(
      'The clusters involved are `cluster:shared-utilities`, `cluster:server/modules`, and `cluster:state`.',
    );
    expect(has(r.findings, 'internal_key_leak')).to.equal(true);
  });

  it('does NOT flag a file:line locator or a URL, which share the colon shape', () => {
    const r = lintExplanation(
      'The health route is declared at `server/index.js:22` and documented at https://example.com/health. Verification: run the suite.',
    );
    expect(has(r.findings, 'internal_key_leak')).to.equal(false);
  });

  it('does NOT flag an npm script name — the first real run reported `test:node` as a leak', () => {
    const r = lintExplanation(
      'Run the game room tests with `npm run test:node -- --test "server/test/gameRoom.test.js"` before you push.',
    );
    expect(has(r.findings, 'internal_key_leak')).to.equal(false);
  });

  it('flags prose that narrates the evidence bundle instead of the code (OBSERVED)', () => {
    expect(has(lintExplanation('The evidence indicates that certain events enqueue asynchronous work.').findings, 'evidence_narration')).to.equal(true);
    expect(has(lintExplanation('Tests for this handler are not visible in the provided `testGuards`.').findings, 'evidence_narration')).to.equal(true);
  });

  it('does NOT flag the spec\'s own required gap phrasing', () => {
    // sectionSpecs.ts instructs: 'if none is visible for a journey, write
    // "failure handling not visible in the trace"'. Flagging that would make
    // the lint and the prompt contradict each other.
    const r = lintExplanation('Failure handling is not visible in the trace.');
    expect(has(r.findings, 'evidence_narration')).to.equal(false);
  });

  it('leaves fenced code alone — identifiers may contain anything', () => {
    const r = lintExplanation(
      ['```ts', "const key = 'cluster:server/modules';", "// This section details the routes", '```', 'The route is mounted at `/health`.'].join('\n'),
    );
    expect(r.findings).to.deep.equal([]);
  });
});

// ── rule 1: level ───────────────────────────────────────────────────────────

describe('level — the explanation is about the thing it is filed under', () => {
  it('flags a cluster summary that never names its cluster', () => {
    const r = lintExplanation(
      'This provides shared utility functions and definitions used by the pages and by the socket layer.',
      { scope: { kind: 'cluster', subject: 'Server · Modules' } },
    );
    expect(has(r.findings, 'subject_unnamed')).to.equal(true);
  });

  it('accepts a summary that names its cluster across a multi-word label', () => {
    const r = lintExplanation(
      'The server modules own room creation and the socket handshake; every game event lands here first.',
      { scope: { kind: 'cluster', subject: 'Server · Modules' } },
    );
    expect(has(r.findings, 'subject_unnamed')).to.equal(false);
    expect(r.stats.namesSubject).to.equal(true);
  });

  it('matches an inflected subject — prose says "draw", the heading says "Drawing"', () => {
    // Real false positive from the first harness run against the Skribbl
    // package: the capability "Collaborative Drawing and State Synchronization"
    // was reported as unnamed by a paragraph that is entirely about it.
    const r = lintExplanation(
      'Users draw on a shared canvas and every change is synchronized to the other players in the room state.',
      { scope: { kind: 'capability', subject: 'Collaborative Drawing and State Synchronization' } },
    );
    expect(has(r.findings, 'subject_unnamed')).to.equal(false);
  });

  it('matches a subject across a derivation a suffix list cannot reach', () => {
    // Real false positive from the OnboardBuddy run: the capability
    // "Repository Analysis" was reported as unnamed by the sentence that is
    // its own one-line definition. Neither "repository"→"repositories" nor
    // "analysis"→"analyze" survives stemming; a prefix does.
    const r = lintExplanation(
      'Analyze code repositories to extract structural information and dependencies, then generate insights from them.',
      { scope: { kind: 'capability', subject: 'Repository Analysis' } },
    );
    expect(has(r.findings, 'subject_unnamed')).to.equal(false);
  });

  it('still catches a summary that is about something else entirely', () => {
    const r = lintExplanation(
      'Every drawing stroke is broadcast to the other players in the room over the websocket connection.',
      { scope: { kind: 'capability', subject: 'Repository Analysis' } },
    );
    expect(has(r.findings, 'subject_unnamed')).to.equal(true);
  });

  it('cannot judge a label with no matchable token, and does not guess', () => {
    // "UI" is two characters; there is nothing to look for. Reporting it as
    // unnamed flagged every short cluster on the first real run.
    const r = lintExplanation(
      'Frontend components and pages render the lobby, the scoreboard and the drawing surface for each round.',
      { scope: { kind: 'cluster', subject: 'UI' } },
    );
    expect(has(r.findings, 'subject_unnamed')).to.equal(false);
    expect(r.stats.namesSubject).to.equal(null);
  });

  it('flags a cluster summary that makes a whole-repo claim', () => {
    const r = lintExplanation(
      'The State cluster tracks scores. It coordinates the entire application and owns every behaviour in the codebase.',
      { scope: { kind: 'cluster', subject: 'State' } },
    );
    expect(has(r.findings, 'scope_inflation')).to.equal(true);
  });

  it('lets the repo-level section make repo-level claims', () => {
    const r = lintExplanation(
      'Skribbl is a drawing game. The entire system runs as one Express process with an in-memory room registry. [[receipt:bbbbbbbb-1111-1111-1111-111111111111]]',
      { scope: { kind: 'repo', subject: 'Skribbl' } },
    );
    expect(has(r.findings, 'scope_inflation')).to.equal(false);
  });

  it('flags prose that names none of the repo\'s own nouns — the "any repo" signature', () => {
    const r = lintExplanation(
      'The service layer handles requests and returns responses. Controllers delegate to helpers, which delegate ' +
        'to adapters. Each adapter wraps an external dependency and exposes a narrow interface to its callers.',
      { domainNouns: ['room', 'canvas', 'stroke', 'player'] },
    );
    expect(has(r.findings, 'domain_nouns_absent')).to.equal(true);
  });

  it('does not demand domain nouns from a one-line blurb', () => {
    const r = lintExplanation('Configuration and deployment files.', { domainNouns: ['room', 'canvas', 'stroke'] });
    expect(has(r.findings, 'domain_nouns_absent')).to.equal(false);
  });
});

// ── rule 2: grounding ───────────────────────────────────────────────────────

describe('grounding — every claim carries a receipt', () => {
  it('flags a capability paragraph that cites nothing (OBSERVED — the reviewer\'s section)', () => {
    // Verbatim from `capabilities`, the section the reviewer said "does not
    // make sense based on the project I uploaded". Four assertions, zero
    // receipts.
    const r = lintExplanation(
      [
        'This capability manages the overall flow and specific game interactions, such as initiating games and selecting words.',
        '',
        'It is supported by server workflows like start-game and word-selected.',
        '',
        'The relevant clusters are the server modules and the state store.',
        '',
        'Extensions would primarily involve modifying the game logic and state management.',
      ].join('\n'),
      { mode: 'explanation' },
    );
    expect(has(r.findings, 'mostly_uncited')).to.equal(true);
    expect(r.stats.citedBlocks).to.equal(0);
    expect(r.stats.claimBlocks).to.equal(4);
  });

  it('accepts one receipt at the END of a paragraph as grounding that paragraph', () => {
    // The real citation habit. Per-sentence grounding would report two false
    // positives here.
    const r = lintExplanation(
      'A Room is a game session. Rooms are created by `roomManager` and keyed by a six-character code. ' +
        'Players join through the join-room event. [[receipt:cccccccc-1111-1111-1111-111111111111]]',
    );
    expect(has(r.findings, 'uncited_claim')).to.equal(false);
    expect(r.stats.citedBlocks).to.equal(1);
  });

  it('treats each bullet as its own claim — one receipt on the last does not ground the rest', () => {
    const r = lintExplanation(
      [
        '- The server rejects usernames longer than twenty characters before the player joins a room.',
        '- The server destroys a room as soon as the last connected player disconnects from it.',
        '- The server rate-limits draw operations to a fixed batch budget per second. [[receipt:dddddddd-1111-1111-1111-111111111111]]',
      ].join('\n'),
    );
    expect(of_(r.findings, 'uncited_claim')).to.have.length(2);
  });

  it('accepts a file:line locator as a receipt a reader can follow', () => {
    const r = lintExplanation('Usernames longer than 20 characters are rejected in `server/src/validate.js:8` before the room is joined.');
    expect(has(r.findings, 'uncited_claim')).to.equal(false);
  });

  it('exempts reference sections, whose facts are spliced in from SQL', () => {
    const r = lintExplanation(
      'Every route below is grouped by mount path. The tables are generated from parsed handlers.\n\n[[backbone]]\n\n| GET | `/health` | `server/index.js` |',
      { mode: 'reference' },
    );
    expect(has(r.findings, 'mostly_uncited')).to.equal(false);
    expect(has(r.findings, 'uncited_claim')).to.equal(false);
  });

  it('exempts imperative tutorial steps — the command is the evidence', () => {
    const r = lintExplanation(
      ['1. Copy the example environment file to `.env` before starting anything.', '', '2. Run the development server with the npm script.'].join('\n'),
      { mode: 'tutorial' },
    );
    expect(has(r.findings, 'mostly_uncited')).to.equal(false);
  });

  it('exempts a BOLDED imperative step — the model writes its steps emphasised', () => {
    // Real false positive from the first harness run: every how-to step in the
    // Skribbl package is written "**Locate the server entrypoint:** …".
    const r = lintExplanation(
      [
        '1. **Locate the server entrypoint:** Modify the `server/index.js` file to add the route.',
        '',
        '2. **Define the new route:** Add a new `app.METHOD` definition beside the health check.',
        '',
        '3. **Implement the handler:** Create a function that handles requests for the new route.',
      ].join('\n'),
      { mode: 'howto' },
    );
    expect(has(r.findings, 'mostly_uncited')).to.equal(false);
    expect(has(r.findings, 'uncited_claim')).to.equal(false);
  });

  it('does not bill a gap disclosure as an uncited claim', () => {
    const r = lintExplanation('This project does not specify a run command in its `package.json` scripts.');
    expect(has(r.findings, 'uncited_claim')).to.equal(false);
    expect(lintExplanation('This project does not specify a run command in its `package.json` scripts.').stats.disclosesGaps).to.equal(true);
  });
});

// ── rule 3: gaps ────────────────────────────────────────────────────────────

describe('gaps — naming what could not be determined', () => {
  const longUndisclosed = Array.from(
    { length: 12 },
    (_, i) =>
      `Paragraph ${i} describes how the room registry stores players and their scores in memory during a match, ` +
      `with the drawer rotating each turn. [[receipt:eeeeeeee-1111-1111-1111-11111111111${i % 10}]]`,
  ).join('\n\n');

  it('flags a long, confident, gap-free explanation', () => {
    const r = lintExplanation(longUndisclosed);
    expect(has(r.findings, 'no_gap_disclosure')).to.equal(true);
  });

  it('accepts any of the real disclosure phrasings', () => {
    for (const phrasing of [
      'Failure handling is not visible in the trace.',
      'Column-level detail beyond the evidence is not included.',
      'The upload path could not be resolved from the code.',
      'Known gaps: the deployment target is unknown.',
    ]) {
      const r = lintExplanation(`${longUndisclosed}\n\n${phrasing}`);
      expect(has(r.findings, 'no_gap_disclosure'), phrasing).to.equal(false);
    }
  });

  it('counts an inline [[unverified]] marker as a disclosure', () => {
    // The pipeline injects these AFTER linting, so stored content carries
    // them and the harness must not re-flag re-scored sections.
    const r = lintExplanation(`${longUndisclosed}\n\n[[unverified]]The worker is a separate process.[[/unverified]]`);
    expect(has(r.findings, 'no_gap_disclosure')).to.equal(false);
  });

  it('flags an unread subsystem the text never admits to — the FloowForge case', () => {
    const r = lintExplanation(
      'FloowForge is a workflow builder. The Next.js app under `web/` renders the flow editor and the run history. ' +
        'Nothing else was determined.',
      { mustDisclose: ['Python'] },
    );
    expect(has(r.findings, 'undisclosed_gap')).to.equal(true);
    expect(of_(r.findings, 'undisclosed_gap')[0]!.detail).to.include('Python');
  });

  it('passes once the unread subsystem is named', () => {
    const r = lintExplanation(
      'FloowForge is a workflow builder. The `api/` backend is written in Python and no parser reads it, so every ' +
        'claim below covers only the Next.js frontend.',
      { mustDisclose: ['Python'] },
    );
    expect(has(r.findings, 'undisclosed_gap')).to.equal(false);
  });

  it('does not demand a disclosure from a short blurb unless asked', () => {
    expect(has(lintExplanation('Rooms are keyed by a six-character code.').findings, 'no_gap_disclosure')).to.equal(false);
    expect(has(lintExplanation('Rooms are keyed by a six-character code.', { requireGapDisclosure: true }).findings, 'no_gap_disclosure')).to.equal(true);
  });
});

// ── plumbing ────────────────────────────────────────────────────────────────

describe('explanationLint — output contract', () => {
  it('every finding quotes an offending sentence a human can judge', () => {
    const r = lintExplanation(
      'This section details the routes. Modules comprises 6 files and 3 symbols. After reading you can extend them.',
      { scope: { kind: 'cluster', subject: 'Nothing Matching' }, domainNouns: ['room', 'canvas', 'stroke'] },
    );
    expect(r.findings.length).to.be.greaterThan(3);
    for (const f of r.findings) {
      expect(f.sentence, f.code).to.be.a('string').and.have.length.greaterThan(0);
      expect(f.detail, f.code).to.be.a('string').and.have.length.greaterThan(0);
    }
  });

  it('issues carry only errors, and quote the sentence into the retry prompt', () => {
    const r = lintExplanation('This section details the routes and after reading you can extend them.');
    expect(r.issues).to.have.length(1);
    expect(r.issues[0]).to.include('SCREEN NARRATION');
    expect(r.issues[0]).to.include('This section details the routes');
  });

  it('a warn-only finding never triggers a retry', () => {
    const r = lintExplanation('Refer to receipt for the mount path of the health endpoint in the server.');
    expect(r.hits).to.include('evidence_narration');
    expect(r.issues).to.deep.equal([]);
  });

  it('handles empty, whitespace and undefined input', () => {
    for (const input of ['', '   \n\n  ', undefined as unknown as string]) {
      const r = lintExplanation(input);
      expect(r.findings).to.deep.equal([]);
      expect(r.issues).to.deep.equal([]);
    }
  });
});

describe('splitSentences', () => {
  it('does not split inside a file path or an abbreviation', () => {
    expect(splitSentences('Open `server/index.js`. Then edit `src/lib/utils.ts` (e.g. the cn helper). Done.')).to.have.length(3);
  });

  it('keeps a decimal number in one sentence', () => {
    expect(splitSentences('Node 22.15 is required. Docker is optional.')).to.have.length(2);
  });
});
