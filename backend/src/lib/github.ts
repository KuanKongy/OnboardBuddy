import crypto from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const GITHUB_API = "https://api.github.com";

export interface Installation {
  id: number;
  account: { id?: number; login: string; type?: string };
  app_id: number;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  /** Repo metadata shown on dashboard cards (GitHub caps descriptions at 350 chars). */
  description?: string | null;
  language?: string | null;
  pushed_at?: string | null;
}

export interface Branch {
  name: string;
  commit: { sha: string };
}

export interface Commit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitHubUser {
  id: number;
  login: string;
}

export interface GitHubAppUserToken {
  accessToken: string;
  expiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * The App's RS256 private key: `GITHUB_APP_PRIVATE_KEY` (full PEM contents —
 * the option for hosts without file mounts, e.g. Railway; `\n`-escaped
 * newlines are normalized) wins over `GITHUB_APP_PRIVATE_KEY_PATH` (a .pem
 * file, the local-dev default).
 */
function loadAppPrivateKey(): string {
  const inline = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inline && inline.trim() !== "") {
    return inline.replace(/\\n/g, "\n");
  }
  return fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH!, "utf8");
}

export function createAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID!;
  const privateKey = loadAppPrivateKey();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iss: appId, iat: now - 60, exp: now + 600 };

  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey);

  return `${signingInput}.${base64url(signature)}`;
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const jwt = createAppJwt();
  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token: string };
  return data.token;
}

export async function getAppInfo(): Promise<{ slug: string; name: string; html_url: string }> {
  const jwt = createAppJwt();
  const res = await fetch(`${GITHUB_API}/app`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { slug: string; name: string; html_url: string };
  return data;
}

export async function getAppInstallation(installationId: number): Promise<Installation> {
  const jwt = createAppJwt();
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  return (await res.json()) as Installation;
}

export async function exchangeGitHubAppOAuthCode(
  code: string,
  redirectUri: string,
): Promise<GitHubAppUserToken> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub OAuth error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "GitHub OAuth did not return an access token");
  }

  return {
    accessToken: data.access_token,
    expiresAt: secondsFromNow(data.expires_in),
    refreshToken: data.refresh_token ?? null,
    refreshTokenExpiresAt: secondsFromNow(data.refresh_token_expires_in),
  };
}

export async function refreshGitHubAppUserToken(
  refreshToken: string,
): Promise<GitHubAppUserToken> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub OAuth refresh error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "GitHub OAuth did not return a refreshed access token");
  }

  return {
    accessToken: data.access_token,
    expiresAt: secondsFromNow(data.expires_in),
    refreshToken: data.refresh_token ?? null,
    refreshTokenExpiresAt: secondsFromNow(data.refresh_token_expires_in),
  };
}

export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  return (await res.json()) as GitHubUser;
}

function secondsFromNow(seconds: number | undefined): Date | null {
  if (!seconds) return null;
  return new Date(Date.now() + seconds * 1000);
}

export async function listUserInstallations(
  userAccessToken: string,
): Promise<Installation[]> {
  const res = await fetch(`${GITHUB_API}/user/installations`, {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { installations: Installation[] };
  return data.installations;
}

export async function listInstallationRepos(installationToken: string): Promise<Repo[]> {
  const res = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
    headers: {
      Authorization: `Bearer ${installationToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { repositories: Repo[] };
  return data.repositories;
}

export async function listBranches(
  token: string,
  owner: string,
  repo: string,
): Promise<Branch[]> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/branches`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  return (await res.json()) as Branch[];
}

/** Repo metadata — used to default a new project's branch to the repo default. */
export async function getRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<Repo> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  return (await res.json()) as Repo;
}

/** Recent commits on a branch, newest first — feeds the analyze commit picker. */
export async function listCommits(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  perPage = 20,
): Promise<Commit[]> {
  const params = new URLSearchParams({ sha: branch, per_page: String(perPage) });
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  const raw = (await res.json()) as Array<{
    sha: string;
    commit: { message: string; author?: { name?: string; date?: string } | null };
    author?: { login?: string } | null;
  }>;
  return raw.map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0] ?? "",
    author: c.author?.login ?? c.commit.author?.name ?? "unknown",
    date: c.commit.author?.date ?? "",
  }));
}

export async function getCommitSha(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits/${branch}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.sha',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${body}`);
  }

  return res.text();
}

export async function downloadZipball(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  destPath: string,
): Promise<void> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/zipball/${branch}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`GitHub zipball error (${res.status}): ${body}`);
  }

  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), fs.createWriteStream(destPath));
}
