import { Queue, QueueOptions } from 'bullmq';

function buildConnection() {
  const url = process.env.REDIS_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD,
  };
}

export const connection = buildConnection();

const queueOpts: QueueOptions = { connection };

export const ANALYSIS_QUEUE = 'analysis';
export const SUMMARY_QUEUE = 'summary';

export const analysisQueue = new Queue(ANALYSIS_QUEUE, queueOpts);
export const summaryQueue = new Queue(SUMMARY_QUEUE, queueOpts);

export interface AnalysisJobData {
  jobId: string;
  projectId: string;
}

export interface SummaryJobData {
  jobId: string;
  snapshotId: string;
  projectId: string;
  triggeredBy: string;
  role?: string;
}
