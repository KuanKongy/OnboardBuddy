export interface GithubRepoRef {
  owner: string;
  repo: string;
  branch: string;
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
