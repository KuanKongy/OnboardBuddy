import { __setQueryForTests } from "../../src/lib/db.js";
import { __setAuthVerifierForTests } from "../../src/lib/verifySupabaseJwt.js";

export const TEST_USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "tester@example.com",
};

export const TEST_PROJECT_ID = "22222222-2222-2222-2222-222222222222";

export function installTestAuth(): void {
  __setAuthVerifierForTests(async (token) => {
    if (token === "valid-test-token") return TEST_USER;
    throw new Error("Invalid test token");
  });
}

export function resetTestHarness(): void {
  __setQueryForTests(null);
  __setAuthVerifierForTests(null);
}

export function mockQuery(
  handler: (text: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number },
): void {
  __setQueryForTests(async (text, params) => handler(text, params) as never);
}

export function authHeader(): { Authorization: string } {
  return { Authorization: "Bearer valid-test-token" };
}
