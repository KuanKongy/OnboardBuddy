import { __setQueryForTests } from "../../src/lib/db.js";
import { __setAuthVerifierForTests } from "../../src/lib/verifySupabaseJwt.js";

export const TEST_USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "tester@example.com",
};

export const TEST_PROJECT_ID = "22222222-2222-2222-2222-222222222222";

/** The device id the real frontend would have stored in localStorage. */
export const TEST_DEVICE_ID = "33333333-3333-3333-3333-333333333333";

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

/**
 * What the real app sends: the bearer token plus the device id the anti-abuse
 * detector keys on (src/api/services/signals.ts). The device id belongs here
 * rather than at each call site because a free-tier request to a spending route
 * is answered 403 `client_required` without it — so a test that omits it is
 * exercising that gate instead of the route it meant to. projects.test.ts omits
 * it on purpose, once, to cover exactly that.
 */
export function authHeader(): { Authorization: string; "X-Device-Id": string } {
  return { Authorization: "Bearer valid-test-token", "X-Device-Id": TEST_DEVICE_ID };
}
