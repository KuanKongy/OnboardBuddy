import type { FileAnalysis } from '../types/analysis.js';
import { query } from '../../lib/db.js';

export interface DetectedSideEffect {
  nodeStableKey: string;
  kind: 'database_write' | 'http_call' | 'file_write' | 'message_publish' | 'email_send' | 'cache_write';
  target?: string;
  filePath: string;
  symbolName?: string;
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
        if (pattern.test(callsStr)) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'database_write',
            filePath: relativePath,
            symbolName: sym.name,
          });
          break;
        }
      }

      for (const pattern of HTTP_CALL_PATTERNS) {
        if (pattern.test(callsStr)) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'http_call',
            filePath: relativePath,
            symbolName: sym.name,
          });
          break;
        }
      }

      for (const pattern of FILE_WRITE_PATTERNS) {
        if (pattern.test(callsStr)) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'file_write',
            filePath: relativePath,
            symbolName: sym.name,
          });
          break;
        }
      }

      for (const pattern of MESSAGE_PATTERNS) {
        if (pattern.test(callsStr)) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'message_publish',
            filePath: relativePath,
            symbolName: sym.name,
          });
          break;
        }
      }

      for (const pattern of EMAIL_PATTERNS) {
        if (pattern.test(callsStr)) {
          effects.push({
            nodeStableKey: relativePath,
            kind: 'email_send',
            filePath: relativePath,
            symbolName: sym.name,
          });
          break;
        }
      }
    }
  }

  return effects;
}

export async function persistSideEffects(
  snapshotId: string,
  effects: DetectedSideEffect[],
  nodeIdMap: Map<string, string>,
): Promise<void> {
  for (const eff of effects) {
    const nodeId = nodeIdMap.get(eff.nodeStableKey);
    if (!nodeId) continue;

    await query(
      `INSERT INTO side_effects (snapshot_id, node_id, kind, target, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        snapshotId,
        nodeId,
        eff.kind,
        eff.target ?? null,
        JSON.stringify({ symbolName: eff.symbolName }),
      ],
    );
  }
}
