import crypto from "node:crypto";
import fs from "node:fs";

const GITHUB_API = "https://api.github.com";

export interface Installation {
  id: number;
  account: { login: string };
  app_id: number;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
}

export interface Branch {
  name: string;
  commit: { sha: string };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function createAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID!;
  const privateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH!;
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");

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

export async function listAppInstallations(): Promise<Installation[]> {
  const jwt = createAppJwt();
  const res = await fetch(`${GITHUB_API}/app/installations`, {
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

  return (await res.json()) as Installation[];
}

export async function listInstallationRepos(installationToken: string): Promise<Repo[]> {
  const res = await fetch(`${GITHUB_API}/installation/repositories`, {
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
