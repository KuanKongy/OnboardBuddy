import type { FileAnalysis } from '../types/analysis.js';
import { query } from '../../lib/db.js';

export interface DetectedSideEffect {
  /** File-level key (relative path) — used by workflow traversal. */
  nodeStableKey: string;
  kind: 'database_write' | 'http_call' | 'file_write' | 'message_publish' | 'email_send' | 'cache_write';
  target?: string;
  filePath: string;
  symbolName?: string;
  /** Symbol-level key (`path#Symbol`) of the symbol performing the effect. */
  symbolStableKey?: string;
  /** The matched call expression that triggered the detection */
  evidence?: string;
}

const DB_WRITE_PATTERNS = [
  /\.query\s*\(\s*['"`]\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i,
  /\.create\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(/,
  /\.save\s*\(/,
  /\.upsert\s*\(/,
  /\.destroy\s*\(/,
];

const HTTP_CALL_PATTERNS = [
  /fetch\s*\(/,
  /axios\./,
  /\.request\s*\(/,
  /http\./,
];

const FILE_WRITE_PATTERNS = [
  /fs\.(write|append|mkdir|rm|unlink)/,
  /writeFile/,
  /createWriteStream/,
];

const MESSAGE_PATTERNS = [
  /\.publish\s*\(/,
  /\.send\s*\(/,
  /\.emit\s*\(/,
  /\.add\s*\(\s*['"`]/,  // BullMQ queue.add
  /queue\.add/,
];

const EMAIL_PATTERNS = [
  /sendMail/,
  /sendEmail/,
  /transporter\.send/,
];

const _CACHE_PATTERNS = [
  /\.set\s*\(/,
  /cache\./,
  /redis\./,
];

export function detectSideEffects(fileAnalyses: FileAnalysis[]): DetectedSideEffect[] {
  const effects: DetectedSideEffect[] = [];

  for (const fa of fileAnalyses) {
    const relativePath = fa.relativePath;

    for (const sym of fa.symbols) {
      if (!sym.callsSymbols) continue;

      const callsStr = sym.callsSymbols.join(' ');

      for (const pattern of DB_WRITE_PATTERNS) {
        const match = callsStr.match(pattern);
        if (match) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'database_write',
            filePath: relativePath,
            symbolName: sym.name,
            symbolStableKey: `${relativePath}#${sym.name}`,
            evidence: match[0],
          });
          break;
        }
      }

      for (const pattern of HTTP_CALL_PATTERNS) {
        const match = callsStr.match(pattern);
        if (match) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'http_call',
            filePath: relativePath,
            symbolName: sym.name,
            symbolStableKey: `${relativePath}#${sym.name}`,
            evidence: match[0],
          });
          break;
        }
      }

      for (const pattern of FILE_WRITE_PATTERNS) {
        const match = callsStr.match(pattern);
        if (match) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'file_write',
            filePath: relativePath,
            symbolName: sym.name,
            symbolStableKey: `${relativePath}#${sym.name}`,
            evidence: match[0],
          });
          break;
        }
      }

      for (const pattern of MESSAGE_PATTERNS) {
        const match = callsStr.match(pattern);
        if (match) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'message_publish',
            filePath: relativePath,
            symbolName: sym.name,
            symbolStableKey: `${relativePath}#${sym.name}`,
            evidence: match[0],
          });
          break;
        }
      }

      for (const pattern of EMAIL_PATTERNS) {
        const match = callsStr.match(pattern);
        if (match) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'email_send',
            filePath: relativePath,
            symbolName: sym.name,
            symbolStableKey: `${relativePath}#${sym.name}`,
            evidence: match[0],
          });
          break;
        }
      }
    }
  }

  return effects;
}

// Maps detector kinds onto the side_effects.type enum
const EFFECT_TYPE_BY_KIND: Record<DetectedSideEffect['kind'], string> = {
  database_write: 'database_write',
  http_call: 'http_request',
  file_write: 'filesystem_write',
  message_publish: 'queue_enqueue',
  email_send: 'external_integration',
  cache_write: 'external_integration',
};

export async function persistSideEffects(
  snapshotId: string,
  effects: DetectedSideEffect[],
  nodeIdMap: Map<string, string>,
): Promise<void> {
  for (const eff of effects) {
    // Prefer the symbol-level node; fall back to the file node.
    const nodeId =
      (eff.symbolStableKey ? nodeIdMap.get(eff.symbolStableKey) : undefined) ??
      nodeIdMap.get(eff.nodeStableKey);
    if (!nodeId) continue;

    await query(
      `INSERT INTO side_effects (snapshot_id, node_id, type, target, confidence, evidence, metadata)
       VALUES ($1, $2, $3, $4, 'medium', $5, $6)`,
      [
        snapshotId,
        nodeId,
        EFFECT_TYPE_BY_KIND[eff.kind],
        eff.target ?? null,
        eff.evidence ?? `Detected ${eff.kind} pattern in ${eff.filePath}${eff.symbolName ? `::${eff.symbolName}` : ''}`,
        JSON.stringify({ symbolName: eff.symbolName, detectorKind: eff.kind }),
      ],
    );
  }
}
