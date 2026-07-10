import app from "./app";
import { logger } from "./lib/logger";
import { seedDemoData } from "./lib/seed";
import { startScheduler, resetStuckBriefs } from "./lib/scheduler";
import { ensureStorageDirs } from "./lib/objectStorage";

const port = Number(process.env["PORT"] || 8080);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  await ensureStorageDirs();
  await seedDemoData();

  // Generation is an in-process async task; if the server restarts mid-generation,
  // briefs would be stuck in "generating" forever. Reset them so they can be retried.
  try {
    await resetStuckBriefs(0);
  } catch (err) {
    logger.error({ err }, "Failed to reset stuck briefs on startup");
  }

  startScheduler();
});
