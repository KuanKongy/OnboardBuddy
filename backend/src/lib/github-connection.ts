import { query } from "./db.js";
import { decrypt, encrypt } from "./encryption.js";
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
    const installations = await listUserInstallations(accessToken);
    return {
      installations: installations.filter((installation) =>
        belongsToConnectedGitHubAccount(installation, connection),
      ),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("authorized to a GitHub App")) {
      throw new GitHubReconnectRequiredError();
    }
    throw err;
  }
}

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
    throw new Error(
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
    throw new Error(
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

  if (!connection.refreshToken || tokenExpired(connection.refreshTokenExpiresAt)) {
    throw new GitHubReconnectRequiredError();
  }

  let refreshed;
  try {
    refreshed = await refreshGitHubAppUserToken(connection.refreshToken);
  } catch {
    const freshConnection = await getUserGithubConnection(userId);
    if (freshConnection && !tokenExpiresSoon(freshConnection.accessTokenExpiresAt)) {
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
