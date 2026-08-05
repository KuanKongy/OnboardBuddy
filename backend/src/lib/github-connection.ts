import { query } from "./db.js";
import { decrypt, encrypt } from "./encryption.js";
import { GitHubApiError, GitHubLinkError } from "./githubErrors.js";
import {
  getInstallationToken,
  listUserInstallations,
  refreshGitHubAppUserToken,
  type GitHubAppUserToken,
  type Installation,
} from "./github.js";

export class GitHubReconnectRequiredError extends Error {
  constructor() {
    super("Authorize the GitHub App from Account Settings, then refresh installations.");
    this.name = "GitHubReconnectRequiredError";
  }
}

export class GitHubInstallationAccessError extends Error {
  constructor(message = "You do not have access to this GitHub installation") {
    super(message);
    this.name = "GitHubInstallationAccessError";
  }
}

export interface GithubConnection {
  githubUserId: number;
  githubUsername: string;
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
}

export async function getUserGithubConnection(
  userId: string,
): Promise<GithubConnection | null> {
  const result = await query(
    `SELECT github_user_id, github_username, access_token_encrypted,
            access_token_expires_at, refresh_token_encrypted, refresh_token_expires_at
     FROM github_connections
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as {
    github_user_id: number;
    github_username: string;
    access_token_encrypted: string;
    access_token_expires_at: Date | string | null;
    refresh_token_encrypted: string | null;
    refresh_token_expires_at: Date | string | null;
  };

  return {
    githubUserId: Number(row.github_user_id),
    githubUsername: row.github_username,
    accessToken: decrypt(row.access_token_encrypted),
    accessTokenExpiresAt: toDate(row.access_token_expires_at),
    refreshToken: row.refresh_token_encrypted ? decrypt(row.refresh_token_encrypted) : null,
    refreshTokenExpiresAt: toDate(row.refresh_token_expires_at),
  };
}

/**
 * Lists GitHub App installations owned by the connected GitHub account.
 * This requires a GitHub App user access token. Repo access still uses
 * installation tokens after the user selects an installation.
 */
export async function listInstallationsForUser(
  userId: string,
): Promise<{ installations: Installation[] }> {
  const connection = await getUserGithubConnection(userId);
  if (!connection) {
    return { installations: [] };
  }

  try {
    const accessToken = await getValidGithubAppUserAccessToken(userId, connection);
    let installations: Installation[];
    try {
      installations = await listUserInstallations(accessToken);
    } catch (err) {
      // The clock said this token was good and GitHub disagreed. Signing in
      // through Supabase runs the same App's OAuth flow, and GitHub re-mints
      // the user token on every authorization — the copy we stored stops
      // working while its stored `expires_at` still reads hours ahead, so a
      // 401 is the only evidence there is. One refresh, one retry;
      // refreshUserAccessToken throws reconnect-required rather than handing
      // back the token that just failed, so this cannot loop.
      if (!(err instanceof GitHubApiError) || err.status !== 401) throw err;
      installations = await listUserInstallations(
        await refreshUserAccessToken(userId, connection),
      );
    }
    return {
      installations: installations.filter((installation) =>
        belongsToConnectedGitHubAccount(installation, connection),
      ),
    };
  } catch (err) {
    // GitHub rejecting the stored user token (revoked, or expired without a
    // usable refresh) must surface as the reconnect signal, not a 500. The
    // old guard matched on message text that GitHubApiError deliberately
    // never carries (its body is log-only), so every GitHub-side 401/403
    // escaped as "Failed to list GitHub installations".
    if (err instanceof GitHubApiError && (err.status === 401 || err.status === 403)) {
      throw new GitHubReconnectRequiredError();
    }
    throw err;
  }
}

/**
 * NOTE (known limitation): organization installations never pass this filter —
 * `account.id` is the org's id, never the member's, so a user who installed the
 * App on an org sees an empty list. Personal-account installations are the
 * supported path today; fixing orgs needs the membership API
 * (GET /user/memberships/orgs) to prove the connected user belongs to the
 * account, which is a different check, not a looser one.
 */
function belongsToConnectedGitHubAccount(
  installation: Installation,
  connection: GithubConnection,
): boolean {
  if (typeof installation.account.id === "number") {
    return installation.account.id === connection.githubUserId;
  }

  return installation.account.login.toLowerCase() === connection.githubUsername.toLowerCase();
}

/**
 * Checks if the user can access a given installation.
 */
export async function userCanAccessInstallation(
  userId: string,
  installationId: number,
): Promise<boolean> {
  const { installations } = await listInstallationsForUser(userId);
  return installations.some((inst) => inst.id === installationId);
}

export async function getInstallationTokenForUser(
  userId: string,
  installationId: number,
): Promise<string> {
  if (!(await userCanAccessInstallation(userId, installationId))) {
    throw new GitHubInstallationAccessError();
  }
  return getInstallationToken(installationId);
}

/**
 * Installation token for a request that names a repository owner, tolerating an
 * installation id that has gone stale.
 *
 * Reinstalling the App mints a NEW installation id for the same account. Every
 * `projects` row written before that still carries the dead one, and each of
 * them 403s on branches/commits forever, because nothing in the product ever
 * rewrites the column (live case: 145949893 → 151092305, which made Analyze
 * offer no branches on older projects). The owner in the request path is enough
 * to find the account's live installation, so the request is served from it and
 * the stale rows are corrected on the way past.
 *
 * `owner` may be empty for callers that do not know it; the fallback is then
 * skipped and the access error stands.
 */
export async function getInstallationTokenForUserRepo(
  userId: string,
  installationId: number,
  owner: string,
): Promise<string> {
  try {
    return await getInstallationTokenForUser(userId, installationId);
  } catch (err) {
    if (!(err instanceof GitHubInstallationAccessError) || !owner) throw err;

    // Second listing, on the denied path only: the first one is inside the
    // ownership check and does not tell us which id replaced the dead one.
    const { installations } = await listInstallationsForUser(userId);
    const live = installations.find(
      (installation) => installation.account.login.toLowerCase() === owner.toLowerCase(),
    );
    // No installation for this owner means the id is not stale, it is simply
    // not the caller's — the original 403 is the honest answer.
    if (!live) throw err;

    const token = await getInstallationToken(live.id);
    if (live.id !== installationId) {
      await healStaleInstallationId(owner, installationId, live.id);
    }
    return token;
  }
}

/**
 * Points every project row for this owner at the live installation id.
 *
 * Scoped to (owner, stale id) on purpose: installations belong to a GitHub
 * account, not to an OnboardBuddy user, so the live id is right for every
 * member who imported a repo under that owner — but a row carrying a different
 * id belongs to some other installation that is working fine and must not be
 * touched. Matched case-insensitively because GitHub logins are, and because
 * the resolve step above already matched that way: an exact-match UPDATE here
 * would silently heal nothing whenever the stored spelling differs.
 *
 * Best-effort: the caller already holds a working token, so a failed heal costs
 * one more fallback next time rather than the request itself.
 */
async function healStaleInstallationId(
  owner: string,
  staleInstallationId: number,
  liveInstallationId: number,
): Promise<void> {
  try {
    // github_installation_id is a text column (the webhook matcher string-compares it).
    const result = await query(
      `UPDATE projects
       SET github_installation_id = $1
       WHERE lower(repo_owner) = lower($2) AND github_installation_id = $3`,
      [String(liveInstallationId), owner, String(staleInstallationId)],
    );
    console.log(
      `[github] healed stale installation ${staleInstallationId} -> ${liveInstallationId} ` +
        `for ${owner} (${result.rowCount ?? 0} project rows)`,
    );
  } catch (err) {
    console.error(
      `[github] heal of stale installation ${staleInstallationId} for ${owner} failed:`,
      err,
    );
  }
}

export async function linkInstallationToUser(
  userId: string,
  installation: Installation,
): Promise<void> {
  await query(
    `INSERT INTO github_installations (user_id, installation_id, account_login, account_type, app_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, installation_id)
     DO UPDATE SET
       account_login = EXCLUDED.account_login,
       account_type = EXCLUDED.account_type,
       app_id = EXCLUDED.app_id,
       updated_at = now()`,
    [
      userId,
      String(installation.id),
      installation.account.login,
      installation.account.type ?? null,
      installation.app_id,
    ],
  );
}

export async function assertGithubAccountCanBeLinked(
  userId: string,
  githubUserId: number,
  githubUsername: string,
): Promise<void> {
  const existing = await getUserGithubConnection(userId);
  if (existing && existing.githubUserId !== githubUserId) {
    throw new GitHubLinkError(
      `This OnboardBuddy account is already linked to GitHub user @${existing.githubUsername}. ` +
        "Authorize the GitHub App with that same account.",
    );
  }

  const conflict = await query(
    `SELECT user_id FROM github_connections
     WHERE github_user_id = $1 AND user_id <> $2
     LIMIT 1`,
    [githubUserId, userId],
  );
  if (conflict.rows.length > 0) {
    throw new GitHubLinkError(
      `GitHub user @${githubUsername} is already linked to another OnboardBuddy account.`,
    );
  }
}

export async function saveGithubConnection(
  userId: string,
  githubUserId: number,
  githubUsername: string,
  token: GitHubAppUserToken,
): Promise<void> {
  await query(
    `DELETE FROM github_connections WHERE user_id = $1`,
    [userId],
  );

  await query(
    `INSERT INTO github_connections (
       user_id, github_user_id, github_username, access_token_encrypted,
       access_token_expires_at, refresh_token_encrypted, refresh_token_expires_at, scopes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}')`,
    [
      userId,
      githubUserId,
      githubUsername,
      encrypt(token.accessToken),
      token.expiresAt,
      token.refreshToken ? encrypt(token.refreshToken) : null,
      token.refreshTokenExpiresAt,
    ],
  );
}

async function getValidGithubAppUserAccessToken(
  userId: string,
  connection: GithubConnection,
): Promise<string> {
  if (!tokenExpiresSoon(connection.accessTokenExpiresAt)) {
    return connection.accessToken;
  }
  return refreshUserAccessToken(userId, connection);
}

/**
 * Exchanges the stored refresh token for a new user access token and persists
 * it. Split out from the clock check because the clock is not the only reason
 * to refresh: a token can be dead while its stored expiry still reads future
 * (see listInstallationsForUser), and that caller has no expiry to consult.
 */
async function refreshUserAccessToken(
  userId: string,
  connection: GithubConnection,
): Promise<string> {
  if (!connection.refreshToken || tokenExpired(connection.refreshTokenExpiresAt)) {
    throw new GitHubReconnectRequiredError();
  }

  let refreshed;
  try {
    refreshed = await refreshGitHubAppUserToken(connection.refreshToken);
  } catch {
    // Refresh tokens are single-use: a request running in parallel may have
    // spent this one and already stored the replacement, which is a success we
    // can ride. It counts only if the stored token is a DIFFERENT one — handing
    // back the token whose 401 sent us here would retry straight into it.
    const freshConnection = await getUserGithubConnection(userId);
    if (
      freshConnection &&
      freshConnection.accessToken !== connection.accessToken &&
      !tokenExpiresSoon(freshConnection.accessTokenExpiresAt)
    ) {
      return freshConnection.accessToken;
    }
    throw new GitHubReconnectRequiredError();
  }

  const nextRefreshToken = refreshed.refreshToken ?? connection.refreshToken;
  const nextRefreshTokenExpiresAt = refreshed.refreshTokenExpiresAt ?? connection.refreshTokenExpiresAt;

  await query(
    `UPDATE github_connections
     SET access_token_encrypted = $2,
         access_token_expires_at = $3,
         refresh_token_encrypted = $4,
         refresh_token_expires_at = $5
     WHERE user_id = $1`,
    [
      userId,
      encrypt(refreshed.accessToken),
      refreshed.expiresAt,
      nextRefreshToken ? encrypt(nextRefreshToken) : null,
      nextRefreshTokenExpiresAt,
    ],
  );

  return refreshed.accessToken;
}

function tokenExpiresSoon(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now() + 5 * 60 * 1000;
}

function tokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now();
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}
