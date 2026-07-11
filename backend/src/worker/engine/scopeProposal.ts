import type { RepoFileRecord, RepoInventory, ScopeProposal } from '../types/analysis.js';
import { normalizePath } from './stableKeys.js';

/**
 * Deterministic scope proposal from the repo inventory (doc/Pipeline.md
 * "Scope proposal"): whole repo always; package.json workspaces; docker
 * compose services with build contexts; conventional top-level dirs when
 * they look like real subprojects. The user confirms or overrides.
 */

const CONVENTIONAL_TOP_DIRS = new Set([
  'frontend', 'backend', 'server', 'client', 'api', 'worker', 'web', 'app', 'mobile',
]);

const MIN_SOURCE_FILES_FOR_DIR_SCOPE = 10;

export function proposeScopes(inventory: RepoInventory, files: RepoFileRecord[]): ScopeProposal[] {
  const proposals = new Map<string, ScopeProposal>();

  const add = (p: ScopeProposal) => {
    const key = normalizePath(p.pathPrefix).replace(/\/+$/, '');
    if (!proposals.has(key)) proposals.set(key, { ...p, pathPrefix: key });
  };

  add({ pathPrefix: '', displayName: 'Whole repository', kind: 'whole_repo', detectedFrom: 'default' });

  // Non-root package.json dirs = workspace packages (covers explicit
  // `workspaces` globs too, since each member has its own package.json).
  for (const pkg of inventory.packages) {
    if (pkg.root === '') continue;
    add({
      pathPrefix: pkg.root,
      displayName: pkg.name ?? pkg.root,
      kind: 'workspace_package',
      detectedFrom: 'package_json_workspaces',
    });
  }

  // Docker compose services with a build context inside the repo.
  for (const svc of inventory.dockerServices) {
    if (!svc.buildContext || svc.buildContext === '.' || svc.buildContext.startsWith('..')) continue;
    add({
      pathPrefix: svc.buildContext,
      displayName: svc.name,
      kind: 'docker_service',
      detectedFrom: 'docker_compose',
    });
  }

  // Conventional top dirs (and apps/*, packages/*, services/*) with enough
  // source files to be a meaningful boundary.
  const sourceCountByTopDir = new Map<string, number>();
  for (const f of files) {
    if (f.category !== 'source' && f.category !== 'test') continue;
    const segments = f.relativePath.split('/');
    if (segments.length < 2) continue;
    const first = segments[0]!.toLowerCase();
    let dir: string | null = null;
    if (CONVENTIONAL_TOP_DIRS.has(first)) dir = segments[0]!;
    else if (['apps', 'packages', 'services'].includes(first) && segments.length >= 3) {
      dir = `${segments[0]}/${segments[1]}`;
    }
    if (dir) sourceCountByTopDir.set(dir, (sourceCountByTopDir.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of sourceCountByTopDir) {
    if (count >= MIN_SOURCE_FILES_FOR_DIR_SCOPE) {
      add({ pathPrefix: dir, displayName: dir, kind: 'directory', detectedFrom: 'top_level_dir' });
    }
  }

  return [...proposals.values()];
}
