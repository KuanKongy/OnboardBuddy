import crypto from "node:crypto";

interface InstallationStatePayload {
  userId: string;
  exp: number;
  nonce: string;
}

function getStateSecret(): string {
  const secret = process.env.GITHUB_INSTALL_STATE_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("GITHUB_INSTALL_STATE_SECRET or TOKEN_ENCRYPTION_KEY is required");
  }
  return secret;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

export function createInstallationState(userId: string): string {
  const payload: InstallationStatePayload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyInstallationState(state: string, expectedUserId: string): void {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid installation state");
  }

  const expectedSignature = sign(encodedPayload);
  const validSignature =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!validSignature) {
    throw new Error("Invalid installation state signature");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as InstallationStatePayload;
  if (payload.userId !== expectedUserId) {
    throw new Error("Installation state belongs to a different user");
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Installation state expired");
  }
}
