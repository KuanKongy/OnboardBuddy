import { expect } from 'chai';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { __setQueryForTests } from '../../../lib/db.js';
import { collectSectionReceipts, collectSectionReceiptsOrGap } from '../deterministicReceipts.js';
import { SECTION_TYPES, type SectionDeps } from '../sectionSpecs.js';

/**
 * The P0 this file exists for.
 *
 * `architecture_deep`'s receipt query was rewritten to rank clusters in a
 * subquery, and its outer `SELECT` kept projecting `n.id, n.stable_key, …`
 * while its outer `FROM` declared only the derived table. Postgres rejected
 * every call with `missing FROM-clause entry for table "n"`, the per-section
 * catch turned that into `recordMissingSection`, and the driver's message
 * shipped as reader-facing markdown on 11 of 11 audited projects.
 *
 * No unit test could have caught it, because every test in this suite stubs
 * `query` with a function that accepts any string. So these run each statement
 * the module actually emits through name resolution against the REAL schema —
 * the migrations in `supabase/migrations` — and the same scoping rules Postgres
 * applies: a qualifier is legal only where its alias is declared, a derived
 * table exposes only what its subquery projects, and a column must exist.
 */

// ─── the real schema ─────────────────────────────────────────────────────────

const MIGRATIONS = fileURLToPath(new URL('../../../../supabase/migrations/', import.meta.url));

/** table → columns, read from the shipped DDL (drops excluded, ALTERs applied). */
const TABLES: Map<string, Set<string>> = (() => {
  const ddl = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('000_'))
    .sort()
    .map((f) => readFileSync(MIGRATIONS + f, 'utf8'))
    .join('\n');
  const tables = new Map<string, Set<string>>();
  const NOT_A_COLUMN = new Set(['primary', 'unique', 'constraint', 'check', 'foreign', 'exclude']);
  for (const [, name, body] of ddl.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const cols = new Set<string>();
    for (const line of body!.split('\n')) {
      const col = /^ {2}(\w+)\s+\S/.exec(line);
      if (col && !NOT_A_COLUMN.has(col[1]!.toLowerCase())) cols.add(col[1]!);
    }
    tables.set(name!, cols);
  }
  for (const [, table, col] of ddl.matchAll(/alter table public\.(\w+)\s+add column(?: if not exists)? (\w+)/g)) {
    tables.get(table!)?.add(col!);
  }
  return tables;
})();

// ─── a very small SQL name resolver ──────────────────────────────────────────

const DERIVED = '__derived__';
/** Words that can follow a table name without being its alias. */
const NOT_AN_ALIAS = new Set([
  'where', 'on', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'lateral', 'full',
  'group', 'order', 'limit', 'offset', 'having', 'union', 'using', 'window', 'fetch',
  'set', 'returning', 'values', 'as', 'for',
]);

/** Literals and comments removed, so no `.` inside text can look like a qualifier. */
const scrub = (sql: string): string => sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ');

/** Index of the `)` closing the `(` at `open`. */
function closeParen(sql: string, open: number): number {
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')' && (depth -= 1) === 0) return i;
  }
  return sql.length;
}

/** Depth-0 split of a select list on commas. */
function splitItems(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '(') depth += 1;
    else if (list[i] === ')') depth -= 1;
    else if (list[i] === ',' && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** alias → visible columns, for one query scope. */
function declaredIn(sql: string, derived: Set<string> | null): Map<string, Set<string>> {
  const scope = new Map<string, Set<string>>();
  for (const [, table, maybeAlias] of sql.matchAll(/\b(?:FROM|JOIN)\s+(?!\()(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const alias = maybeAlias && !NOT_AN_ALIAS.has(maybeAlias.toLowerCase()) ? maybeAlias : table!;
    if (table === DERIVED) {
      scope.set(alias, derived ?? new Set());
      continue;
    }
    expect(TABLES.has(table!), `unknown table "${table}"`).to.equal(true);
    scope.set(alias, TABLES.get(table!)!);
  }
  return scope;
}

/** The output column names of a subquery — what its derived-table alias exposes. */
function projectionOf(inner: string): Set<string> {
  const select = /\bSELECT\b/i.exec(inner)!;
  let i = select.index + select[0].length;
  let depth = 0;
  for (; i < inner.length; i += 1) {
    if (inner[i] === '(') depth += 1;
    else if (inner[i] === ')') depth -= 1;
    else if (depth === 0 && /\bFROM\b/i.test(inner.slice(i, i + 4)) && !/\w/.test(inner[i - 1] ?? ' ')) break;
  }
  const innerScope = declaredIn(inner.slice(i), null);
  const names = new Set<string>();
  for (const item of splitItems(inner.slice(select.index + select[0].length, i))) {
    const aliased = /\bAS\s+(\w+)\s*$/i.exec(item);
    const star = /^(\w+)\.\*$/.exec(item);
    const qualified = /(\w+)\.(\w+)\s*$/.exec(item);
    if (aliased) names.add(aliased[1]!);
    else if (star) for (const c of innerScope.get(star[1]!) ?? []) names.add(c);
    else if (qualified) names.add(qualified[2]!);
    else if (/^\w+$/.test(item)) names.add(item);
  }
  return names;
}

/** Every `alias.column` in `sql` resolves inside `scope`, or this throws. */
function assertResolves(scope: Map<string, Set<string>>, sql: string, where: string): void {
  for (const [ref, alias, column] of sql.matchAll(/\b([a-z_]\w*)\.(\w+)/gi)) {
    const cols = scope.get(alias!);
    expect(
      cols, `${where}: missing FROM-clause entry for table "${alias}" (in "${ref}"); declared: ${[...scope.keys()]}`,
    ).to.not.equal(undefined);
    expect(cols!.has(column!), `${where}: column "${ref}" does not exist`).to.equal(true);
  }
}

/**
 * Resolves one statement the way Postgres does: the outer query sees the
 * derived table's PROJECTION, never the aliases inside it.
 */
function assertExecutable(rawSql: string): void {
  const sql = scrub(rawSql);
  const from = sql.search(/\bFROM\s*\(/i);
  if (from < 0) {
    assertResolves(declaredIn(sql, null), sql, 'query');
    return;
  }
  const open = sql.indexOf('(', from);
  const close = closeParen(sql, open);
  const inner = sql.slice(open + 1, close);
  const outer = `${sql.slice(0, open)} ${DERIVED} ${sql.slice(close + 1)}`;
  assertResolves(declaredIn(inner, null), inner, 'subquery');
  assertResolves(declaredIn(outer, projectionOf(inner)), outer, 'outer query');
}

// ─── the tests ───────────────────────────────────────────────────────────────

const deps = {
  snapshotId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  role: 'general',
  projections: [{ stableKey: 'file:src/db.ts', targetType: 'file', reasons: ['high fan-in'] }],
  sizeClass: 'mid',
} as unknown as SectionDeps;

describe('deterministicReceipts — every section emits SQL Postgres can actually run', () => {
  afterEach(() => __setQueryForTests(null));

  it('resolves every qualified column against the real schema and the scope that declares its alias', async () => {
    const statements: string[] = [];
    __setQueryForTests(async (text) => {
      statements.push(text);
      // Enough of a result to keep every downstream query reachable: `code_map`
      // skips the node lookup entirely when the ranking query returns nothing.
      return {
        rows: /criticality_scores/.test(text)
          ? [{ stable_key: 'file:src/db.ts', score: 1, reasons: ['high fan-in'] }]
          : [],
      } as never;
    });

    for (const sectionType of SECTION_TYPES) await collectSectionReceipts(sectionType, deps);

    // The regression: this list used to contain
    // `SELECT n.id, … FROM (…) ranked`, which no mock could reject.
    for (const sql of statements) assertExecutable(sql);
    expect(statements.length).to.be.greaterThan(SECTION_TYPES.length);
  });

  it('a receipt query that cannot run degrades to a recorded gap, never to shipped prose', async () => {
    // What actually happened: the section threw, `summaryWorker` recorded it as
    // missing, and `> **This section could not be generated.** missing
    // FROM-clause entry for table "n"` was the content readers got. Receipts are
    // supplementary evidence — losing them must cost the citations, not the
    // section, and the reason belongs where failures are QUERIED.
    __setQueryForTests(async () => {
      throw Object.assign(new Error('missing FROM-clause entry for table "n"'), { code: '42P01' });
    });
    const degraded = await collectSectionReceiptsOrGap('architecture_deep', deps);
    expect(degraded.rows).to.deep.equal([]);
    expect(degraded.gap).to.deep.equal({
      kind: 'receipts_unavailable',
      detail: 'Evidence receipts for this section could not be collected (SQLSTATE 42P01): missing FROM-clause entry for table "n"',
    });

    // A pause/kill/budget signal is never absorbed by an evidence guard.
    __setQueryForTests(async () => {
      throw Object.assign(new Error('paused'), { name: 'AiPausedError' });
    });
    await collectSectionReceiptsOrGap('architecture_deep', deps).then(
      () => expect.fail('run-control error was swallowed'),
      (err: Error) => expect(err.name).to.equal('AiPausedError'),
    );
  });
});
