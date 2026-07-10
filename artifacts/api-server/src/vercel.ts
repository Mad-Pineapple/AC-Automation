import type { IncomingMessage, ServerResponse } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { seedDemoData } from "./lib/seed";
import { ensureStorageDirs } from "./lib/objectStorage";
import { runDispatchTick } from "./lib/scheduler";
import { runInBackground } from "./lib/background";

/**
 * Vercel serverless entry point (built to /api/index.mjs — see build.mjs).
 * All /api/* and /track/* traffic is rewritten here (vercel.json); the
 * frontend is served as static files by Vercel's CDN, so the Express static
 * fallback in app.ts never engages.
 *
 * Startup work that index.ts runs after listen() happens lazily on the first
 * request of each instance instead. Stuck-brief recovery moves to the cron
 * route (with an age threshold — a cold start here says nothing about whether
 * another instance is mid-generation).
 */

let initPromise: Promise<void> | null = null;
function initOnce(): Promise<void> {
  initPromise ??= (async () => {
    await ensureStorageDirs();
    await seedDemoData();
  })().catch((err) => {
    initPromise = null; // retry on the next request rather than failing forever
    throw err;
  });
  return initPromise;
}

// Serverless stand-in for the 30s dispatch poller: piggyback on request
// traffic, at most once a minute per instance. Vercel Cron (daily on the
// Hobby plan) is the backstop for idle periods.
const DISPATCH_KICK_INTERVAL_MS = 60_000;
let lastDispatchKickAt = 0;
function maybeKickDispatch(): void {
  const now = Date.now();
  if (now - lastDispatchKickAt < DISPATCH_KICK_INTERVAL_MS) {
    return;
  }
  lastDispatchKickAt = now;
  runInBackground(async () => {
    try {
      await runDispatchTick();
    } catch (err) {
      logger.error({ err }, "Opportunistic dispatch tick failed");
    }
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await initOnce();
  maybeKickDispatch();
  app(req, res);
}
