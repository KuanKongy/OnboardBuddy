import "dotenv/config";

const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);

console.log(
  `OnboardBuddy worker ready. Poll interval: ${pollIntervalMs}ms. Postgres and Redis jobs will be wired here.`,
);
