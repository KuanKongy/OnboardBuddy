import { Router } from "express";
import { query } from "../../lib/db.js";
import { supabaseAdmin } from "../../lib/supabase.js";
import {
  type GitHubUser,
  exchangeGitHubAppOAuthCode,
  getAppInstallation,
  getAppInfo,
  getGitHubUser,
  listInstallationRepos,
  listBranches,
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

export const githubRouter = Router();

function handleGitHubRouteError(
  res: import("express").Response,
  err: unknown,
  fallbackMessage = "Internal server error",
): void {
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
    res.status(500).json({ error: "Failed to fetch GitHub App info" });
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

    const installationId = Number(installation_id);
    if (!installationId || Number.isNaN(installationId) || !state) {
      res.status(400).json({ error: "installation_id and state are required" });
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
    const installationId = Number(req.query.installation_id);
    if (!installationId || Number.isNaN(installationId)) {
      res.status(400).json({ error: "installation_id query parameter is required" });
      return;
    }

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
    const installationId = Number(req.query.installation_id);
    if (!installationId || Number.isNaN(installationId)) {
      res.status(400).json({ error: "installation_id query parameter is required" });
      return;
    }

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
