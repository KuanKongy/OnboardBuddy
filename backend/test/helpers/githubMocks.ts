import { encrypt } from "../../src/lib/encryption.js";
import { mockQuery } from "./testHarness.js";

/** GitHub accounts returned by the mocked /user/installations endpoint. */
export const MOCK_GITHUB_ACCOUNTS = {
  owner: { id: 101, login: "KuanKongy", installationId: 9001 },
  otherUser: { id: 202, login: "ng-eugene", installationId: 9002 },
  thirdUser: { id: 303, login: "en80801-arch", installationId: 9003 },
} as const;

export function mockGithubConnection(): void {
  mockQuery((text) => {
    if (text.includes("FROM github_connections")) {
      return {
        rows: [{
          github_user_id: MOCK_GITHUB_ACCOUNTS.owner.id,
          github_username: MOCK_GITHUB_ACCOUNTS.owner.login,
          access_token_encrypted: encrypt("github-user-token"),
          access_token_expires_at: new Date(Date.now() + 60 * 60 * 1000),
          refresh_token_encrypted: null,
          refresh_token_expires_at: null,
        }],
      };
    }

    throw new Error(`Unexpected query: ${text}`);
  });
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
