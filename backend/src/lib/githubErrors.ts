/** Errors from talking to GitHub, in the two shapes routes need to tell apart. */

/**
 * A non-2xx answer from GitHub. `status` is what callers classify on; `body` is
 * log-only and deliberately absent from `message`, so a handler that leaks
 * `err.message` leaks nothing but the status. `console.error("…:", err)` still
 * prints it — an Error's own properties follow the stack.
 */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly body: string;

  /** `context` names the endpoint family — "GitHub API", "GitHub OAuth", … */
  constructor(status: number, body: string, context = "GitHub API") {
    super(`${context} error (${status})`);
    this.name = "GitHubApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * A linking handshake that failed for a reason the caller can act on — stale
 * install state, an account already linked elsewhere, a rejected OAuth code. The
 * message IS the user-facing text; `handleGitHubRouteError` answers 400 for these
 * and a generic 500 for everything else.
 */
export class GitHubLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubLinkError";
  }
}
