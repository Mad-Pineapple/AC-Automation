import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, blockedUsersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { clerkConfigured, devAuthBypass } from "../lib/authConfig";

// Local admin used when DEV_AUTH_BYPASS=1 (Clerk not configured).
async function resolveDevUser(req: any) {
  const clerkUserId = "dev-admin";
  let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!user) {
    // onConflictDoNothing: page loads fire many parallel API calls, so several
    // requests can race to create the dev user; only one insert may win.
    await db
      .insert(usersTable)
      .values({ clerkId: clerkUserId, role: "admin", email: null, name: "Dev Admin" })
      .onConflictDoNothing();
    [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  }
  req.clerkUserId = clerkUserId;
  req.user = user;
  return user;
}

async function resolveUser(req: any) {
  if (devAuthBypass) return resolveDevUser(req);
  // Without Clerk configured there is no session to resolve (clerkMiddleware
  // isn't mounted, so getAuth would throw).
  if (!clerkConfigured) return null;
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) return null;
  req.clerkUserId = clerkUserId;

  let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId));
  if (!user) {
    const [blocked] = await db
      .select({ id: blockedUsersTable.id })
      .from(blockedUsersTable)
      .where(eq(blockedUsersTable.clerkId, clerkUserId));
    if (blocked) {
      req.blocked = true;
      return null;
    }
    const [countRow] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(usersTable);
    const isFirst = !countRow || countRow.count === 0;
    const claims = auth.sessionClaims ?? {};
    const firstName = (claims.first_name as string) ?? "";
    const lastName = (claims.last_name as string) ?? "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || (claims.username as string) || null;
    const [created] = await db
      .insert(usersTable)
      .values({
        clerkId: clerkUserId,
        role: isFirst ? "admin" : "user",
        email: (claims.email as string) ?? null,
        name: fullName,
      })
      .returning();
    user = created;
  } else {
    const now = new Date();
    await db
      .update(usersTable)
      .set({ lastSeenAt: now })
      .where(eq(usersTable.id, user.id));
    user.lastSeenAt = now;
  }

  req.user = user;
  return user;
}

export const requireAuth = async (req: any, res: any, next: any) => {
  const user = await resolveUser(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (user.deactivatedAt) {
    return res.status(403).json({ error: "Your account has been deactivated" });
  }
  next();
};

// Attaches req.user / req.clerkUserId when a valid session exists, but allows
// the request through unauthenticated (for public, read-only viewing).
export const optionalAuth = async (req: any, _res: any, next: any) => {
  await resolveUser(req);
  next();
};

export const requireAdmin = (req: any, res: any, next: any) => {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "Forbidden: admin access required" });
    }
    next();
  });
};
