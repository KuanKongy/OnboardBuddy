import { requireAuth } from '../middleware.js';
import { childRouter } from './child.js';

export const apiRouter = { use: (..._args: unknown[]): void => {} };
apiRouter.use('/projects/:id/child', requireAuth, childRouter);
