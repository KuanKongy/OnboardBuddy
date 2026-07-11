import { query } from '../../lib/db.js';

export interface ValidationResult {
  sectionId: string;
  sectionType: string;
  valid: boolean;
  receiptCount: number;
  issues: string[];
}

export async function validateSectionCitations(packageId: string): Promise<ValidationResult[]> {
  const sectionsResult = await query(
    `SELECT ps.id, ps.type, ps.content, ps.confidence
     FROM package_sections ps
     WHERE ps.package_id = $1`,
    [packageId],
  );

  const results: ValidationResult[] = [];

  for (const sec of sectionsResult.rows as Array<{ id: string; type: string; content: string; confidence: string }>) {
    const receiptsResult = await query(
      `SELECT id, file_path, node_stable_key, confidence FROM source_receipts WHERE section_id = $1`,
      [sec.id],
    );

    const issues: string[] = [];
    const receiptCount = receiptsResult.rows.length;

    if (receiptCount === 0) {
      issues.push('No source receipts — section has no evidence backing');
    }

    if (sec.content.length > 500 && receiptCount < 2) {
      issues.push('Long section with fewer than 2 receipts — may contain uncited claims');
    }

    const orphanedReceipts = (receiptsResult.rows as Array<{ node_stable_key: string | null }>)
      .filter((r) => !r.node_stable_key);
    if (orphanedReceipts.length > 0) {
      issues.push(`${orphanedReceipts.length} receipt(s) with no stable_key — cannot track staleness`);
    }

    results.push({
      sectionId: sec.id,
      sectionType: sec.type,
      valid: issues.length === 0,
      receiptCount,
      issues,
    });
  }

  return results;
}

export async function checkReceiptStaleness(
  currentSnapshotId: string,
  previousSnapshotId: string,
): Promise<Array<{ receiptId: string; sectionId: string; reason: string }>> {
  const staleReceipts: Array<{ receiptId: string; sectionId: string; reason: string }> = [];

  const receiptsResult = await query(
    `SELECT sr.id AS receipt_id, sr.section_id, sr.node_stable_key, sr.node_hash, sr.file_path
     FROM source_receipts sr
     JOIN package_sections ps ON ps.id = sr.section_id
     JOIN onboarding_packages op ON op.id = ps.package_id
     WHERE op.snapshot_id = $1 AND sr.node_stable_key IS NOT NULL`,
    [previousSnapshotId],
  );

  for (const receipt of receiptsResult.rows as Array<{
    receipt_id: string;
    section_id: string;
    node_stable_key: string;
    node_hash: string;
    file_path: string;
  }>) {
    const currentNode = await query(
      `SELECT hash FROM graph_nodes WHERE snapshot_id = $1 AND stable_key = $2`,
      [currentSnapshotId, receipt.node_stable_key],
    );

    if (currentNode.rows.length === 0) {
      staleReceipts.push({
        receiptId: receipt.receipt_id,
        sectionId: receipt.section_id,
        reason: `File removed: ${receipt.file_path}`,
      });
    } else {
      const currentHash = (currentNode.rows[0] as { hash: string }).hash;
      if (currentHash !== receipt.node_hash) {
        staleReceipts.push({
          receiptId: receipt.receipt_id,
          sectionId: receipt.section_id,
          reason: `File modified: ${receipt.file_path} (hash changed)`,
        });
      }
    }
  }

  return staleReceipts;
}

export async function createStaleFlags(
  snapshotId: string,
  staleReceipts: Array<{ receiptId: string; sectionId: string; reason: string }>,
): Promise<void> {
  const sectionReasons = new Map<string, string[]>();
  for (const sr of staleReceipts) {
    const existing = sectionReasons.get(sr.sectionId) ?? [];
    existing.push(sr.reason);
    sectionReasons.set(sr.sectionId, existing);
  }

  for (const [sectionId, reasons] of sectionReasons) {
    const changedFiles = reasons.map((r) => r.replace(/^(File removed|File modified): /, '').replace(/ \(hash changed\)$/, ''));

    await query(
      `INSERT INTO stale_flags (snapshot_id, target_type, target_id, target_stable_key, reason, changed_files, section_id)
       VALUES ($1, 'package_section', $2, $3, $4, $5, $2)
       ON CONFLICT DO NOTHING`,
      [snapshotId, sectionId, `section:${sectionId}`, reasons.join('; '), changedFiles],
    );

    await query(
      `UPDATE package_sections SET review_status = 'stale' WHERE id = $1 AND review_status != 'stale'`,
      [sectionId],
    );
  }
}
