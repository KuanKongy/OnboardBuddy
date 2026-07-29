import { Router } from "express";
import { query } from "../../lib/db.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import {
  type GitHubUser,
  GitHubAppConfigError,
  exchangeGitHubAppOAuthCode,
  getAppInstallation,
  getAppInfo,
  getGitHubUser,
  listInstallationRepos,
  listBranches,
  listCommits,
} from "../../lib/github.js";
import {
  assertGithubAccountCanBeLinked,
  GitHubInstallationAccessError,
  GitHubReconnectRequiredError,
  getInstallationTokenForUser,
  getUserGithubConnection,
  linkInstallationToUser,
  listInstallationsForUser,
  saveGithubConnection,
  userCanAccessInstallation,
} from "../../lib/github-connection.js";
import {
  createInstallationState,
  verifyInstallationState,
} from "../../lib/github-installation-state.js";
import { parseInstallationId } from "../lib/installationId.js";

export const githubRouter = Router();

/**
 * Bug #8: resolve an installation id or answer 400 and return `null`.
 *
 * Returns `null` — not a falsy number — so that `0`, which is a well-formed id
 * that simply is not yours, reaches the ownership check and gets an honest 403
 * instead of being reported as a missing parameter. Callers must compare
 * against `null` explicitly for the same reason.
 */
function resolveInstallationId(
  res: import("express").Response,
  raw: unknown,
  field = "installation_id query parameter",
): number | null {
  const parsed = parseInstallationId(raw);
  if (parsed.ok) return parsed.value;

  res.status(400).json({
    error:
      parsed.reason === "absent"
        ? `${field} is required`
        : `${field} must be a positive integer`,
  });
  return null;
}

function handleGitHubRouteError(
  res: import("express").Response,
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

  res.status(500).json({ error: fallbackMessage });
}

function frontendUrl(): string {
  return (process.env.FRONTEND_URL ?? process.env.CORS_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
}

function githubOAuthRedirectUri(): string {
  return `${frontendUrl()}/github/oauth/callback`;
}

async function ensurePublicUser(userId: string, email: string): Promise<void> {
  await query(
    `INSERT INTO public.users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [userId, email || `${userId}@users.onboardbuddy.local`],
  );
}

async function assertAuthorizedGitHubMatchesSupabaseIdentity(
  userId: string,
  githubUser: GitHubUser,
): Promise<void> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) {
    throw new Error(`Could not verify Supabase user identity: ${error.message}`);
  }

  const githubIdentity = data.user?.identities?.find((identity) => identity.provider === "github");
  if (!githubIdentity) {
    return;
  }

  const identityData = (githubIdentity.identity_data ?? {}) as Record<string, unknown>;
  const expectedId = Number(identityData.provider_id ?? identityData.sub ?? githubIdentity.id);
  const expectedLogin = String(
    identityData.user_name ??
      identityData.preferred_username ??
      "",
  ).toLowerCase();

  const idMatches = expectedId > 0 && expectedId === githubUser.id;
  const loginMatches = expectedLogin.length > 0 && expectedLogin === githubUser.login.toLowerCase();

  if (!idMatches && !loginMatches) {
    throw new Error(
      `GitHub App authorization account ${githubUser.login} does not match the signed-in GitHub account.`,
    );
  }
}

githubRouter.get("/app", async (req, res) => {
  try {
    const state = createInstallationState(req.user!.id);
    const info = await getAppInfo();
    const installUrl = new URL(`https://github.com/apps/${info.slug}/installations/new`);
    installUrl.searchParams.set("state", state);

    res.json({
      name: info.name,
      slug: info.slug,
      install_url: installUrl.toString(),
    });
  } catch (err) {
    console.error("Get app info error:", err);
    handleGitHubRouteError(res, err, "Failed to fetch GitHub App info");
  }
});

githubRouter.get("/oauth/start", async (req, res) => {
  try {
    const state = createInstallationState(req.user!.id);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", process.env.GITHUB_APP_CLIENT_ID ?? "");
    url.searchParams.set("redirect_uri", githubOAuthRedirectUri());
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");

    res.json({ authorization_url: url.toString() });
  } catch (err) {
    console.error("Start GitHub OAuth error:", err);
    res.status(500).json({ error: "Failed to start GitHub OAuth" });
  }
});

githubRouter.post("/oauth/complete", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { code, state } = req.body as { code?: string; state?: string };
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    verifyInstallationState(state, userId);

    const token = await exchangeGitHubAppOAuthCode(code, githubOAuthRedirectUri());
    const githubUser = await getGitHubUser(token.accessToken);
    await assertAuthorizedGitHubMatchesSupabaseIdentity(userId, githubUser);
    await assertGithubAccountCanBeLinked(userId, githubUser.id, githubUser.login);
    await ensurePublicUser(userId, req.user!.email);
    await saveGithubConnection(userId, githubUser.id, githubUser.login, token);

    res.json({
      github_user: {
        id: githubUser.id,
        login: githubUser.login,
      },
    });
  } catch (err) {
    console.error("Complete GitHub OAuth error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to complete GitHub OAuth" });
  }
});

githubRouter.post("/installations/link", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { installation_id, state } = req.body as {
      installation_id?: string | number;
      state?: string;
    };

    const installationId = resolveInstallationId(res, installation_id, "installation_id");
    if (installationId === null) return;
    if (!state) {
      res.status(400).json({ error: "state is required" });
      return;
    }

    verifyInstallationState(state, userId);

    const allowed = await userCanAccessInstallation(userId, installationId);
    if (!allowed) {
      res.status(403).json({ error: "This GitHub user cannot access that installation" });
      return;
    }

    const installation = await getAppInstallation(installationId);
    await linkInstallationToUser(userId, installation);

    res.json({
      installation: {
        id: installation.id,
        account: installation.account,
      },
    });
  } catch (err) {
    console.error("Link installation error:", err);
    // A server-side misconfiguration is not a bad request: 503, not 400.
    if (err instanceof GitHubAppConfigError) {
      handleGitHubRouteError(res, err);
      return;
    }
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to link installation" });
  }
});

githubRouter.delete("/connection", async (req, res) => {
  try {
    const userId = req.user!.id;
    await query(`DELETE FROM github_connections WHERE user_id = $1`, [userId]);
    await query(`DELETE FROM github_installations WHERE user_id = $1`, [userId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Disconnect GitHub error:", err);
    res.status(500).json({ error: "Failed to disconnect GitHub" });
  }
});

githubRouter.get("/installations", async (req, res) => {
  try {
    const userId = req.user!.id;
    const connection = await getUserGithubConnection(userId);
    const { installations } = await listInstallationsForUser(userId);

    res.json({
      github_connected: connection !== null,
      github_username: connection?.githubUsername ?? null,
      installations,
    });
  } catch (err) {
    console.error("List installations error:", err);
    handleGitHubRouteError(res, err, "Failed to list GitHub installations");
  }
});

githubRouter.get("/repos", async (req, res) => {
  try {
    const userId = req.user!.id;
    const installationId = resolveInstallationId(res, req.query.installation_id);
    if (installationId === null) return;

    const installationToken = await getInstallationTokenForUser(userId, installationId);
    const repos = await listInstallationRepos(installationToken);

    res.json({
      repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        owner: repo.owner.login,
        private: repo.private,
        default_branch: repo.default_branch,
      })),
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error("List repos error:", err);
    }
    handleGitHubRouteError(res, err);
  }
});

githubRouter.get("/repos/:owner/:repo/branches", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { owner, repo } = req.params;
    const installationId = resolveInstallationId(res, req.query.installation_id);
    if (installationId === null) return;

    const installationToken = await getInstallationTokenForUser(userId, installationId);
    const branches = await listBranches(installationToken, owner, repo);
    res.json({ branches });
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error("List branches error:", err);
    }
    handleGitHubRouteError(res, err);
  }
});

githubRouter.get("/repos/:owner/:repo/commits", async (req, res) => {
  try {
    const userId = req.user!.id;
    const { owner, repo } = req.params;
    const installationId = resolveInstallationId(res, req.query.installation_id);
    if (installationId === null) return;
    const branch = typeof req.query.branch === "string" ? req.query.branch : "";
    if (!branch) {
      res.status(400).json({ error: "branch query parameter is required" });
      return;
    }

    const installationToken = await getInstallationTokenForUser(userId, installationId);
    const commits = await listCommits(installationToken, owner, repo, branch);
    res.json({ commits });
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.error("List commits error:", err);
    }
    handleGitHubRouteError(res, err);
  }
});
