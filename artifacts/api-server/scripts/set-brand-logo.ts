import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, brandsTable } from "@workspace/db";
import { ObjectStorageService } from "../src/lib/objectStorage";

async function main() {
  const svgPath = process.argv[2];
  const brandId = Number(process.argv[3] ?? "3");
  if (!svgPath) throw new Error("usage: set-brand-logo.ts <svgPath> [brandId]");

  const buffer = readFileSync(svgPath);
  const svc = new ObjectStorageService();
  const objectPath = await svc.uploadBytes(buffer, "image/svg+xml");
  const logoUrl = `/api/storage${objectPath}`;

  await db
    .update(brandsTable)
    .set({ logoUrl, updatedAt: new Date() })
    .where(eq(brandsTable.id, brandId));

  console.log(`Set brand ${brandId} logoUrl = ${logoUrl}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
