import * as path from 'node:path';

/**
 * Privacy filter: secret-bearing files never enter the analysis in ANY
 * privacy mode — they are dropped at ingestion, before parsing, snippets,
 * or inventory metadata are produced.
 */

const SECRET_BASENAMES = new Set([
  '.env',
  '.envrc',
  '.npmrc',
  '.netrc',
  '.pgpass',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials.json',
  'service-account.json',
  '.htpasswd',
]);

const SECRET_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.crt',
  '.cer',
  '.der',
]);

const SECRET_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,          // .env, .env.local, .env.production, ...
  /secret/i,
  /credential/i,
  /(^|\/)\.aws\//,
  /(^|\/)\.ssh\//,
];

/** Explicitly allowed despite matching a pattern: example/template env files. */
const ALLOWED_PATTERNS = [/\.env\.(example|sample|template)$/i, /example\.env$/i];

export function isSecretPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (ALLOWED_PATTERNS.some((p) => p.test(normalized))) return false;

  const base = path.posix.basename(normalized);
  if (SECRET_BASENAMES.has(base)) return true;
  if (SECRET_EXTENSIONS.has(path.posix.extname(base))) return true;
  return SECRET_PATTERNS.some((p) => p.test(normalized));
}

/** Filters a list of repo-relative paths down to privacy-safe ones. */
export function applyPrivacyFilter<T extends { relativePath: string }>(entries: T[]): {
  kept: T[];
  droppedCount: number;
} {
  const kept = entries.filter((e) => !isSecretPath(e.relativePath));
  return { kept, droppedCount: entries.length - kept.length };
}
