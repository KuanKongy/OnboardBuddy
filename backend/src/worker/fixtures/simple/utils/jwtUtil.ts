export type TokenPayload = { userId: string; role: string };

export function signToken(payload: TokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export const verifyToken = (token: string): TokenPayload => {
  return JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
};

export enum TokenStatus {
  Valid = 'valid',
  Expired = 'expired',
  Invalid = 'invalid',
}
