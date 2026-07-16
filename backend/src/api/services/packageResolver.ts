/**
 * Central package/snapshot resolution for project-scoped reads. Every feature
 * endpoint (onboarding reader, graph, architecture, classes, capabilities,
 * workflows, tutorials, export/validate/staleness, ask) resolves what to show
 * through this one fallback chain instead of its own "latest wins" query:
 *
 *   explicit ?package_id=  →  caller's member default  →  latest complete snapshot
 *
 * An explicit package_id that doesn't exist in the project is a 404, never a
 * silent fallback — pinning a package must not quietly show something else.
 */

import type { Request, Response } from 'express';
import { query } from '../../lib/db.js';

export interface ResolvedPackageContext {
  /** Null when resolution landed on a bare snapshot with no package (e.g. generation still running). */
  packageId: string | null;
  snapshotId: string;
  scopeId: string | null;
  role: string | null;
  /** The package's branch when a package resolved; snapshot provenance branch otherwise. */
  branch: string | null;
  commitHash: string | null;
  source: 'explicit' | 'member_default' | 'latest';
}

export class PackageNotFoundError extends Error {}
export class BadPackageParamError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validated package id from a query/body value. undefined = absent. */
export function readPackageParam(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    throw new BadPackageParamError('package_id must be a UUID');
  }
  return raw;
}

const PACKAGE_CONTEXT_SELECT = `
  SELECT op.id AS package_id, op.snapshot_id, op.scope_id, op.role, op.branch,
         op.analyzed_commit AS commit_hash
  FROM onboarding_packages op`;

export async function resolvePackageContext(opts: {
  projectId: string;
  userId?: string | null;
  packageId?: string | null;
  /** Role hint for the best-effort package pick on the "latest" fallback. */
  role?: string | null;
}): Promise<ResolvedPackageContext | null> {
  type PkgRow = {
    package_id: string; snapshot_id: string; scope_id: string | null;
    role: string | null; branch: string | null; commit_hash: string | null;
  };

  if (opts.packageId) {
    const row = (await query(
      `${PACKAGE_CONTEXT_SELECT} WHERE op.id = $1 AND op.project_id = $2`,
      [opts.packageId, opts.projectId],
    )).rows[0] as PkgRow | undefined;
    if (!row) throw new PackageNotFoundError('Package not found');
    return { packageId: row.package_id, snapshotId: row.snapshot_id, scopeId: row.scope_id,
      role: row.role, branch: row.branch, commitHash: row.commit_hash, source: 'explicit' };
  }

  if (opts.userId) {
    const row = (await query(
      `${PACKAGE_CONTEXT_SELECT}
       JOIN project_members pm ON pm.default_package_id = op.id
       WHERE pm.project_id = $1 AND pm.user_id = $2 AND op.project_id = $1`,
      [opts.projectId, opts.userId],
    )).rows[0] as PkgRow | undefined;
    if (row) {
      return { packageId: row.package_id, snapshotId: row.snapshot_id, scopeId: row.scope_id,
        role: row.role, branch: row.branch, commitHash: row.commit_hash, source: 'member_default' };
    }
  }

  const snap = (await query(
    `SELECT id, scope_id, branch, commit_hash FROM analysis_snapshots
     WHERE project_id = $1 AND status = 'complete'
     ORDER BY created_at DESC LIMIT 1`,
    [opts.projectId],
  )).rows[0] as { id: string; scope_id: string | null; branch: string | null; commit_hash: string | null } | undefined;
  if (!snap) return null;

  const pkg = (await query(
    `SELECT id, role, branch FROM onboarding_packages
     WHERE snapshot_id = $1 AND ($2::varchar IS NULL OR role = $2)
     ORDER BY created_at DESC LIMIT 1`,
    [snap.id, opts.role ?? null],
  )).rows[0] as { id: string; role: string | null; branch: string | null } | undefined;

  return {
    packageId: pkg?.id ?? null,
    snapshotId: snap.id,
    scopeId: snap.scope_id,
    role: pkg?.role ?? null,
    branch: pkg?.branch ?? snap.branch,
    commitHash: snap.commit_hash,
    source: 'latest',
  };
}

/**
 * Express adapter: resolve from ?package_id= + the authenticated member.
 * Returns `false` when the response was already written (400 bad param /
 * 404 unknown package), `null` when the project has nothing analyzed yet.
 */
export async function resolveForRequest(
  req: Request,
  res: Response,
  opts: { role?: string | null } = {},
): Promise<ResolvedPackageContext | null | false> {
  try {
    const packageId = readPackageParam(req.query.package_id);
    return await resolvePackageContext({
      projectId: String(req.params.id),
      userId: req.user?.id ?? null,
      packageId,
      role: opts.role ?? null,
    });
  } catch (err) {
    if (err instanceof BadPackageParamError) {
      res.status(400).json({ error: err.message });
      return false;
    }
    if (err instanceof PackageNotFoundError) {
      res.status(404).json({ error: 'Package not found' });
      return false;
    }
    throw err;
  }
}
