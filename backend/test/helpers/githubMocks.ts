import { encrypt } from "../../src/lib/encryption.js";
import { mockQuery } from "./testHarness.js";

/** GitHub accounts returned by the mocked /user/installations endpoint. */
export const MOCK_GITHUB_ACCOUNTS = {
  owner: { id: 101, login: "KuanKongy", installationId: 9001 },
  otherUser: { id: 202, login: "ng-eugene", installationId: 9002 },
  thirdUser: { id: 303, login: "en80801-arch", installationId: 9003 },
} as const;

/** Statements the request ran, in order — for asserting on writes. */
export interface GithubQueryLog {
  statements: Array<{ text: string; params: unknown[] }>;
}

/**
 * The github_connections row plus the writes a GitHub route may perform: the
 * post-refresh token persist and the stale-installation heal. Returns the log
 * so a test can assert on the heal UPDATE; existing call sites ignore it.
 *
 * `refreshToken` defaults to null (no refresh possible → reconnect-required),
 * which is what every pre-existing case assumes.
 */
export function mockGithubConnection(
  options: { refreshToken?: string | null } = {},
): GithubQueryLog {
  const refreshToken = options.refreshToken ?? null;
  const log: GithubQueryLog = { statements: [] };

  mockQuery((text, params) => {
    log.statements.push({ text, params: params ?? [] });

    if (text.includes("FROM github_connections")) {
      return {
        rows: [{
          github_user_id: MOCK_GITHUB_ACCOUNTS.owner.id,
          github_username: MOCK_GITHUB_ACCOUNTS.owner.login,
          access_token_encrypted: encrypt("github-user-token"),
          access_token_expires_at: new Date(Date.now() + 60 * 60 * 1000),
          refresh_token_encrypted: refreshToken ? encrypt(refreshToken) : null,
          refresh_token_expires_at: refreshToken ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
        }],
      };
    }

    if (text.includes("UPDATE github_connections") || text.includes("UPDATE projects")) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${text}`);
  });

  return log;
}

export function mockGithubInstallationsFetch(): void {
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    calls.push(url);

    if (url === "https://api.github.com/user/installations") {
      return new Response(JSON.stringify({
        installations: [
          {
            id: MOCK_GITHUB_ACCOUNTS.owner.installationId,
            account: { id: MOCK_GITHUB_ACCOUNTS.owner.id, login: MOCK_GITHUB_ACCOUNTS.owner.login, type: "User" },
            app_id: 123456,
          },
          {
            id: MOCK_GITHUB_ACCOUNTS.otherUser.installationId,
            account: { id: MOCK_GITHUB_ACCOUNTS.otherUser.id, login: MOCK_GITHUB_ACCOUNTS.otherUser.login, type: "User" },
            app_id: 123456,
          },
          {
            id: MOCK_GITHUB_ACCOUNTS.thirdUser.installationId,
            account: { id: MOCK_GITHUB_ACCOUNTS.thirdUser.id, login: MOCK_GITHUB_ACCOUNTS.thirdUser.login, type: "User" },
            app_id: 123456,
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected GitHub fetch: ${url}; previous calls: ${calls.join(", ")}`);
  }) as typeof fetch;
}
