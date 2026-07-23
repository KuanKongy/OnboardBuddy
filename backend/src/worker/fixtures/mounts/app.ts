import { apiRouter } from './routes/index.js';

const app = { use: (..._args: unknown[]): void => {} };
app.use('/api', apiRouter);
