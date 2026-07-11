import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Path-alias support for analyzed repos (monorepos included). The worker
 * analyzes a zipball extract with no node_modules and often no root
 * tsconfig.json, so alias imports like `@/components/x` used to resolve as
 * third-party packages — killing cross-file call resolution and workflow
 * extraction on frontend-heavy repos. This module collects `paths` mappings
 * from EVERY tsconfig in the repo and rebases them onto the repo root so
 * both the TS program and our own import resolver can use them.
 */

export interface CollectedAliases {
  /** Alias pattern (may contain one '*') -> repo-relative target patterns. */
  paths: Record<string, string[]>;
}

const MAX_TSCONFIG_DEPTH = 3;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

/** Finds tsconfig*.json files up to a shallow depth (workspace roots). */
function findTsconfigs(rootPath: string, dir = rootPath, depth = 0): string[] {
  if (depth > MAX_TSCONFIG_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && /^tsconfig(\..+)?\.json$/.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
      found.push(...findTsconfigs(rootPath, path.join(dir, entry.name), depth + 1));
    }
  }
  return found;
}

/**
 * Collects `compilerOptions.paths` from every tsconfig under the root and
 * rewrites the targets to be relative to the repo root. When two workspaces
 * define the same alias, both targets are kept (resolution tries in order).
 */
export function collectPathAliases(rootPath: string): CollectedAliases {
  const merged: Record<string, string[]> = {};
  for (const configPath of findTsconfigs(rootPath)) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const options = read.config?.compilerOptions as { baseUrl?: string; paths?: Record<string, string[]> } | undefined;
    if (!options?.paths) continue;
    const configDir = path.dirname(configPath);
    const baseDir = options.baseUrl ? path.resolve(configDir, options.baseUrl) : configDir;
    for (const [pattern, targets] of Object.entries(options.paths)) {
      if (!Array.isArray(targets)) continue;
      const rebased = targets
        .map((t) => path.relative(rootPath, path.resolve(baseDir, t)).replace(/\\/g, '/'))
        .filter((t) => !t.startsWith('..'));
      if (rebased.length === 0) continue;
      merged[pattern] = [...new Set([...(merged[pattern] ?? []), ...rebased])];
    }
  }
  return { paths: merged };
}

/**
 * Resolves a specifier through the collected aliases to candidate
 * repo-relative paths (extension resolution is the caller's job).
 * Returns null when no alias pattern matches.
 */
export function resolveAlias(aliases: CollectedAliases, specifier: string): string[] | null {
  const candidates: string[] = [];
  for (const [pattern, targets] of Object.entries(aliases.paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (specifier === pattern) candidates.push(...targets.map((t) => t.replace('*', '')));
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
    candidates.push(...targets.map((t) => t.replace('*', wildcard)));
  }
  return candidates.length > 0 ? candidates : null;
}
