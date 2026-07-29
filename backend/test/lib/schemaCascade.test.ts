import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "chai";

/**
 * Bug #10 — `DELETE FROM projects` relies entirely on the database to remove
 * everything the project owns. Audited against the live schema on 2026-07-26:
 * all 12 foreign keys pointing at `projects` are `on delete cascade`, and the
 * cascade reaches 34 of the 37 public tables transitively. There is no orphaned
 * data today and no application-level cleanup worth writing.
 *
 * What *is* worth writing is this: the guarantee is unenforced. Any table added
 * later with a nullable FK, or one that omits `on delete cascade`, silently
 * starts leaking rows on every project delete — no error, no failing request,
 * just data that outlives its project. That is the definition of a silent
 * regression, so it is pinned here rather than left to a future audit.
 *
 * Deliberately static: it reads the migrations, which is what a developer
 * adding a table actually edits, so it fails in CI without database
 * credentials. The parse was validated by reproducing the live `pg_constraint`
 * result exactly (34 reachable / 3 not).
 */

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

/**
 * Tables that correctly survive a project delete because they are scoped to a
 * *user*, not a project. Adding a table here is a deliberate statement that its
 * rows must outlive the projects that reference them.
 */
const NOT_PROJECT_SCOPED = ["github_connections", "github_installations", "users"];

interface ForeignKey {
  child: string;
  parent: string;
  column: string;
  cascades: boolean;
  notNull: boolean;
}

/** Split a `create table` body on commas that are not inside parentheses. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function parseMigrations(): { tables: string[]; foreignKeys: ForeignKey[] } {
  const sql = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f !== "000_drop_all.sql")
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, ""); // strip line comments before matching

  const tables: string[] = [];
  const foreignKeys: ForeignKey[] = [];

  const createTable = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = createTable.exec(sql)) !== null) {
    const table = match[1]!;
    tables.push(table);

    // Walk from the opening paren to its match to get the table body.
    let depth = 1;
    let i = createTable.lastIndex;
    while (i < sql.length && depth > 0) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
      i++;
    }
    const body = sql.slice(createTable.lastIndex, i - 1);

    // Columns named by a table-level `primary key (a, b)` are implicitly NOT NULL.
    const pkColumns = new Set<string>();
    const tablePk = /primary\s+key\s*\(([^)]*)\)/i.exec(body);
    if (tablePk) {
      for (const c of tablePk[1]!.split(",")) pkColumns.add(c.trim());
    }

    for (const definition of splitTopLevel(body)) {
      const ref = /references\s+public\.(\w+)\s*\(/i.exec(definition);
      if (!ref) continue;
      const column = /^\s*(\w+)/.exec(definition)?.[1] ?? "";
      foreignKeys.push({
        child: table,
        parent: ref[1]!,
        column,
        cascades: /on\s+delete\s+cascade/i.test(definition),
        // A nullable cascading FK still leaves NULL rows behind, so it does not
        // count as a delete path. Column-level `primary key` implies NOT NULL.
        notNull:
          /\bnot\s+null\b/i.test(definition) ||
          /\bprimary\s+key\b/i.test(definition) ||
          pkColumns.has(column),
      });
    }
  }

  // `alter table ... add column ... references ...` / `... add constraint ...
  // foreign key ... references ...`. The schema already uses the first form
  // once (project_members.default_package_id) and it is the likeliest shape for
  // any FK a later migration adds, so a parser that only read `create table`
  // would go blind exactly when this check starts to matter.
  const alterTable = /alter\s+table\s+(?:only\s+)?public\.(\w+)([^;]*);/gi;
  while ((match = alterTable.exec(sql)) !== null) {
    const [, table, statement] = match as unknown as [string, string, string];
    const ref = /references\s+public\.(\w+)\s*\(/i.exec(statement);
    if (!ref) continue;
    foreignKeys.push({
      child: table,
      parent: ref[1]!,
      column:
        /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/i.exec(statement)?.[1] ??
        /foreign\s+key\s*\(\s*(\w+)/i.exec(statement)?.[1] ??
        "",
      cascades: /on\s+delete\s+cascade/i.test(statement),
      // Conservative: `add constraint ... foreign key` says nothing about
      // nullability, so it does not count as a delete path unless it says so.
      // A false alarm here is a loud failure asking a human to look, which is
      // the right outcome for a migration that adds an FK to project data.
      notNull: /\bnot\s+null\b/i.test(statement),
    });
  }

  return { tables, foreignKeys };
}

/** Tables Postgres will delete when a row in `projects` goes away. */
function reachableByCascade(foreignKeys: ForeignKey[]): Set<string> {
  const reached = new Set(["projects"]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const fk of foreignKeys) {
      if (fk.child === fk.parent) continue;
      if (reached.has(fk.parent) && !reached.has(fk.child) && fk.cascades && fk.notNull) {
        reached.add(fk.child);
        changed = true;
      }
    }
  }
  return reached;
}

describe("project delete cascades to every project-scoped table (bug #10)", () => {
  const { tables, foreignKeys } = parseMigrations();

  it("parses the schema (guards against this suite passing vacuously)", () => {
    // A parser that silently stopped matching would report an empty graph, and
    // the check below would then be measuring nothing. Bounds rather than exact
    // counts: the schema was 37 tables / 84 FKs when this was written, and a
    // legitimate addition should be judged by the next test, not by this one.
    expect(tables.length, "tables parsed").to.be.at.least(37);
    expect(foreignKeys.length, "foreign keys parsed").to.be.at.least(84);
  });

  it("leaves nothing behind but the user-scoped tables", () => {
    const reached = reachableByCascade(foreignKeys);
    const orphaned = tables.filter((t) => !reached.has(t)).sort();

    // A new table with an FK to a project-scoped table fails here unless that
    // FK is `not null ... on delete cascade`, naming the table that would leak.
    expect(orphaned).to.deep.equal(NOT_PROJECT_SCOPED);
  });
});
