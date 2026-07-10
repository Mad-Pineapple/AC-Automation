import { Router } from "express";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";
import { db } from "@workspace/db";
import { usersTable, blockedUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// Lightweight team roster available to any authenticated user (not admin-only).
// Exposes only id/clerkId/name so non-admins can populate people pickers
// (e.g. the "Created by" campaign filter) without leaking sensitive fields.
router.get("/team", requireAuth, async (_req, res) => {
  try {
    const members = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        name: usersTable.name,
      })
      .from(usersTable)
      .orderBy(usersTable.name);
    res.json(members);
  } catch (err) {
    console.error("GET /team error:", err);
    res.status(500).json({ error: "Failed to fetch team members" });
  }
});

router.get("/users", requireAdmin, async (_req, res) => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        clerkId: usersTable.clerkId,
        role: usersTable.role,
        email: usersTable.email,
        name: usersTable.name,
        createdAt: usersTable.createdAt,
        lastSeenAt: usersTable.lastSeenAt,
        deactivatedAt: usersTable.deactivatedAt,
      })
      .from(usersTable)
      .orderBy(usersTable.createdAt);
    res.json(users);
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.patch("/users/:id/role", requireAdmin, async (req: any, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const { role } = req.body as { role?: string };
  if (role !== "admin" && role !== "user") {
    return res.status(400).json({ error: "role must be 'admin' or 'user'" });
  }

  if (req.user.id === targetId && role !== "admin") {
    return res.status(400).json({ error: "You cannot demote yourself" });
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set({ role, updatedAt: new Date() })
      .where(eq(usersTable.id, targetId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      id: updated.id,
      clerkId: updated.clerkId,
      role: updated.role,
      email: updated.email,
      name: updated.name,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    console.error("PATCH /users/:id/role error:", err);
    return res.status(500).json({ error: "Failed to update role" });
  }
});

router.patch("/users/:id/active", requireAdmin, async (req: any, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const { active } = req.body as { active?: boolean };
  if (typeof active !== "boolean") {
    return res.status(400).json({ error: "active must be a boolean" });
  }

  if (req.user.id === targetId && !active) {
    return res.status(400).json({ error: "You cannot deactivate yourself" });
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set({ deactivatedAt: active ? null : new Date(), updatedAt: new Date() })
      .where(eq(usersTable.id, targetId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      id: updated.id,
      clerkId: updated.clerkId,
      role: updated.role,
      email: updated.email,
      name: updated.name,
      createdAt: updated.createdAt,
      lastSeenAt: updated.lastSeenAt,
      deactivatedAt: updated.deactivatedAt,
    });
  } catch (err) {
    console.error("PATCH /users/:id/active error:", err);
    return res.status(500).json({ error: "Failed to update status" });
  }
});

router.delete("/users/:id", requireAdmin, async (req: any, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  if (req.user.id === targetId) {
    return res.status(400).json({ error: "You cannot remove yourself" });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({
          clerkId: usersTable.clerkId,
          email: usersTable.email,
          name: usersTable.name,
        })
        .from(usersTable)
        .where(eq(usersTable.id, targetId));

      if (!target) return null;

      // Persist a blocklist entry so the removed identity is not silently
      // re-provisioned on next sign-in (auth auto-creates unknown users).
      await tx
        .insert(blockedUsersTable)
        .values({
          clerkId: target.clerkId,
          email: target.email,
          name: target.name,
        })
        .onConflictDoNothing({ target: blockedUsersTable.clerkId });

      const [deleted] = await tx
        .delete(usersTable)
        .where(eq(usersTable.id, targetId))
        .returning({ id: usersTable.id });

      return deleted ?? null;
    });

    if (!result) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ id: result.id });
  } catch (err) {
    console.error("DELETE /users/:id error:", err);
    return res.status(500).json({ error: "Failed to remove user" });
  }
});

export default router;
