import { createRemoteJWKSet, jwtVerify } from "jose";

function normalizeSupabaseUrl(url: string): string {
  return url.replace(/\/$/, "").replace(/\/rest\/v1\/?$/, "").trim();
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL ?? "");

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let testVerifier: ((token: string) => Promise<{ id: string; email: string }>) | null = null;

/** @internal Used by tests to bypass remote JWKS verification. */
export function __setAuthVerifierForTests(
  fn: ((token: string) => Promise<{ id: string; email: string }>) | null,
): void {
  testVerifier = fn;
}

function getJwks() {
  if (!jwks) {
    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL is not configured");
    }
    jwks = createRemoteJWKSet(
      new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
    );
  }
  return jwks;
}

export async function verifySupabaseAccessToken(
  token: string,
): Promise<{ id: string; email: string }> {
  if (testVerifier) {
    return testVerifier(token);
  }

  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: `${supabaseUrl}/auth/v1`,
    audience: "authenticated",
  });

  if (!payload.sub) {
    throw new Error("Token missing sub claim");
  }

  return {
    id: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
  };
}
