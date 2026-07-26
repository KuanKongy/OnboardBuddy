export interface GithubRepoRef {
  owner: string;
  repo: string;
  branch: string;
}

/**
 * Builds a GitHub URL for the repository itself, pinned to the ref that is
 * actually being viewed (`opts.ref` — normally the analyzed commit, so the
 * link lands on the code the package describes rather than whatever the
 * branch has moved on to). Falls back to the repo's branch.
 */
export function buildGithubRepoUrl(repo: GithubRepoRef, opts?: { ref?: string | null }): string {
  const base = `https://github.com/${repo.owner}/${repo.repo}`;
  const ref = opts?.ref ?? repo.branch;
  return ref ? `${base}/tree/${encodeURIComponent(ref)}` : base;
}

/**
 * Builds a GitHub blob URL for a file in a repo, optionally pinned to a
 * specific commit (via `opts.ref`, overriding `repo.branch`) and scrolled to
 * a line range. `opts.ref` should be a commit hash — receipts carry
 * `commitHash` so links stay stable even after new pushes move the branch.
 */
export function buildGithubBlobUrl(
  repo: GithubRepoRef,
  filePath: string,
  opts?: { ref?: string; lineStart?: number | null; lineEnd?: number | null },
): string {
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const ref = opts?.ref ?? repo.branch;
  const url = `https://github.com/${repo.owner}/${repo.repo}/blob/${encodeURIComponent(ref)}/${encodedPath}`;
  const lineStart = opts?.lineStart;
  const lineEnd = opts?.lineEnd;
  if (lineStart != null && lineEnd != null) {
    return `${url}#L${lineStart}-L${lineEnd}`;
  }
  if (lineStart != null) {
    return `${url}#L${lineStart}`;
  }
  return url;
}
