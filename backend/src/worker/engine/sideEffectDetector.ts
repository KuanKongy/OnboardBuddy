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
  // Bare `query(` helper convention (`import { query } from db`) — the
  // dot-prefixed pattern missed every such call and their UPDATE/INSERTs
  // shipped as "Data Read" workflow steps (audit §5.4).
  /(?<![.\w])query\s*\(\s*['"`\s]*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)/i,
  // Raw SQL verbs in the symbol body (template literals built before the
  // call). Case-sensitive: `UPDATE x SET` is SQL, "update the … set" is prose.
  /\b(?:INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM|TRUNCATE\s+\w)/,
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
      // callsSymbols holds callee names only; the snippet carries argument
      // text (SQL strings, queue names), which several patterns match on.
      const callsStr = [...(sym.callsSymbols ?? []), sym.snippet ?? ''].join(' ');
      if (!callsStr.trim()) continue;

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
  // One multi-VALUES INSERT per chunk — the per-row loop cost a round trip
  // per effect against the remote pooler (latency overhaul Track C).
  const persistable = effects
    .map((eff) => ({
      eff,
      nodeId:
        (eff.symbolStableKey ? nodeIdMap.get(eff.symbolStableKey) : undefined) ??
        nodeIdMap.get(eff.nodeStableKey),
    }))
    .filter((e): e is { eff: DetectedSideEffect; nodeId: string } => e.nodeId !== undefined);

  const CHUNK = 500;
  for (let i = 0; i < persistable.length; i += CHUNK) {
    const part = persistable.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = part.map(({ eff, nodeId }, j) => {
      values.push(
        snapshotId, nodeId, EFFECT_TYPE_BY_KIND[eff.kind], eff.target ?? null,
        eff.evidence ?? `Detected ${eff.kind} pattern in ${eff.filePath}${eff.symbolName ? `::${eff.symbolName}` : ''}`,
        JSON.stringify({ symbolName: eff.symbolName, detectorKind: eff.kind }),
      );
      const base = j * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, 'medium', $${base + 5}, $${base + 6})`;
    });
    await query(
      `INSERT INTO side_effects (snapshot_id, node_id, type, target, confidence, evidence, metadata)
       VALUES ${tuples.join(', ')}`,
      values,
    );
  }
}
