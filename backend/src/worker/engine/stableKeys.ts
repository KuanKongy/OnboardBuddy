/**
 * Stable key construction for every graph node kind (see doc/Pipeline.md
 * "Symbol extraction"). Keys are repo-local: the project id disambiguates
 * across repos, so the same code at the same path always gets the same key —
 * this is what makes semantic-record caching and incremental diffs work.
 *
 * Formats:
 *   relative/path.ts                       file
 *   relative/path.ts#SymbolName            top-level symbol
 *   relative/path.ts#ClassName.methodName  class member
 *   relative/path.ts#default               default export
 *   doc:README.md#section-slug             doc section node
 *   config:docker-compose.yml              config node
 *   schema:migrations/001.sql#projects     schema (table) node
 *   external:express                       out-of-scope / third-party node
 */

/** Normalizes path separators so keys are identical across platforms. */
export function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}

/**
 * True for `kind:`-prefixed keys (doc:, config:, schema:, external:, and
 * synthesis keys like cluster:/wf:) — everything that is not a plain
 * `path` / `path#symbol` graph key. The prefix is the ONLY safe signal:
 * route symbols such as `projects.ts#POST /:id/analyze` contain colons in
 * their Express path params and must never be mistaken for synthesis keys.
 */
export function hasKindPrefix(stableKey: string): boolean {
  return /^[a-z][a-z0-9_]*:/i.test(stableKey);
}

export function fileKey(relativePath: string): string {
  return normalizePath(relativePath);
}

export function symbolKey(relativePath: string, symbolName: string, parentName?: string): string {
  const member = parentName ? `${parentName}.${symbolName}` : symbolName;
  return `${normalizePath(relativePath)}#${member}`;
}

export function defaultExportKey(relativePath: string): string {
  return `${normalizePath(relativePath)}#default`;
}

export function docKey(relativePath: string, sectionSlug?: string): string {
  const base = `doc:${normalizePath(relativePath)}`;
  return sectionSlug ? `${base}#${sectionSlug}` : base;
}

export function configKey(relativePath: string): string {
  return `config:${normalizePath(relativePath)}`;
}

export function schemaKey(relativePath: string, tableName: string): string {
  return `schema:${normalizePath(relativePath)}#${tableName}`;
}

export function externalKey(specifierOrPath: string): string {
  return `external:${normalizePath(specifierOrPath)}`;
}

/** Slugifies a doc heading into a stable section identifier. */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';
}
