import { GitHubReturnFlow } from "@/components/GitHubReturnFlow";

/**
 * The GitHub App's registered Callback URL. With "Request user authorization
 * (OAuth) during installation" enabled, installs ALSO return here (code +
 * installation_id), so this page handles the full arrival matrix via
 * GitHubReturnFlow rather than only the pure-authorize shape it once did.
 */
export function GitHubOAuthCallbackPage() {
  return <GitHubReturnFlow />;
}
