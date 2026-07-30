import type { Response } from "express";
import { GitHubAppConfigError } from "../../lib/github.js";
import { GitHubLinkError } from "../../lib/githubErrors.js";
import {
  GitHubInstallationAccessError,
  GitHubReconnectRequiredError,
} from "../../lib/github-connection.js";

/**
 * The single place a GitHub-touching route turns a thrown error into a status.
 *
 * #74/B2: this used to live in routes/github.ts and only two thirds of that
 * file's handlers used it — `/oauth/complete` and `/installations/link` each
 * answered `400 { error: err.message }` for ANYTHING that escaped, which meant
 * a GitHub response body, a missing state secret and a Supabase admin failure
 * all came back to the client as "your request was bad". It is shared (and now
 * exhaustive) so a new route cannot re-invent that catch-all by accident.
 *
 * The rule is a whitelist: an error type that was *designed* to be read by the
 * caller has its message reflected, and everything else gets `fallbackMessage`
 * with the detail left in the log.
 */
export function handleGitHubRouteError(
  res: Response,
  err: unknown,
  fallbackMessage = "Internal server error",
): void {
  // Bug #3: a missing or unreadable github-app.pem used to surface as the
  // generic "Internal server error" for every GitHub route, with the real
  // ENOENT visible only in the container log. The deployment is broken, not
  // the request — 503 says so — and the message names the file and the
  // working directory it was resolved against.
  if (err instanceof GitHubAppConfigError) {
    res.status(503).json({
      error: `GitHub integration is not configured on the server. ${err.message}`,
      code: "github_app_not_configured",
    });
    return;
  }

  if (err instanceof GitHubReconnectRequiredError) {
    res.status(403).json({
      error: err.message,
      code: "github_reconnect_required",
    });
    return;
  }

  if (err instanceof GitHubInstallationAccessError) {
    res.status(403).json({ error: err.message });
    return;
  }

  // A failed handshake the caller can do something about — stale install
  // state, an account already linked elsewhere, a code GitHub rejected.
  if (err instanceof GitHubLinkError) {
    res.status(400).json({ error: err.message });
    return;
  }

  // A `GitHubApiError` deliberately falls through to the generic answer below.
  // Its status is not translated here because these five routes have always
  // answered 500 for a GitHub refusal and nothing asked for that contract to
  // change; the one place the status is load-bearing (POST /projects, where a
  // repo we cannot read means we have no branch to store) classifies it
  // locally — see #74/B7. The body it carries stays out of the response and
  // reaches the log through the caller's `console.error(…, err)`.
  res.status(500).json({ error: fallbackMessage });
}
