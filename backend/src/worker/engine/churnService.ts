import { query } from '../../lib/db.js';

/**
 * Churn signals via GitHub API commit stats (doc/Pipeline.md "Churn
 * signals") — no clone needed, fits the zipball flow. Fetched with a small
 * request budget (one page per top-level dir + per top-N candidate file);
 * missing churn degrades to 0-weight, never blocks analysis.
 */

export interface ChurnStats {
  commitCount90d: number;
  lastTouchedAt: string | null;
  distinctAuthors: number;
}

interface CommitEntry {
  sha: string;
  commit?: { author?: { date?: string; email?: string } };
  author?: { login?: string } | null;
}

const GITHUB_API = 'https://api.github.com';
const DEFAULT_MAX_REQUESTS = 30;
const DEFAULT_SINCE_DAYS = 90;

export interface FetchChurnOptions {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  /** Top-level directories to aggregate (one request each). */
  topLevelDirs: string[];
  /** Highest-ranked candidate files to fetch individually. */
  topFiles: string[];
  sinceDays?: number;
  maxRequests?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Returns a map keyed by both file paths and top-level dirs. Paths that fail
 * to fetch are simply absent (0-weight downstream). Never throws for
 * per-path errors; throws only if constructing requests is impossible.
 */
export async function fetchChurnSignals(opts: FetchChurnOptions): Promise<Map<string, ChurnStats>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const since = new Date(Date.now() - (opts.sinceDays ?? DEFAULT_SINCE_DAYS) * 24 * 60 * 60 * 1000).toISOString();
  const maxRequests = opts.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const result = new Map<string, ChurnStats>();

  // Dirs first (broad signal), then top candidate files, within the budget.
  const paths = [...new Set([...opts.topLevelDirs, ...opts.topFiles])].slice(0, maxRequests);

  for (const path of paths) {
    try {
      const url = new URL(`${GITHUB_API}/repos/${opts.owner}/${opts.repo}/commits`);
      url.searchParams.set('sha', opts.branch);
      url.searchParams.set('path', path);
      url.searchParams.set('since', since);
      url.searchParams.set('per_page', '100');

      const res = await fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) continue; // degrade: this path just has no churn signal

      const commits = (await res.json()) as CommitEntry[];
      if (!Array.isArray(commits) || commits.length === 0) continue;

      const authors = new Set<string>();
      let lastTouchedAt: string | null = null;
      for (const c of commits) {
        const author = c.author?.login ?? c.commit?.author?.email;
        if (author) authors.add(author);
        const date = c.commit?.author?.date;
        if (date && (!lastTouchedAt || date > lastTouchedAt)) lastTouchedAt = date;
      }
      result.set(path, {
        commitCount90d: commits.length,
        lastTouchedAt,
        distinctAuthors: authors.size,
      });
    } catch {
      // Network hiccups degrade to 0-weight; churn never blocks analysis.
    }
  }

  return result;
}

/** Caches per-file churn on repository_files.metadata.churn (spec cache). */
export async function persistChurn(
  snapshotId: string,
  churn: Map<string, ChurnStats>,
  filePaths: Set<string>,
): Promise<number> {
  const fileEntries = [...churn.entries()].filter(([path]) => filePaths.has(path));
  if (fileEntries.length === 0) return 0;

  await query(
    `UPDATE repository_files AS f
     SET metadata = f.metadata || jsonb_build_object('churn', s.churn::jsonb)
     FROM (SELECT unnest($2::text[]) AS stable_key, unnest($3::text[]) AS churn) s
     WHERE f.snapshot_id = $1 AND f.stable_key = s.stable_key`,
    [
      snapshotId,
      fileEntries.map(([path]) => path),
      fileEntries.map(([, stats]) => JSON.stringify(stats)),
    ],
  );
  return fileEntries.length;
}
