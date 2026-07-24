import * as fs from 'node:fs';
import type { RepoFileRecord, RepoInventory, EvidenceNode } from '../types/analysis.js';
import { configKey, schemaKey } from './stableKeys.js';
import { MAX_SNIPPET_CHARS } from './budgets.js';

/**
 * Config/schema/migration scanner: turns evidence files into `config` and
 * `schema` graph nodes with trust level 'config' (doc/Pipeline.md
 * "Config/schema/migration scanner"). Schema nodes are one per `create table`
 * found in SQL migrations/schema files — they are what `touches_schema`
 * edges point at.
 */

const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(?:public|dbo)"?\.)?"?([a-zA-Z0-9_]+)"?/gi;

export function scanConfigNodes(files: RepoFileRecord[], inventory: RepoInventory): EvidenceNode[] {
  const nodes: EvidenceNode[] = [];
  const seen = new Set<string>();
  const configKindByPath = new Map(inventory.configs.map((c) => [c.path, c.kind]));

  for (const file of files) {
    if (file.category === 'config') {
      const key = configKey(file.relativePath);
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({
        stableKey: key,
        type: 'config',
        name: file.relativePath.split('/').pop()!,
        filePath: file.relativePath,
        hash: file.hash,
        trustLevel: 'config',
        snippet: readSnippet(file),
        metadata: {
          configKind: configKindByPath.get(file.relativePath) ?? 'other',
          language: file.language,
        },
      });
    } else if (file.category === 'schema' || file.category === 'migration') {
      // One config-trust node for the file itself...
      const fileNodeKey = configKey(file.relativePath);
      if (!seen.has(fileNodeKey)) {
        seen.add(fileNodeKey);
        nodes.push({
          stableKey: fileNodeKey,
          type: 'config',
          name: file.relativePath.split('/').pop()!,
          filePath: file.relativePath,
          hash: file.hash,
          trustLevel: 'config',
          snippet: readSnippet(file),
          metadata: { configKind: file.category === 'migration' ? 'sql_migration' : 'schema', language: file.language },
        });
      }
      // ...plus one schema node per created table. references = FK targets
      // parsed from the table body — the deterministic ER backbone
      // (data_model's anchor) draws real relationships, not just access edges.
      for (const table of extractCreatedTables(file)) {
        const key = schemaKey(file.relativePath, table.name);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push({
          stableKey: key,
          type: 'schema',
          name: table.name,
          filePath: file.relativePath,
          lineStart: table.line,
          hash: file.hash,
          trustLevel: 'config',
          metadata: {
            table: table.name,
            source: file.category,
            ...(table.references.length > 0 ? { references: table.references } : {}),
          },
        });
      }
    }
  }

  return nodes;
}

function readSnippet(file: RepoFileRecord): string | null {
  try {
    return fs.readFileSync(file.absolutePath, 'utf8').slice(0, MAX_SNIPPET_CHARS);
  } catch {
    return null;
  }
}

const REFERENCES_RE = /references\s+(?:"?(?:public|dbo)"?\.)?"?([a-zA-Z0-9_]+)"?/gi;

function extractCreatedTables(
  file: RepoFileRecord,
): Array<{ name: string; line: number; references: string[] }> {
  if (file.language !== 'sql') return [];
  let text: string;
  try {
    text = fs.readFileSync(file.absolutePath, 'utf8');
  } catch {
    return [];
  }

  // Two passes over the same regex: first collect table start offsets, then
  // scan each table's body (start -> next start) for its FK references.
  const starts: Array<{ name: string; index: number }> = [];
  let match: RegExpExecArray | null;
  CREATE_TABLE_RE.lastIndex = 0;
  while ((match = CREATE_TABLE_RE.exec(text)) !== null) {
    starts.push({ name: match[1]!, index: match.index });
  }

  const tables: Array<{ name: string; line: number; references: string[] }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < starts.length; i++) {
    const { name, index } = starts[i]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const body = text.slice(index, starts[i + 1]?.index ?? text.length);
    const references = new Set<string>();
    let ref: RegExpExecArray | null;
    REFERENCES_RE.lastIndex = 0;
    while ((ref = REFERENCES_RE.exec(body)) !== null) {
      if (ref[1] !== name) references.add(ref[1]!);
    }
    tables.push({
      name,
      line: text.slice(0, index).split('\n').length,
      references: [...references],
    });
  }
  return tables;
}

/** All schema table names found, for touches_schema edge matching. */
export function schemaTableIndex(nodes: EvidenceNode[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const n of nodes) {
    if (n.type === 'schema') index.set(n.name, n.stableKey);
  }
  return index;
}
