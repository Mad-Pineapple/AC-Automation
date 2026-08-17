/**
 * Copy local filesystem object storage into a Vercel Blob store.
 *
 * Uploads every object under OBJECT_STORAGE_DIR (default
 * ../artifacts/api-server/data/objects relative to this package) to the blob
 * store, preserving keys (`uploads/<id>`, `public/<path>`) so the
 * `/objects/...` paths stored in the database resolve unchanged. Content
 * types come from each object's `.meta.json` sidecar (or file extension);
 * the sidecars themselves are not uploaded.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... pnpm --filter @workspace/scripts run migrate:blob
 *
 * Idempotent: existing blobs are overwritten with identical content, and
 * completed keys are logged to migrate-blob.done.log and skipped on re-runs.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

// fileURLToPath, not URL.pathname: the latter percent-encodes spaces in the
// repo path ("AC Automatioin" -> "AC%20Automatioin") and every fs call fails.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = path.resolve(
  process.env.OBJECT_STORAGE_DIR ||
    path.join(scriptDir, "../../artifacts/api-server/data/objects"),
);
const doneLogPath = path.join(scriptDir, "../migrate-blob.done.log");

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(full)));
    } else if (entry.isFile() && !entry.name.endsWith(".meta.json")) {
      out.push(full);
    }
  }
  return out;
}

async function contentTypeFor(filePath: string): Promise<string> {
  try {
    const sidecar = JSON.parse(await fsp.readFile(`${filePath}.meta.json`, "utf8"));
    if (typeof sidecar.contentType === "string") return sidecar.contentType;
  } catch {
    // no sidecar — fall through to the extension map
  }
  return (
    EXTENSION_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ||
    "application/octet-stream"
  );
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN must be set");
  }

  const done = new Set<string>();
  try {
    for (const line of (await fsp.readFile(doneLogPath, "utf8")).split("\n")) {
      if (line.trim()) done.add(line.trim());
    }
  } catch {
    // first run
  }

  const files = await listFiles(storageRoot);
  if (files.length === 0) {
    console.log(`No objects found under ${storageRoot}`);
    return;
  }
  console.log(`Migrating ${files.length} objects from ${storageRoot} (${done.size} already done)`);

  let uploaded = 0;
  let failed = 0;
  for (const filePath of files) {
    const key = path.relative(storageRoot, filePath).split(path.sep).join("/");
    if (done.has(key)) continue;
    try {
      const buffer = await fsp.readFile(filePath);
      await put(key, buffer, {
        access: "public",
        contentType: await contentTypeFor(filePath),
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      await fsp.appendFile(doneLogPath, `${key}\n`);
      uploaded += 1;
      if (uploaded % 25 === 0) console.log(`  ${uploaded} uploaded...`);
    } catch (err) {
      failed += 1;
      console.error(`FAILED ${key}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Done: ${uploaded} uploaded, ${done.size} previously done, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
