import { GitHubReturnFlow } from "@/components/GitHubReturnFlow";

/**
 * The GitHub App's Setup URL. Legacy installs (App settings without
 * OAuth-during-install) and GitHub-initiated updates land here; the shared
 * GitHubReturnFlow handles those shapes alongside the combined one, so the
 * app works identically at every App-settings state.
 */
export function GitHubSetupPage() {
  return <GitHubReturnFlow />;
}
