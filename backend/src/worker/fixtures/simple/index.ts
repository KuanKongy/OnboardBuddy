import { AuthService } from './services/authService.js';
import { signToken } from './utils/jwtUtil.js';

export const authService = new AuthService();

export default authService;
