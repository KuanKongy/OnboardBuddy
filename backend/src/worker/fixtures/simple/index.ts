import { AuthService } from './services/authService';
import { signToken } from './utils/jwtUtil';

export const authService = new AuthService();

export default authService;
