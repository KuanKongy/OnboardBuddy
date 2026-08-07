import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { GitHubApiError, GitHubLinkError } from "./githubErrors.js";

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
 * The GitHub App is not usable with the configuration this process was given.
 *
 * A distinct type because it is an operator error, not a GitHub failure and
 * not the caller's fault: routes turn it into one clear, actionable message
 * instead of the generic 500 that a raw ENOENT produced (bug #3).
 */
export class GitHubAppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAppConfigError";
  }
}

/**
 * The App's RS256 private key: `GITHUB_APP_PRIVATE_KEY` (full PEM contents —
 * the option for hosts without file mounts, e.g. Railway; `\n`-escaped
 * newlines are normalized) wins over `GITHUB_APP_PRIVATE_KEY_PATH` (a .pem
 * file, the local-dev default).
 *
 * Every failure here names the two environment variables, the path that was
 * actually tried and the working directory it was resolved against — the
 * relative default (`./github-app.pem`) means "wrong cwd" and "no such file"
 * look identical from the outside, and the worker image sets its WORKDIR to
 * /app/backend for exactly that reason. The bind mount in docker-compose also
 * makes a *directory* appear at the mount point when the host file is missing,
 * so EISDIR is a first-class case, not an oddity.
 */
export function loadAppPrivateKey(): string {
  const inline = process.env.GITHUB_APP_PRIVATE_KEY;
  if (inline && inline.trim() !== "") {
    return inline.replace(/\\n/g, "\n");
  }

  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (!keyPath || keyPath.trim() === "") {
    throw new GitHubAppConfigError(
      "GitHub App private key is not configured: set GITHUB_APP_PRIVATE_KEY (the full PEM contents) " +
        "or GITHUB_APP_PRIVATE_KEY_PATH (a path to the .pem file).",
    );
  }

  const resolved = path.resolve(keyPath);
  let pem: string;
  try {
    pem = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const detail =
      code === "ENOENT" ? "no such file"
      : code === "EISDIR" ? "that path is a directory (a docker bind mount creates one when the host file is missing)"
      : code === "EACCES" ? "permission denied"
      : (err as Error).message;
    throw new GitHubAppConfigError(
      `GitHub App private key could not be read from GITHUB_APP_PRIVATE_KEY_PATH="${keyPath}" ` +
        `(resolved to ${resolved} from working directory ${process.cwd()}): ${detail}. ` +
        "Put the .pem there, or set GITHUB_APP_PRIVATE_KEY to its contents instead.",
    );
  }

  if (!pem.includes("PRIVATE KEY")) {
    throw new GitHubAppConfigError(
      `GitHub App private key at ${resolved} is not a PEM private key (no "PRIVATE KEY" header). ` +
        "Re-download it from the GitHub App settings page.",
    );
  }

  return pem;
}

/**
 * Whether the App is configured well enough to sign a JWT — for a boot-time
 * log line, so a misconfiguration is visible before the first request rather
 * than as a failed import.
 */
export function checkGitHubAppConfig(): { ok: true } | { ok: false; reason: string } {
  if (!process.env.GITHUB_APP_ID) {
    return { ok: false, reason: "GITHUB_APP_ID is not set" };
  }
  try {
    loadAppPrivateKey();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export function createAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) {
    throw new GitHubAppConfigError(
      "GitHub App is not configured: GITHUB_APP_ID is not set.",
    );
  }
  const privateKey = loadAppPrivateKey();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iss: appId, iat: now - 60, exp: now + 600 };

  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  let signature: Buffer;
  try {
    signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  } catch (err) {
    // OpenSSL's "error:1E08010C:DECODER routines::unsupported" is what a
    // truncated or wrong-format key looks like from here; on its own it tells
    // an operator nothing about which file to go and fix.
    throw new GitHubAppConfigError(
      `GitHub App private key is present but unusable for RS256 signing: ${(err as Error).message}. ` +
        "Check that GITHUB_APP_PRIVATE_KEY / GITHUB_APP_PRIVATE_KEY_PATH holds the complete .pem GitHub issued.",
    );
  }

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
    throw new GitHubApiError(res.status, body);
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
    throw new GitHubApiError(res.status, body);
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
    throw new GitHubApiError(res.status, body);
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
    throw new GitHubApiError(res.status, body, "GitHub OAuth");
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
    // GitHubLinkError, so GitHub's own words for a rejected code are reflected to
    // the caller rather than swallowed into a 500.
    throw new GitHubLinkError(
      data.error_description ?? data.error ?? "GitHub OAuth did not return an access token",
    );
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
    throw new GitHubApiError(res.status, body, "GitHub OAuth refresh");
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
    throw new GitHubApiError(res.status, body);
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
    throw new GitHubApiError(res.status, body);
  }

  const data = (await res.json()) as { installations: Installation[] };
  return data.installations;
}

/**
 * Bug #67(2) — "large accounts cannot find their repository".
 *
 * The repo listing asked for one page of 100 and the branch listing took the
 * API's default of 30, with no pagination in either. On an org installed on 250
 * repositories the picker silently ended at 100 and the other 150 simply did
 * not exist — no error, no "showing 100 of 250", nothing to explain it. That is
 * a hard blocker for exactly the org-scale teams this product targets.
 *
 * `MAX_LIST_PAGES` bounds the walk so a pathological account cannot hang an
 * import request: 20 pages of 100 is 2000 repositories or branches. Reaching it
 * is reported by the caller-visible `truncated` flag rather than being swallowed
 * — the failure mode being fixed here is precisely a silent cut.
 */
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 20;

/**
 * Walks a paginated GitHub collection to exhaustion. `extract` exists because
 * the two endpoints disagree on shape: `/installation/repositories` wraps its
 * page in `{ repositories: [...] }` while `/branches` returns a bare array.
 *
 * Termination is on a short page (fewer than `per_page` items), which is the
 * documented end-of-collection signal and does not need the Link header.
 */
async function fetchAllPages<T>(
  url: (page: number) => string,
  token: string,
  extract: (body: unknown) => T[],
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const res = await fetch(url(page), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new GitHubApiError(res.status, body);
    }
    const batch = extract(await res.json());
    items.push(...batch);
    if (batch.length < LIST_PAGE_SIZE) return { items, truncated: false };
  }
  // Never silent: the defect being fixed is a list that ended without saying so.
  console.warn(
    `[github] list hit the ${MAX_LIST_PAGES}-page ceiling at ${items.length} items — ${url(1).split("?")[0]}`,
  );
  return { items, truncated: true };
}

/**
 * Every repository the installation can see, across all pages.
 *
 * `truncated` is true only at the `MAX_LIST_PAGES` ceiling — the picker says so
 * rather than pretending the list is complete.
 */
export async function listInstallationRepos(
  installationToken: string,
): Promise<Repo[] & { truncated?: boolean }> {
  const { items, truncated } = await fetchAllPages<Repo>(
    (page) => `${GITHUB_API}/installation/repositories?per_page=${LIST_PAGE_SIZE}&page=${page}`,
    installationToken,
    (body) => (body as { repositories?: Repo[] }).repositories ?? [],
  );
  // Attached rather than returned as a tuple so every existing caller (the
  // route, the webhook matcher) keeps treating this as a plain array.
  return Object.assign(items, { truncated });
}

export async function listBranches(
  token: string,
  owner: string,
  repo: string,
): Promise<Branch[] & { truncated?: boolean }> {
  const { items, truncated } = await fetchAllPages<Branch>(
    (page) => `${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=${LIST_PAGE_SIZE}&page=${page}`,
    token,
    (body) => (Array.isArray(body) ? (body as Branch[]) : []),
  );
  return Object.assign(items, { truncated });
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
    throw new GitHubApiError(res.status, body);
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
    throw new GitHubApiError(res.status, body);
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

/**
 * Git ref rules (`git check-ref-format`), tightened for use as URL path
 * segments (doc/SECURITY_XSS_PROMPT_INJECTION.md finding P4).
 *
 * A ref reaches `…/commits/{ref}` and `…/zipball/{ref}` by string
 * interpolation, and `fetch` normalizes `..` in a path before sending — so an
 * unchecked ref is a path-traversal primitive that can reach OTHER
 * api.github.com endpoints carrying our repo-scoped installation token, and
 * `?`/`#` can bolt query or fragment onto the request. Only refs that are
 * genuinely just path segments are allowed.
 */
const REF_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;

export function isValidGitRef(ref: string): boolean {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 255) return false;
  // `..` traverses, `@{` is a reflog selector, `.lock` is reserved by git.
  if (ref.includes('..') || ref.includes('@{') || ref.endsWith('.lock')) return false;
  // Control characters, space, and the git-illegal set — `?`/`#` matter most
  // here because they end the path portion of the URL.
  if (/[\u0000-\u0020\u007f~^:?*#[\]\\%]/.test(ref)) return false;
  const segments = ref.split('/');
  return segments.length <= 20 && segments.every((s) => REF_SEGMENT.test(s));
}

/**
 * Encodes a ref for a URL path, per segment: `feature/foo` is a legitimate
 * branch and its `/` must survive, while everything inside a segment is
 * escaped. Callers validate first; this is the belt to that suspenders.
 */
function encodeRefPath(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

function assertRef(ref: string): string {
  if (!isValidGitRef(ref)) throw new Error(`Invalid git ref: ${JSON.stringify(ref.slice(0, 80))}`);
  return encodeRefPath(ref);
}

export async function getCommitSha(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const res = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${assertRef(branch)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.sha',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new GitHubApiError(res.status, body);
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
  const res = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${assertRef(branch)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new GitHubApiError(res.status, body, "GitHub zipball");
  }

  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), fs.createWriteStream(destPath));
}
