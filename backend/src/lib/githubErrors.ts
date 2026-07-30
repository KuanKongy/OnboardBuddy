/**
 * Errors from talking to GitHub, in the two shapes routes need to tell apart.
 *
 * #74/B2 — every call site in lib/github.ts used to throw
 * `new Error(\`GitHub API error (${status}): ${body}\`)`, and two route
 * catch-alls handed `err.message` straight back as a 400. So GitHub's response
 * body — org and repo names the caller may not be entitled to, rate-limit and
 * token-scope detail, whatever else the API decides to include — was reflected
 * to anyone who could provoke a failure, and the status a route wanted to
 * classify on had to be scraped back out of a string.
 */

/**
 * A non-2xx answer from GitHub. `status` is what callers classify on; `body`
 * is diagnosis for the server log ONLY and is deliberately absent from
 * `message`, so a handler that leaks `err.message` leaks nothing but the
 * status. The body still reaches the log for free: it is an own property, and
 * `console.error("…:", err)` prints an Error's own properties after the stack.
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
 * A GitHub linking handshake that failed for a reason the caller can act on:
 * a stale install-state token, an account already linked elsewhere, an OAuth
 * code GitHub rejected. The message IS the user-facing text — that is the
 * whole point of the type. `handleGitHubRouteError` answers 400 for these and
 * a generic 500 for everything else, so the operator-only failures that used
 * to travel the same 400 path (a missing state secret, a Supabase admin error)
 * stop being quoted to the client.
 */
export class GitHubLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubLinkError";
  }
}
