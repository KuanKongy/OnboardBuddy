/**
 * Incremental analyzer (doc/Pipeline.md "Incremental Updates"): when a scope
 * is re-analyzed at a new commit, diff repository files and symbols against
 * the previous snapshot, invalidate semantic records whose evidence hashes no
 * longer match, propagate staleness upward (symbol -> file -> module ->
 * service -> system) only where a child's evidence hash actually changes the
 * parent's, and insert stale_flags for affected records, sections, tutorials,
 * and packages. Unchanged symbols are never re-summarized — the
 * content-addressed record store guarantees that; this module's job is the
 * bookkeeping that tells users (and the regeneration flow) what went stale.
 */

import { query } from '../lib/db.js';
import type { EvidenceGraph, RepoInventory } from './types/analysis.js';
import type { DetectedSideEffect } from './engine/sideEffectDetector.js';
import type { ArchitectureMap } from './engine/architectureClusterer.js';
import { evidenceHashForSymbol } from './semantic/recordStore.js';
import { groupClustersIntoServices } from './semantic/synthesisPass.js';
import type { RecordLevel } from './semantic/recordTypes.js';

// ── Previous snapshot resolution ─────────────────────────────────────────────

/**
 * Latest complete snapshot of the same scope created before this one.
 * Re-scans of an old commit find nothing newer and skip the diff.
 */
export async function findPreviousSnapshot(
  scopeId: string,
  newSnapshotId: string,
): Promise<{ snapshotId: string; commitHash: string } | null> {
  const row = (await query(
    `SELECT id, commit_hash FROM analysis_snapshots
     WHERE scope_id = $1 AND id <> $2 AND status = 'complete'
       AND created_at < (SELECT created_at FROM analysis_snapshots WHERE id = $2)
     ORDER BY created_at DESC
     LIMIT 1`,
    [scopeId, newSnapshotId],
  )).rows[0] as { id: string; commit_hash: string } | undefined;
  return row ? { snapshotId: row.id, commitHash: row.commit_hash } : null;
}

// ── File diff ────────────────────────────────────────────────────────────────

export interface FileDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
}

export async function diffFiles(prevSnapshotId: string, newSnapshotId: string): Promise<FileDiff> {
  const rows = (await query(
    `SELECT COALESCE(p.stable_key, n.stable_key) AS stable_key,
            (p.stable_key IS NULL) AS is_added,
            (n.stable_key IS NULL) AS is_removed
     FROM (SELECT stable_key, hash FROM repository_files WHERE snapshot_id = $1) p
     FULL OUTER JOIN (SELECT stable_key, hash FROM repository_files WHERE snapshot_id = $2) n
       ON n.stable_key = p.stable_key
     WHERE p.stable_key IS NULL OR n.stable_key IS NULL OR p.hash <> n.hash`,
    [prevSnapshotId, newSnapshotId],
  )).rows as Array<{ stable_key: string; is_added: boolean; is_removed: boolean }>;
  const unchanged = (await query(
    `SELECT count(*)::int AS n
     FROM repository_files p JOIN repository_files n ON n.stable_key = p.stable_key
     WHERE p.snapshot_id = $1 AND n.snapshot_id = $2 AND p.hash = n.hash`,
    [prevSnapshotId, newSnapshotId],
  )).rows[0] as { n: number };
  return {
    added: rows.filter((r) => r.is_added).map((r) => r.stable_key),
    removed: rows.filter((r) => r.is_removed).map((r) => r.stable_key),
    changed: rows.filter((r) => !r.is_added && !r.is_removed).map((r) => r.stable_key),
    unchanged: unchanged.n,
  };
}

// ── Symbol AST diff ──────────────────────────────────────────────────────────

const SYMBOL_NODE_TYPES = ['function', 'method', 'class', 'interface', 'type', 'enum', 'variable'];

export interface SymbolDiffEntry {
  stableKey: string;
  filePath: string | null;
  oldHash: string | null;
  newHash: string | null;
  signatureChanged: boolean;
}

export interface SymbolDiff {
  added: SymbolDiffEntry[];
  removed: SymbolDiffEntry[];
  changed: SymbolDiffEntry[];
  unchanged: number;
}

/** Symbol-level AST diff by stable_key: body (or combined) hash + signature hash. */
export async function diffSymbols(prevSnapshotId: string, newSnapshotId: string): Promise<SymbolDiff> {
  const rows = (await query(
    `SELECT COALESCE(p.stable_key, n.stable_key) AS stable_key,
            COALESCE(n.file_path, p.file_path) AS file_path,
            p.content_hash AS old_hash, n.content_hash AS new_hash,
            (p.signature_hash IS DISTINCT FROM n.signature_hash) AS signature_changed,
            (p.stable_key IS NULL) AS is_added,
            (n.stable_key IS NULL) AS is_removed
     FROM (SELECT stable_key, file_path, COALESCE(body_hash, hash) AS content_hash, signature_hash
           FROM graph_nodes WHERE snapshot_id = $1 AND type = ANY($3)) p
     FULL OUTER JOIN
          (SELECT stable_key, file_path, COALESCE(body_hash, hash) AS content_hash, signature_hash
           FROM graph_nodes WHERE snapshot_id = $2 AND type = ANY($3)) n
       ON n.stable_key = p.stable_key
     WHERE p.stable_key IS NULL OR n.stable_key IS NULL
        OR p.content_hash IS DISTINCT FROM n.content_hash
        OR p.signature_hash IS DISTINCT FROM n.signature_hash`,
    [prevSnapshotId, newSnapshotId, SYMBOL_NODE_TYPES],
  )).rows as Array<{
    stable_key: string; file_path: string | null; old_hash: string | null; new_hash: string | null;
    signature_changed: boolean; is_added: boolean; is_removed: boolean;
  }>;
  const unchanged = (await query(
    `SELECT count(*)::int AS n
     FROM graph_nodes p JOIN graph_nodes n ON n.stable_key = p.stable_key
     WHERE p.snapshot_id = $1 AND n.snapshot_id = $2
       AND p.type = ANY($3) AND n.type = ANY($3)
       AND COALESCE(p.body_hash, p.hash) IS NOT DISTINCT FROM COALESCE(n.body_hash, n.hash)
       AND p.signature_hash IS NOT DISTINCT FROM n.signature_hash`,
    [prevSnapshotId, newSnapshotId, SYMBOL_NODE_TYPES],
  )).rows[0] as { n: number };
  const toEntry = (r: (typeof rows)[number]): SymbolDiffEntry => ({
    stableKey: r.stable_key, filePath: r.file_path,
    oldHash: r.old_hash, newHash: r.new_hash, signatureChanged: r.signature_changed,
  });
  return {
    added: rows.filter((r) => r.is_added).map(toEntry),
    removed: rows.filter((r) => r.is_removed).map(toEntry),
    changed: rows.filter((r) => !r.is_added && !r.is_removed).map(toEntry),
    unchanged: unchanged.n,
  };
}

// ── Upward invalidation (pure) ───────────────────────────────────────────────

export interface PrevRecordRef {
  recordId: string;
  stableKey: string;
  level: RecordLevel;
  evidenceHash: string;
}

export interface InvalidatedRecord extends PrevRecordRef {
  reason: string;
  newHash: string | null;
}

export interface InvalidationInput {
  prevRecords: PrevRecordRef[];
  /** Recomputed evidence hash per symbol stable_key still present in the new graph. */
  newSymbolEvidence: Map<string, string>;
  /** Files that gained or lost symbols (structure changed even if no record changed). */
  addedSymbolFiles: Set<string>;
  removedSymbolFiles: Set<string>;
  removedFiles: Set<string>;
  /** cluster stable_key -> member file stable_keys, per snapshot. */
  newClusterMembers: Map<string, Set<string>>;
  prevClusterMembers: Map<string, Set<string>>;
  /** New grouping: cluster stable_key -> service stable_key. */
  clusterToService: Map<string, string>;
  /** workflow stable_key -> deterministic step fingerprint, per snapshot. */
  prevWorkflowFingerprints: Map<string, string>;
  newWorkflowFingerprints: Map<string, string>;
}

/**
 * Staleness propagates upward only when a child's evidence hash actually
 * changes the parent's evidence (spec rule): a whitespace-only file change
 * leaves symbol hashes intact, so nothing above the file diff is invalidated.
 */
export function propagateInvalidation(input: InvalidationInput): InvalidatedRecord[] {
  const invalidated: InvalidatedRecord[] = [];
  const byLevel = (level: RecordLevel) => input.prevRecords.filter((r) => r.level === level);

  // Symbols: exact evidence-hash comparison (body, signature, callers,
  // callees, side effects, behavior signals).
  const invalidFiles = new Set<string>([...input.addedSymbolFiles, ...input.removedSymbolFiles]);
  for (const rec of byLevel('symbol')) {
    const newHash = input.newSymbolEvidence.get(rec.stableKey);
    if (newHash === undefined) {
      invalidated.push({ ...rec, reason: 'symbol_removed', newHash: null });
      invalidFiles.add(rec.stableKey.split('#')[0]!);
    } else if (newHash !== rec.evidenceHash) {
      invalidated.push({ ...rec, reason: 'evidence_changed', newHash });
      invalidFiles.add(rec.stableKey.split('#')[0]!);
    }
  }

  // Files: child symbol records changed, symbol set changed, or file gone.
  const invalidFileRecords = new Set<string>();
  for (const rec of byLevel('file')) {
    if (input.removedFiles.has(rec.stableKey)) {
      invalidated.push({ ...rec, reason: 'file_removed', newHash: null });
      invalidFileRecords.add(rec.stableKey);
    } else if (invalidFiles.has(rec.stableKey)) {
      invalidated.push({ ...rec, reason: 'children_changed', newHash: null });
      invalidFileRecords.add(rec.stableKey);
    }
  }

  // Modules (= architecture clusters): cluster gone, membership changed, or a
  // member file record invalidated.
  const invalidModules = new Set<string>();
  const sameMembers = (a: Set<string>, b: Set<string>) =>
    a.size === b.size && [...a].every((m) => b.has(m));
  for (const rec of byLevel('module')) {
    const next = input.newClusterMembers.get(rec.stableKey);
    const prev = input.prevClusterMembers.get(rec.stableKey) ?? new Set<string>();
    if (!next) {
      invalidated.push({ ...rec, reason: 'cluster_removed', newHash: null });
      invalidModules.add(rec.stableKey);
    } else if (!sameMembers(prev, next)) {
      invalidated.push({ ...rec, reason: 'membership_changed', newHash: null });
      invalidModules.add(rec.stableKey);
    } else if ([...next].some((f) => invalidFileRecords.has(f))) {
      invalidated.push({ ...rec, reason: 'children_changed', newHash: null });
      invalidModules.add(rec.stableKey);
    }
  }

  // Services: any invalidated module maps into it (new grouping), or gone.
  const invalidServices = new Set<string>();
  const liveServices = new Set(input.clusterToService.values());
  for (const rec of byLevel('service')) {
    if (!liveServices.has(rec.stableKey)) {
      invalidated.push({ ...rec, reason: 'service_removed', newHash: null });
      invalidServices.add(rec.stableKey);
    } else if ([...invalidModules].some((m) => input.clusterToService.get(m) === rec.stableKey)) {
      invalidated.push({ ...rec, reason: 'children_changed', newHash: null });
      invalidServices.add(rec.stableKey);
    }
  }

  // Workflows: deterministic step fingerprint (order, location, node hashes).
  const invalidWorkflows = new Set<string>();
  for (const rec of byLevel('workflow')) {
    const next = input.newWorkflowFingerprints.get(rec.stableKey);
    const prev = input.prevWorkflowFingerprints.get(rec.stableKey);
    if (next === undefined) {
      invalidated.push({ ...rec, reason: 'workflow_removed', newHash: null });
      invalidWorkflows.add(rec.stableKey);
    } else if (prev !== undefined && prev !== next) {
      invalidated.push({ ...rec, reason: 'steps_changed', newHash: null });
      invalidWorkflows.add(rec.stableKey);
    }
  }

  // System + capabilities: any structural change below reaches them.
  const anyBelow =
    invalidFileRecords.size > 0 || invalidModules.size > 0 ||
    invalidServices.size > 0 || invalidWorkflows.size > 0 ||
    invalidated.some((r) => r.level === 'symbol');
  if (anyBelow) {
    for (const rec of input.prevRecords.filter((r) => r.level === 'system' || r.level === 'capability')) {
      invalidated.push({ ...rec, reason: 'children_changed', newHash: null });
    }
  }
  return invalidated;
}

// ── Stale flags ──────────────────────────────────────────────────────────────

async function insertRecordFlags(
  newSnapshotId: string,
  invalidated: InvalidatedRecord[],
): Promise<void> {
  for (const rec of invalidated) {
    const changedFiles =
      rec.level === 'symbol' ? [rec.stableKey.split('#')[0]!] :
      rec.level === 'file' ? [rec.stableKey] : [];
    await query(
      `INSERT INTO stale_flags
         (snapshot_id, target_type, target_id, target_stable_key, reason, old_hash, new_hash, record_id, changed_files)
       VALUES ($1, 'semantic_record', $2, $3, $4, $5, $6, $2, $7)`,
      [newSnapshotId, rec.recordId, rec.stableKey, rec.reason, rec.evidenceHash, rec.newHash, changedFiles],
    );
  }
}

interface ArtifactStaleness {
  staleSections: number;
  staleTutorials: number;
  stalePackages: number;
}

/**
 * Sections/tutorials citing changed evidence go stale (and their packages
 * with them); regeneration is on request, against the newer snapshot.
 */
async function flagStaleArtifacts(params: {
  projectId: string;
  scopeId: string;
  newSnapshotId: string;
  newCommit: string;
  changedFilePaths: string[];
  changedSymbolKeys: string[];
  invalidatedRecordIds: string[];
}): Promise<ArtifactStaleness> {
  const { projectId, scopeId, newSnapshotId, newCommit } = params;

  // Documentation changes stale doc-derived content even without code
  // changes: doc receipts key as `doc:<path>#<slug>` (prefix-match them), and
  // doc_health's deterministic basis IS the doc set — a changed README with
  // zero code edits used to flag nothing at all.
  const docNodePatterns = params.changedFilePaths.map((f) => `doc:${f}%`);
  const changedDocFiles = params.changedFilePaths.length > 0
    ? ((await query(
        `SELECT stable_key FROM repository_files
         WHERE snapshot_id = $1 AND stable_key = ANY($2) AND category = 'doc'`,
        [newSnapshotId, params.changedFilePaths],
      )).rows as Array<{ stable_key: string }>).map((r) => r.stable_key)
    : [];
  const docStaleTypes: string[] = [];
  if (changedDocFiles.length > 0) {
    docStaleTypes.push('doc_health');
    // The repo orientation leans on the README specifically.
    if (changedDocFiles.some((f) => /(^|\/)readme\.(md|rst|txt)$/i.test(f))) docStaleTypes.push('start_here');
  }

  const sections = (await query(
    `SELECT DISTINCT ps.id, ps.type, ps.role, ps.package_id
     FROM package_sections ps
     JOIN onboarding_packages op ON op.id = ps.package_id
     WHERE op.project_id = $1 AND op.scope_id = $2 AND op.analyzed_commit <> $3
       AND ps.review_status <> 'stale'
       AND (
         ps.type = ANY($7)
         OR EXISTS (
           SELECT 1 FROM source_receipts r
           WHERE r.section_id = ps.id
             AND (r.file_path = ANY($4) OR r.node_stable_key = ANY($5)
                  OR r.node_stable_key LIKE ANY($8)
                  OR r.referenced_record_id = ANY($6::uuid[]))
         )
       )`,
    [projectId, scopeId, newCommit, params.changedFilePaths, params.changedSymbolKeys,
     params.invalidatedRecordIds, docStaleTypes, docNodePatterns],
  )).rows as Array<{ id: string; type: string; role: string | null; package_id: string }>;
  for (const s of sections) {
    await query(
      `INSERT INTO stale_flags
         (snapshot_id, target_type, target_id, target_stable_key, reason, section_id, package_id, changed_files)
       VALUES ($1, 'package_section', $2, $3, 'cited_evidence_changed', $2, $4, $5)`,
      [newSnapshotId, s.id, `section:${s.type}:${s.role ?? 'general'}`, s.package_id,
       params.changedFilePaths.slice(0, 50)],
    );
    await query(`UPDATE package_sections SET review_status = 'stale' WHERE id = $1`, [s.id]);
  }

  const tutorials = (await query(
    `SELECT DISTINCT t.id, t.stable_key, t.package_id
     FROM tutorials t
     JOIN onboarding_packages op ON op.id = t.package_id
     WHERE op.project_id = $1 AND op.scope_id = $2 AND op.analyzed_commit <> $3
       AND t.status <> 'stale'
       AND EXISTS (
         SELECT 1 FROM tutorial_steps ts
         WHERE ts.tutorial_id = t.id AND ts.file_path = ANY($4)
       )`,
    [projectId, scopeId, newCommit, params.changedFilePaths],
  )).rows as Array<{ id: string; stable_key: string; package_id: string | null }>;
  for (const t of tutorials) {
    await query(
      `INSERT INTO stale_flags
         (snapshot_id, target_type, target_id, target_stable_key, reason, package_id, changed_files)
       VALUES ($1, 'tutorial', $2, $3, 'step_files_changed', $4, $5)`,
      [newSnapshotId, t.id, t.stable_key, t.package_id, params.changedFilePaths.slice(0, 50)],
    );
    await query(`UPDATE tutorials SET status = 'stale', updated_at = NOW() WHERE id = $1`, [t.id]);
  }

  const packageIds = [...new Set([
    ...sections.map((s) => s.package_id),
    ...tutorials.map((t) => t.package_id).filter((p): p is string => p !== null),
  ])];
  for (const pkgId of packageIds) {
    await query(
      `INSERT INTO stale_flags
         (snapshot_id, target_type, target_id, target_stable_key, reason, package_id, changed_files)
       VALUES ($1, 'package', $2, $3, 'contains_stale_content', $2, $4)`,
      [newSnapshotId, pkgId, `package:${pkgId}`, params.changedFilePaths.slice(0, 50)],
    );
    await query(`UPDATE onboarding_packages SET status = 'stale', updated_at = NOW() WHERE id = $1`, [pkgId]);
  }

  return { staleSections: sections.length, staleTutorials: tutorials.length, stalePackages: packageIds.length };
}

/**
 * After a section regeneration: the package leaves 'stale' once no stale
 * sections remain, and its package-level stale flags resolve. (Section-level
 * flags cascade away when the stale section row is replaced.)
 */
export async function settlePackageStaleness(packageId: string): Promise<{ stale: boolean }> {
  const row = (await query(
    `UPDATE onboarding_packages op
     SET status = CASE WHEN EXISTS (
           SELECT 1 FROM package_sections ps
           WHERE ps.package_id = op.id AND ps.review_status = 'stale'
         ) THEN 'stale' ELSE 'draft' END,
         updated_at = NOW()
     WHERE op.id = $1
     RETURNING status`,
    [packageId],
  )).rows[0] as { status: string } | undefined;
  const stale = row?.status === 'stale';
  if (!stale) {
    await query(
      `UPDATE stale_flags SET resolved_at = NOW()
       WHERE package_id = $1 AND target_type = 'package' AND resolved_at IS NULL`,
      [packageId],
    );
  }
  return { stale };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface IncrementalDiffInput {
  projectId: string;
  scopeId: string;
  snapshotId: string;
  commitHash: string;
  prevSnapshotId: string;
  prevCommitHash: string;
  graph: EvidenceGraph;
  sideEffects: DetectedSideEffect[];
  architecture: ArchitectureMap;
  inventory: RepoInventory;
}

export interface IncrementalDiffResult {
  files: FileDiff;
  symbols: SymbolDiff;
  invalidated: InvalidatedRecord[];
  artifacts: ArtifactStaleness;
  metrics: Record<string, unknown>;
}

async function loadPrevActiveRecords(prevSnapshotId: string): Promise<PrevRecordRef[]> {
  const rows = (await query(
    `SELECT ssr.record_id, ssr.stable_key, ssr.record_level, sr.evidence_hash
     FROM snapshot_semantic_records ssr
     JOIN semantic_records sr ON sr.id = ssr.record_id
     WHERE ssr.snapshot_id = $1`,
    [prevSnapshotId],
  )).rows as Array<{ record_id: string; stable_key: string; record_level: RecordLevel; evidence_hash: string }>;
  return rows.map((r) => ({
    recordId: r.record_id, stableKey: r.stable_key, level: r.record_level, evidenceHash: r.evidence_hash,
  }));
}

async function loadClusterMembers(snapshotId: string): Promise<Map<string, Set<string>>> {
  const rows = (await query(
    `SELECT c.stable_key AS cluster_key, gn.stable_key AS member_key
     FROM architecture_clusters c
     JOIN architecture_cluster_members m ON m.cluster_id = c.id
     JOIN graph_nodes gn ON gn.id = m.node_id
     WHERE c.snapshot_id = $1`,
    [snapshotId],
  )).rows as Array<{ cluster_key: string; member_key: string }>;
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.cluster_key)) map.set(r.cluster_key, new Set());
    map.get(r.cluster_key)!.add(r.member_key);
  }
  return map;
}

async function loadWorkflowFingerprints(snapshotId: string): Promise<Map<string, string>> {
  const rows = (await query(
    `SELECT w.stable_key,
            md5(COALESCE(jsonb_agg(
              jsonb_build_array(ws.step_order, ws.file_path, ws.symbol_name, gn.hash)
              ORDER BY ws.step_order)::text, '')) AS fp
     FROM workflows w
     LEFT JOIN workflow_steps ws ON ws.workflow_id = w.id
     LEFT JOIN graph_nodes gn ON gn.id = ws.node_id
     WHERE w.snapshot_id = $1
     GROUP BY w.stable_key`,
    [snapshotId],
  )).rows as Array<{ stable_key: string; fp: string }>;
  return new Map(rows.map((r) => [r.stable_key, r.fp]));
}

export async function runIncrementalDiff(input: IncrementalDiffInput): Promise<IncrementalDiffResult> {
  const files = await diffFiles(input.prevSnapshotId, input.snapshotId);
  const symbols = await diffSymbols(input.prevSnapshotId, input.snapshotId);
  const prevRecords = await loadPrevActiveRecords(input.prevSnapshotId);

  // Exact evidence hashes for the symbols the previous snapshot had records
  // for — the same computation the symbol pass will use, so "invalidated
  // here" and "cache miss there" agree.
  const nodeByKey = new Map(input.graph.nodes.map((n) => [n.stableKey, n]));
  const newSymbolEvidence = new Map<string, string>();
  for (const rec of prevRecords) {
    if (rec.level !== 'symbol') continue;
    const node = nodeByKey.get(rec.stableKey);
    if (node) newSymbolEvidence.set(rec.stableKey, evidenceHashForSymbol(node, input.graph, input.sideEffects));
  }

  const fileOf = (e: SymbolDiffEntry) => e.filePath ?? e.stableKey.split('#')[0]!;
  const invalidated = propagateInvalidation({
    prevRecords,
    newSymbolEvidence,
    addedSymbolFiles: new Set(symbols.added.map(fileOf)),
    removedSymbolFiles: new Set(symbols.removed.map(fileOf)),
    removedFiles: new Set(files.removed),
    newClusterMembers: new Map(input.architecture.clusters.map((c) => [
      c.stableKey, new Set(c.members.map((m) => m.nodeStableKey)),
    ])),
    prevClusterMembers: await loadClusterMembers(input.prevSnapshotId),
    clusterToService: new Map(
      groupClustersIntoServices({ inventory: input.inventory, architecture: input.architecture })
        .flatMap((s) => s.clusterKeys.map((c) => [c, s.stableKey] as [string, string])),
    ),
    prevWorkflowFingerprints: await loadWorkflowFingerprints(input.prevSnapshotId),
    newWorkflowFingerprints: await loadWorkflowFingerprints(input.snapshotId),
  });

  await insertRecordFlags(input.snapshotId, invalidated);

  const changedFilePaths = [...new Set([...files.changed, ...files.removed])];
  const changedSymbolKeys = [
    ...symbols.changed.map((s) => s.stableKey),
    ...symbols.removed.map((s) => s.stableKey),
  ];
  const artifacts = await flagStaleArtifacts({
    projectId: input.projectId,
    scopeId: input.scopeId,
    newSnapshotId: input.snapshotId,
    newCommit: input.commitHash,
    changedFilePaths,
    changedSymbolKeys,
    invalidatedRecordIds: invalidated.map((r) => r.recordId),
  });

  const byLevel: Record<string, number> = {};
  for (const r of invalidated) byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
  return {
    files, symbols, invalidated, artifacts,
    metrics: {
      previousSnapshotId: input.prevSnapshotId,
      previousCommit: input.prevCommitHash,
      filesAdded: files.added.length,
      filesRemoved: files.removed.length,
      filesChanged: files.changed.length,
      filesUnchanged: files.unchanged,
      symbolsAdded: symbols.added.length,
      symbolsRemoved: symbols.removed.length,
      symbolsChanged: symbols.changed.length,
      symbolsUnchanged: symbols.unchanged,
      invalidatedRecords: invalidated.length,
      invalidatedByLevel: byLevel,
      ...artifacts,
    },
  };
}
