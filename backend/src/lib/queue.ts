import { Queue, QueueOptions } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD,
};

const queueOpts: QueueOptions = { connection };

export const ANALYSIS_QUEUE = 'analysis';

export const analysisQueue = new Queue(ANALYSIS_QUEUE, queueOpts);

export { connection };

export interface AnalysisJobData {
  jobId: string;
  projectId: string;
}
