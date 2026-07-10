import { db } from "@workspace/db";
import { briefsTable, assetsTable } from "@workspace/db";
import { and, eq, lte, ne, sql } from "drizzle-orm";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 30_000;

/**
 * Dispatch approved briefs whose scheduled time has passed. Returns the number
 * of briefs dispatched. Invoked by the in-process poller on the long-lived
 * Node server, and by /api/cron/dispatch (Vercel Cron + a throttled
 * per-request kick) on serverless deployments.
 */
export async function runDispatchTick(): Promise<number> {
  const now = new Date();
  const due = await db
    .select()
    .from(briefsTable)
    .where(and(eq(briefsTable.status, "scheduled"), lte(briefsTable.scheduledAt, now)));

  for (const brief of due) {
    const methods: string[] = brief.scheduledMethods ? JSON.parse(brief.scheduledMethods) : [];
    // Non-compliant assets are blocked from scheduled dispatch alongside rejected ones.
    const [shippableRow] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(assetsTable).where(and(eq(assetsTable.briefId, brief.id), ne(assetsTable.status, "rejected"), sql`${assetsTable.complianceStatus} is distinct from 'failed'`));
    const [rejectedRow] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(assetsTable).where(and(eq(assetsTable.briefId, brief.id), eq(assetsTable.status, "rejected")));
    const [blockedRow] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(assetsTable).where(and(eq(assetsTable.briefId, brief.id), ne(assetsTable.status, "rejected"), eq(assetsTable.complianceStatus, "failed")));
    const shippableCount = shippableRow?.count ?? 0;
    const rejectedCount = rejectedRow?.count ?? 0;
    const blockedCount = blockedRow?.count ?? 0;
    const schedExclusions: string[] = [];
    if (rejectedCount > 0) schedExclusions.push(`${rejectedCount} rejected`);
    if (blockedCount > 0) schedExclusions.push(`${blockedCount} non-compliant`);
    const schedExclusionNote = schedExclusions.length > 0 ? ` (${schedExclusions.join(", ")} asset${rejectedCount + blockedCount !== 1 ? "s" : ""} excluded)` : "";
    const log = `Auto-dispatched (scheduled) ${shippableCount} asset${shippableCount !== 1 ? "s" : ""} via ${methods.join(", ") || "download"} on ${new Date().toISOString()}${schedExclusionNote}`;
    await db
      .update(briefsTable)
      .set({ status: "dispatched", dispatchLog: log, dispatchedAt: new Date(), updatedAt: new Date() })
      .where(eq(briefsTable.id, brief.id));
    logger.info({ briefId: brief.id, methods }, "Scheduled brief auto-dispatched");
  }

  return due.length;
}

/**
 * Reset briefs stuck in "generating" back to "draft" so they can be retried.
 * Generation is an in-process async task: a server restart (or a serverless
 * function hitting maxDuration) mid-generation would otherwise leave the
 * brief stuck forever. `minAgeMs` guards against resetting a brief another
 * live instance is still working on — pass 0 only at single-instance startup.
 */
export async function resetStuckBriefs(minAgeMs = 0): Promise<number> {
  const cutoff = new Date(Date.now() - minAgeMs);
  const stuck = await db
    .update(briefsTable)
    .set({ status: "draft", updatedAt: new Date() })
    .where(and(eq(briefsTable.status, "generating"), lte(briefsTable.updatedAt, cutoff)))
    .returning({ id: briefsTable.id });
  if (stuck.length > 0) {
    logger.warn({ count: stuck.length, ids: stuck.map((b) => b.id) }, "Reset briefs stuck in 'generating'");
  }
  return stuck.length;
}

// In-process scheduler for the long-lived Node server: periodically dispatches
// approved briefs whose scheduled time has passed. Serverless deployments use
// the cron route instead (an interval would die with the instance).
export function startScheduler(): void {
  const tick = async () => {
    try {
      await runDispatchTick();
    } catch (err) {
      logger.error({ err }, "Scheduler tick failed");
    }
  };

  setInterval(tick, POLL_INTERVAL_MS);
  // Run once shortly after startup to catch anything already due.
  setTimeout(tick, 5_000);
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Dispatch scheduler started");
}
