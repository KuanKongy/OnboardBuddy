import { signToken, verifyToken, TokenPayload } from '../utils/jwtUtil.js';

export interface ICredentials {
  email: string;
  password: string;
}

export interface ISession {
  token: string;
  userId: string;
}

/**
 * Handles user authentication and session management.
 */
export class AuthService {
  async login(credentials: ICredentials): Promise<ISession> {
    const payload: TokenPayload = { userId: 'user-123', role: 'user' };
    const token = signToken(payload);
    return { token, userId: payload.userId };
  }

  logout(_token: string): void {
    // noop — stateless JWT
  }

  verify(token: string): TokenPayload {
    return verifyToken(token);
  }
}
