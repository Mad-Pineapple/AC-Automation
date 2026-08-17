import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { briefsTable } from "./briefs";

export const templateSizeValues = ["social_square", "story", "banner", "print_a4", "animated_social"] as const;
export type TemplateSize = typeof templateSizeValues[number];

export const assetStatusValues = ["generating", "ready", "approved", "rejected"] as const;
export type AssetStatus = typeof assetStatusValues[number];

// Brand-guideline compliance verdict for a generated asset. Null means the asset
// predates the compliance system (legacy/unchecked). "skipped" means the checker
// itself errored out, so the asset is not blocked on a checker bug.
export const complianceStatusValues = ["passed", "failed", "skipped"] as const;
export type ComplianceStatus = typeof complianceStatusValues[number];

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  briefId: integer("brief_id").notNull().references(() => briefsTable.id, { onDelete: "cascade" }),
  templateSize: text("template_size").notNull(),
  // Which brief variant row this asset was rendered for (null = the base take).
  variantLabel: text("variant_label"),
  headline: text("headline"),
  bodyText: text("body_text"),
  callToAction: text("call_to_action"),
  imageUrl: text("image_url"),
  isAnimated: boolean("is_animated").notNull().default(false),
  htmlContent: text("html_content"),
  // Object path of the most recent MP4/WebM export of this creative — makes
  // the VAST tag execution available for it.
  videoObjectPath: text("video_object_path"),
  status: text("status").notNull().default("generating"),
  // Brand-compliance gate: null = unchecked (legacy), else passed|failed|skipped.
  complianceStatus: text("compliance_status"),
  complianceScore: integer("compliance_score"),
  // JSON array of human-readable guideline violations (empty/absent when passed).
  complianceIssues: text("compliance_issues"),
  complianceCheckedAt: timestamp("compliance_checked_at"),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateAssetSchema = insertAssetSchema.partial();

export type Asset = typeof assetsTable.$inferSelect;
export type InsertAsset = z.infer<typeof insertAssetSchema>;
