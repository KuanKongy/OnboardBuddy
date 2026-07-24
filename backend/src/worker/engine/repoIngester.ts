import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { simpleGit } from 'simple-git';
import type {
  FileEntry,
  RepoIndex,
  SupportedLanguage,
  RepoFileRecord,
  FileCategory,
  LanguageInventory,
  RepoInventory,
  RepoPackage,
  RepoConfigFile,
} from '../types/analysis.js';
import { isSecretPath } from './privacyFilter.js';
import { sha256 } from './hashUtils.js';
import { normalizePath } from './stableKeys.js';

const TS_EXTENSIONS = new Set(['.ts', '.tsx']);
const _JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.min.js',
  // Embedded fixture apps are test DATA, not product code. Analyzing them
  // polluted rankings, workflows and diagrams (a fixture's InsightFacade.ts
  // once out-ranked real API routes; traces cited fixture SQL as the app
  // schema). Tests themselves stay analyzed — only fixture trees are cut.
  // Note: these only apply when a scanned repo CONTAINS such dirs; test
  // suites that scan a fixture dir as the root are unaffected.
  '**/fixtures/**',
  '**/__fixtures__/**',
  '**/__mocks__/**',
  '**/testdata/**',
];

export async function cloneRepo(githubUrl: string, targetDir: string): Promise<string> {
  const git = simpleGit();
  await git.clone(githubUrl, targetDir, ['--depth', '1']);
  return targetDir;
}

export interface RepoIndexOptions {
  ignoredPaths?: string[];
  fileLimit?: number;
  /** Scope boundary: only files under this repo-relative prefix ('' = whole repo). */
  pathPrefix?: string;
}

export async function buildRepoIndex(rootPath: string, options?: RepoIndexOptions): Promise<RepoIndex> {
  const absRoot = path.resolve(rootPath);

  if (!fs.existsSync(absRoot)) {
    throw new Error(`Repo path does not exist: ${absRoot}`);
  }

  const ignorePatterns = [
    ...IGNORE_PATTERNS,
    ...(options?.ignoredPaths ?? []),
  ];

  const allFiles = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs}', {
    cwd: absRoot,
    ignore: ignorePatterns,
    absolute: true,
  });

  const prefix = options?.pathPrefix ? normalizePath(options.pathPrefix).replace(/\/+$/, '') + '/' : '';
  const inScope = allFiles.filter((absPath) => {
    const rel = normalizePath(path.relative(absRoot, absPath));
    if (isSecretPath(rel)) return false;
    return prefix === '' || rel.startsWith(prefix);
  });

  const filesToProcess = options?.fileLimit
    ? inScope.slice(0, options.fileLimit)
    : inScope;

  const entries: FileEntry[] = await Promise.all(
    filesToProcess.map(async (absPath) => {
      const ext = path.extname(absPath);
      const language: SupportedLanguage = TS_EXTENSIONS.has(ext) ? 'typescript' : 'javascript';
      const stat = await fs.promises.stat(absPath);

      return {
        relativePath: path.relative(absRoot, absPath),
        absolutePath: absPath,
        language,
        sizeBytes: stat.size,
      };
    }),
  );

  const tsCount = entries.filter((e) => e.language === 'typescript').length;
  const detectedLanguage: SupportedLanguage = tsCount >= entries.length / 2 ? 'typescript' : 'javascript';

  return {
    rootPath: absRoot,
    files: entries,
    detectedLanguage,
    scannedAt: new Date(),
  };
}

export function filterByLanguage(index: RepoIndex, lang: SupportedLanguage): FileEntry[] {
  return index.files.filter((f) => f.language === lang);
}

// ─── Full repository file scan (every file, not just parseable source) ───────

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rb': 'ruby', '.java': 'java', '.kt': 'kotlin',
  '.cs': 'csharp', '.php': 'php', '.rs': 'rust', '.swift': 'swift', '.scala': 'scala',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.vue': 'vue', '.svelte': 'svelte',
  '.html': 'html', '.css': 'css', '.scss': 'css', '.less': 'css',
  '.sql': 'sql', '.prisma': 'prisma',
  '.md': 'markdown', '.mdx': 'markdown', '.rst': 'restructuredtext', '.txt': 'text',
  '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.xml': 'xml',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.ps1': 'powershell',
};

/** Languages OnboardBuddy can actually parse into symbols today. */
export const PARSEABLE_LANGUAGES = new Set(['typescript', 'javascript']);

/** Source-like languages: counted as "unsupported" (not evidence-only) when unparseable. */
const PROGRAMMING_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'go', 'ruby', 'java', 'kotlin', 'csharp',
  'php', 'rust', 'swift', 'scala', 'c', 'cpp', 'vue', 'svelte', 'html', 'css',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.gz', '.tar', '.pdf', '.wasm', '.map',
  '.mp3', '.mp4', '.mov', '.avi',
]);

const MAX_INVENTORY_FILES = 20_000;
const MAX_HASH_FILE_BYTES = 2 * 1024 * 1024;

function classifyCategory(relativePath: string, language: string): FileCategory {
  const p = relativePath.toLowerCase();
  const base = path.posix.basename(p);

  if (/\.(test|spec)\.[jt]sx?$/.test(p) || /(^|\/)(__tests__|tests?|e2e|cypress)\//.test(p)) return 'test';
  if (language === 'sql' && /migrat/.test(p)) return 'migration';
  if (language === 'sql' || language === 'prisma' || base === 'schema.json') return 'schema';
  if (
    base === 'package.json' || base.startsWith('tsconfig') || base === 'dockerfile' ||
    base.startsWith('dockerfile.') || isComposeFile(base) ||
    /vite\.config|vitest\.config|eslint|prettier|babel\.config|jest\.config|rollup\.config|webpack\.config/.test(base) ||
    /(^|\/)\.github\/workflows\//.test(p) ||
    /\.env\.(example|sample|template)$/.test(base) ||
    base === 'vercel.json' || base === 'netlify.toml' || base === 'procfile' ||
    (language === 'yaml' && !/(^|\/)(docs?|content)\//.test(p)) || language === 'toml'
  ) return 'config';
  if (language === 'markdown' || language === 'restructuredtext' || base === 'license' || /(^|\/)docs?\//.test(p)) return 'doc';
  if (language === 'shell' || language === 'powershell' || /(^|\/)(bin|scripts)\//.test(p)) return 'script';
  if (BINARY_EXTENSIONS.has(path.posix.extname(base))) return 'asset';
  if (PROGRAMMING_LANGUAGES.has(language)) return 'source';
  return 'other';
}

function trustForCategory(category: FileCategory): RepoFileRecord['trustLevel'] {
  switch (category) {
    case 'test': return 'tests';
    case 'config':
    case 'schema':
    case 'migration': return 'config';
    case 'doc': return 'docs';
    default: return 'code';
  }
}

export interface ScanRepositoryFilesOptions {
  ignoredPaths?: string[];
  pathPrefix?: string;
  fileLimit?: number;
}

/**
 * Scans EVERY file in the repo (privacy-filtered, ignore-filtered) into
 * RepoFileRecords: this is the basis for the language inventory/guardrail,
 * repository_files persistence, docs/config ingestion, and preflight.
 * Root-level inventory files (package.json, compose, deploy configs) are
 * always included even when a scope prefix is set, so scope proposal and
 * framework detection keep working for sub-scopes.
 */
export async function scanRepositoryFiles(
  rootPath: string,
  options?: ScanRepositoryFilesOptions,
): Promise<RepoFileRecord[]> {
  const absRoot = path.resolve(rootPath);
  const ignorePatterns = [...IGNORE_PATTERNS, ...(options?.ignoredPaths ?? [])];

  const allFiles = await glob('**/*', {
    cwd: absRoot,
    ignore: ignorePatterns,
    absolute: true,
    nodir: true,
    dot: true,
  });

  const prefix = options?.pathPrefix ? normalizePath(options.pathPrefix).replace(/\/+$/, '') + '/' : '';
  const limit = Math.min(options?.fileLimit ?? MAX_INVENTORY_FILES, MAX_INVENTORY_FILES);

  const records: RepoFileRecord[] = [];
  for (const absPath of allFiles) {
    if (records.length >= limit) break;
    const rel = normalizePath(path.relative(absRoot, absPath));
    if (isSecretPath(rel)) continue;
    if (prefix !== '' && !rel.startsWith(prefix) && !isRootInventoryFile(rel)) continue;

    const ext = path.posix.extname(rel).toLowerCase();
    const base = path.posix.basename(rel).toLowerCase();
    const language = LANGUAGE_BY_EXT[ext] ?? (base === 'dockerfile' ? 'dockerfile' : 'other');
    const category = classifyCategory(rel, language);

    let sizeBytes = 0;
    let hash = '';
    let lineCount: number | null = null;
    try {
      const stat = await fs.promises.stat(absPath);
      sizeBytes = stat.size;
      if (sizeBytes <= MAX_HASH_FILE_BYTES && !BINARY_EXTENSIONS.has(ext)) {
        const content = await fs.promises.readFile(absPath, 'utf8');
        hash = sha256(content);
        lineCount = content.split('\n').length;
      } else if (sizeBytes <= MAX_HASH_FILE_BYTES) {
        // Binary files hash their bytes — the old `rel:size:mtime` formula
        // used the zipball EXTRACTION time, so every PDF "changed" on every
        // run and polluted incremental diffs with false churn.
        const bytes = await fs.promises.readFile(absPath);
        hash = sha256(bytes.toString('latin1'));
      } else {
        // Oversized: never include mtime (extraction time) — path+size is
        // stable across runs; a same-size content swap is the accepted miss.
        hash = sha256(`${rel}:${sizeBytes}`);
      }
    } catch {
      continue;
    }

    records.push({
      relativePath: rel,
      absolutePath: absPath,
      language,
      category,
      supported: PARSEABLE_LANGUAGES.has(language) && (category === 'source' || category === 'test'),
      trustLevel: trustForCategory(category),
      sizeBytes,
      lineCount,
      hash,
    });
  }

  return records;
}

/** docker-compose.yml, docker-compose.test.yml, compose.yaml, … */
function isComposeFile(baseLower: string): boolean {
  return /^docker-compose[\w.-]*\.ya?ml$/.test(baseLower) || /^compose\.ya?ml$/.test(baseLower);
}

function isRootInventoryFile(rel: string): boolean {
  if (rel.includes('/')) {
    return /^\.github\/workflows\/[^/]+$/.test(rel);
  }
  const base = rel.toLowerCase();
  return (
    base === 'package.json' || base === 'pnpm-workspace.yaml' || isComposeFile(base) ||
    base === 'vercel.json' || base === 'netlify.toml' ||
    base === 'procfile' || base === 'readme.md'
  );
}

// ─── Language inventory + guardrail ───────────────────────────────────────────

export function buildLanguageInventory(records: RepoFileRecord[]): LanguageInventory {
  const supported: Record<string, number> = {};
  const unsupported: Record<string, number> = {};
  const evidenceOnly: Record<string, number> = {};

  for (const r of records) {
    if (r.supported) {
      supported[r.language] = (supported[r.language] ?? 0) + 1;
    } else if (PROGRAMMING_LANGUAGES.has(r.language) && (r.category === 'source' || r.category === 'test')) {
      unsupported[r.language] = (unsupported[r.language] ?? 0) + 1;
    } else {
      evidenceOnly[r.language] = (evidenceOnly[r.language] ?? 0) + 1;
    }
  }

  return {
    supported,
    unsupported,
    evidenceOnly,
    supportedFileCount: Object.values(supported).reduce((a, b) => a + b, 0),
    unsupportedFileCount: Object.values(unsupported).reduce((a, b) => a + b, 0),
  };
}

// ─── Repo inventory (packages, configs, docker services, frameworks) ─────────

const FRAMEWORK_HINTS: Record<string, string> = {
  react: 'react', vue: 'vue', svelte: 'svelte', next: 'nextjs', vite: 'vite',
  express: 'express', fastify: 'fastify', koa: 'koa', '@nestjs/core': 'nestjs',
  bullmq: 'bullmq', bull: 'bull', '@supabase/supabase-js': 'supabase', pg: 'postgres',
  prisma: 'prisma', mongoose: 'mongodb', redis: 'redis', ioredis: 'redis',
};

export async function detectRepoInventory(rootPath: string, records?: RepoFileRecord[]): Promise<RepoInventory> {
  const absRoot = path.resolve(rootPath);
  const fileRecords = records ?? (await scanRepositoryFiles(absRoot));

  const packages: RepoPackage[] = [];
  const configs: RepoConfigFile[] = [];
  const dockerServices: Array<{ name: string; buildContext: string | null }> = [];
  const frameworks = new Set<string>();

  for (const r of fileRecords) {
    const base = path.posix.basename(r.relativePath).toLowerCase();

    if (base === 'package.json') {
      const pkg = readJsonSafe(r.absolutePath) as Record<string, unknown> | null;
      if (!pkg) continue;
      const deps = Object.keys((pkg.dependencies as Record<string, string>) ?? {});
      const devDeps = Object.keys((pkg.devDependencies as Record<string, string>) ?? {});
      const workspaces = Array.isArray(pkg.workspaces)
        ? (pkg.workspaces as string[])
        : ((pkg.workspaces as { packages?: string[] } | undefined)?.packages ?? []);

      packages.push({
        root: normalizePath(path.posix.dirname(r.relativePath)).replace(/^\.$/, ''),
        packageJsonPath: r.relativePath,
        name: typeof pkg.name === 'string' ? pkg.name : null,
        scripts: (pkg.scripts as Record<string, string>) ?? {},
        dependencies: deps,
        devDependencies: devDeps,
        workspaces,
      });
      configs.push({ path: r.relativePath, kind: 'package_json', facts: { name: pkg.name ?? null, workspaces } });

      for (const dep of [...deps, ...devDeps]) {
        const hint = FRAMEWORK_HINTS[dep];
        if (hint) frameworks.add(hint);
      }
    } else if (isComposeFile(base)) {
      const services = parseComposeServices(r.absolutePath);
      // Test composes (docker-compose.test.yml) are inventory 'compose' too,
      // but only the main file feeds scope-proposal docker services.
      if (!/test/i.test(base)) dockerServices.push(...services);
      configs.push({ path: r.relativePath, kind: 'compose', facts: { services: services.map((s) => s.name) } });
      frameworks.add('docker');
    } else if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
      configs.push({ path: r.relativePath, kind: 'docker', facts: {} });
      frameworks.add('docker');
    } else if (base.startsWith('tsconfig')) {
      configs.push({ path: r.relativePath, kind: 'tsconfig', facts: {} });
    } else if (/vite\.config/.test(base)) {
      configs.push({ path: r.relativePath, kind: 'vite', facts: {} });
      frameworks.add('vite');
    } else if (/^\.github\/workflows\//.test(r.relativePath)) {
      configs.push({ path: r.relativePath, kind: 'github_actions', facts: {} });
    } else if (/\.env\.(example|sample|template)$/.test(base)) {
      configs.push({ path: r.relativePath, kind: 'env_example', facts: {} });
    } else if (/eslint/.test(base)) {
      configs.push({ path: r.relativePath, kind: 'eslint', facts: {} });
    } else if (base === 'vercel.json' || base === 'netlify.toml' || base === 'procfile') {
      configs.push({ path: r.relativePath, kind: 'deploy', facts: {} });
    } else if (r.category === 'migration') {
      configs.push({ path: r.relativePath, kind: 'sql_migration', facts: {} });
    }
  }

  return { packages, configs, dockerServices, detectedFrameworks: [...frameworks].sort() };
}

function readJsonSafe(absPath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Minimal docker-compose service parser: top-level `services:` block, each
 * service's `build:` context (string or `context:` key). Deliberately not a
 * full YAML parser — good enough for scope proposal, degrades to no services.
 */
function parseComposeServices(absPath: string): Array<{ name: string; buildContext: string | null }> {
  let text: string;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }

  const lines = text.split('\n');
  const services: Array<{ name: string; buildContext: string | null }> = [];
  let inServices = false;
  let current: { name: string; buildContext: string | null } | null = null;
  let inBuildBlock = false;

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^\S/.test(line)) { inServices = false; }
    if (!inServices) continue;

    const serviceMatch = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (serviceMatch) {
      current = { name: serviceMatch[1]!, buildContext: null };
      services.push(current);
      inBuildBlock = false;
      continue;
    }
    if (!current) continue;

    const buildInline = line.match(/^ {4}build:\s*(\S+)\s*$/);
    if (buildInline) { current.buildContext = buildInline[1]!.replace(/^\.\//, ''); inBuildBlock = false; continue; }
    if (/^ {4}build:\s*$/.test(line)) { inBuildBlock = true; continue; }
    if (inBuildBlock) {
      const ctx = line.match(/^ {6}context:\s*(\S+)\s*$/);
      if (ctx) { current.buildContext = ctx[1]!.replace(/^\.\//, ''); inBuildBlock = false; }
      if (/^ {4}\S/.test(line)) inBuildBlock = false;
    }
  }

  return services;
}
