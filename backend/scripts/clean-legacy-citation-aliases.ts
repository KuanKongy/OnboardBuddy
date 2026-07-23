/**
 * One-off maintenance: strip dead inline citation aliases from sections
 * generated before [[receipt:…]] markers existed.
 *
 * Legacy contentMarkdown contains prompt-internal labels — "(receipt r14)",
 * "[r3]", trailing "## Used Receipt IDs" blocks — that reference an
 * evidence-bundle numbering the reader can never resolve. New generations
 * rewrite these to real markers at persist time (sectionGenerator); for
 * already-persisted sections the alias map is gone, so the only honest
 * transformation is removal, via the same fence-aware rewriter the
 * generator uses (citationMarkers.stripLegacyCitationAliases).
 *
 * Usage (from repo root; reads backend/.env for DATABASE_URL):
 *   node --import tsx backend/scripts/clean-legacy-citation-aliases.ts            # dry run
 *   node --import tsx backend/scripts/clean-legacy-citation-aliases.ts --apply    # write
 *
 * Dry run prints a JSON backup of every row it WOULD change to stdout —
 * save it before applying. Sections already containing [[receipt: markers
 * are skipped (they are post-marker content).
 */
import 'dotenv/config';
import { query, pool } from '../src/lib/db.js';
import { stripLegacyCitationAliases } from '../src/worker/generation/citationMarkers.js';

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const rows = (await query(
    `SELECT id, package_id, type, content FROM package_sections ORDER BY created_at`,
  )).rows as Array<{ id: string; package_id: string; type: string; content: string }>;

  const changes: Array<{ id: string; package_id: string; type: string; dropped: string[]; before: string; after: string }> = [];
  for (const row of rows) {
    if (!row.content || row.content.includes('[[receipt:')) continue;
    const result = stripLegacyCitationAliases(row.content);
    if (result.content !== row.content) {
      changes.push({
        id: row.id,
        package_id: row.package_id,
        type: row.type,
        dropped: result.dropped,
        before: row.content,
        after: result.content,
      });
    }
  }

  console.error(`${rows.length} sections scanned; ${changes.length} need cleanup${apply ? '' : ' (dry run — pass --apply to write)'}`);
  for (const c of changes) {
    console.error(`  ${c.type} (${c.id}): dropping [${c.dropped.join(', ')}] · ${c.before.length - c.after.length} chars removed`);
  }

  if (!apply) {
    // Backup payload for the rows a real run would modify.
    console.log(JSON.stringify(changes, null, 1));
  } else {
    for (const c of changes) {
      await query(`UPDATE package_sections SET content = $1 WHERE id = $2`, [c.after, c.id]);
    }
    console.error(`Applied ${changes.length} updates.`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
