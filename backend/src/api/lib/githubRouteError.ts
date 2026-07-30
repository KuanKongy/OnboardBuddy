import type { Response } from "express";
import { GitHubAppConfigError } from "../../lib/github.js";
import { GitHubLinkError } from "../../lib/githubErrors.js";
import {
  GitHubInstallationAccessError,
  GitHubReconnectRequiredError,
} from "../../lib/github-connection.js";

/**
 * The single place a GitHub-touching route turns a thrown error into a status. The
 * rule is a whitelist: an error type designed to be read by the caller has its
 * message reflected, everything else gets `fallbackMessage` and logs the detail.
 */
export function handleGitHubRouteError(
  res: Response,
  err: unknown,
  fallbackMessage = "Internal server error",
): void {
  // The deployment is broken, not the request, so 503 rather than 500.
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

  // `GitHubApiError` falls through on purpose: its status is not translated here,
  // and its body must stay out of the response. POST /projects classifies locally.
  res.status(500).json({ error: fallbackMessage });
}
