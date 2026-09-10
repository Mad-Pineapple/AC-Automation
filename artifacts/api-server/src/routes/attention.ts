import { Router } from "express";
import { db, briefsTable, assetsTable, templatesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { optionalAuth } from "../middlewares/requireAuth";

const router = Router();

export interface AttentionItem {
  id: string;
  kind: "review" | "compliance" | "wip" | "note";
  emoji: string;
  title: string;
  message: string;
  href: string;
}

/**
 * GET /attention — the items Chat (the studio assistant) points out with
 * speech bubbles in the UI. Deterministic and cheap: computed straight from
 * the database on each call, no AI involved, so the bubbles are instant and
 * always current.
 */
router.get("/attention", optionalAuth, async (_req, res): Promise<void> => {
  const items: AttentionItem[] = [];

  // Campaigns waiting on a human decision.
  const pending = await db
    .select({ id: briefsTable.id, name: briefsTable.campaignName })
    .from(briefsTable)
    .where(eq(briefsTable.status, "pending_approval"));
  if (pending.length === 1) {
    items.push({
      id: `review-${pending[0].id}`,
      kind: "review",
      emoji: "👀",
      title: "1 campaign needs review",
      message: `"${pending[0].name}" has finished generating and is waiting for your approval.`,
      href: `/briefs/${pending[0].id}/approve`,
    });
  } else if (pending.length > 1) {
    items.push({
      id: "review-many",
      kind: "review",
      emoji: "👀",
      title: `${pending.length} campaigns need review`,
      message: `${pending
        .slice(0, 3)
        .map((p) => `"${p.name}"`)
        .join(", ")}${pending.length > 3 ? ` and ${pending.length - 3} more` : ""} are waiting for your approval.`,
      href: "/briefs",
    });
  }

  // Assets that failed the brand-compliance gate.
  const failed = await db
    .select({
      briefId: assetsTable.briefId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(assetsTable)
    .where(and(eq(assetsTable.complianceStatus, "failed"), eq(assetsTable.status, "ready")))
    .groupBy(assetsTable.briefId);
  const failedTotal = failed.reduce((n, f) => n + f.count, 0);
  if (failedTotal > 0) {
    items.push({
      id: "compliance",
      kind: "compliance",
      emoji: "🚩",
      title: `${failedTotal} asset${failedTotal === 1 ? "" : "s"} failed brand compliance`,
      message:
        failed.length === 1
          ? "One campaign has artwork that doesn't meet the brand guidelines — open it to regenerate or edit."
          : `${failed.length} campaigns have artwork that doesn't meet the brand guidelines — open them to regenerate or edit.`,
      href: failed.length === 1 ? `/briefs/${failed[0].briefId}/approve` : "/briefs",
    });
  }

  // Imports parked in Work-in-progress.
  const wip = await db
    .select({ id: templatesTable.id })
    .from(templatesTable)
    .where(eq(templatesTable.category, "wip"));
  if (wip.length > 0) {
    items.push({
      id: "wip",
      kind: "wip",
      emoji: "🔨",
      title: `${wip.length} import${wip.length === 1 ? "" : "s"} in WIP`,
      message:
        "Imported artwork is waiting in Work in progress. Promote finished pieces to Templates, or delete the ones you don't need.",
      href: "/wip",
    });
  }

  res.json({ items });
});

export default router;
