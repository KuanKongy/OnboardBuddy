import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { simpleGit } from 'simple-git';
import type { FileEntry, RepoIndex, SupportedLanguage } from '../types/analysis.js';

const TS_EXTENSIONS = new Set(['.ts', '.tsx']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.min.js',
];

export async function cloneRepo(githubUrl: string, targetDir: string): Promise<string> {
  const git = simpleGit();
  await git.clone(githubUrl, targetDir, ['--depth', '1']);
  return targetDir;
}

export interface RepoIndexOptions {
  ignoredPaths?: string[];
  fileLimit?: number;
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

  const filesToProcess = options?.fileLimit
    ? allFiles.slice(0, options.fileLimit)
    : allFiles;

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
