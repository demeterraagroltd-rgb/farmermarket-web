import { Worker } from "bullmq";
import IORedis from "ioredis";

// One queue per job family lands here as the plan's workstreams need them:
// bureau pulls, statement analysis, salary-day collection, arrears aging,
// notification fan-out, materialized-view refresh (§3, §12).
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  "example",
  async (job) => {
    // eslint-disable-next-line no-console
    console.log(`processing job ${job.id}`, job.data);
  },
  { connection },
);

worker.on("ready", () => {
  // eslint-disable-next-line no-console
  console.log("worker ready, listening on queue 'example'");
});
