import { promises as fsp } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { StoredFile, type StoredObject } from "./storedFile";
import { BlobStoredFile } from "./blobStoredFile";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

/**
 * Object storage with two interchangeable backends:
 *
 * - Filesystem (default): objects live under OBJECT_STORAGE_DIR
 *   (default ./data/objects). Suits any host with a persistent disk.
 * - Vercel Blob: used when BLOB_READ_WRITE_TOKEN is set (or
 *   STORAGE_DRIVER=vercel-blob). Required on Vercel, where the function
 *   filesystem is ephemeral.
 *
 * Both share the same key layout, so `/objects/...` paths stored in the
 * database are backend-agnostic:
 *   uploads/<id>   - entity objects, addressed as `/objects/uploads/<id>`
 *   public/...     - public assets served via /api/storage/public-objects/*
 *
 * Uploads keep the two-step flow the frontend already implements: the client
 * requests an upload URL, then PUTs the bytes to it. The URL points at our
 * own API (`/api/storage/uploads/direct/<id>`) instead of a presigned
 * cloud-storage URL. NOTE: on Vercel this caps uploads at the platform's
 * ~4.5 MB request-body limit.
 */

const UPLOAD_URL_PREFIX = "/api/storage/uploads/direct/";

export type StorageDriver = "fs" | "vercel-blob";

export function storageDriver(): StorageDriver {
  const explicit = process.env.STORAGE_DRIVER;
  if (explicit === "fs" || explicit === "vercel-blob") {
    return explicit;
  }
  if (explicit) {
    throw new Error(`Unknown STORAGE_DRIVER "${explicit}" (expected "fs" or "vercel-blob")`);
  }
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "fs";
}

export function getStorageRoot(): string {
  return path.resolve(process.env.OBJECT_STORAGE_DIR || "./data/objects");
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/** Resolve a relative object name under the storage root, rejecting path traversal. */
function resolveSafe(...segments: string[]): string {
  const root = getStorageRoot();
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ObjectNotFoundError();
  }
  // Metadata sidecars (ACL policies) are never served directly.
  if (resolved.endsWith(".meta.json")) {
    throw new ObjectNotFoundError();
  }
  return resolved;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Construct a StoredObject for a relative key (e.g. "uploads/<id>",
 * "public/logo.png") on the active driver, validating against traversal.
 */
function makeFile(key: string): StoredObject {
  if (storageDriver() === "vercel-blob") {
    const segments = key.split("/");
    if (segments.some((s) => s === "" || s === "." || s === "..") || key.endsWith(".meta.json")) {
      throw new ObjectNotFoundError();
    }
    return new BlobStoredFile(key);
  }
  return new StoredFile(key, resolveSafe(key));
}

export class ObjectStorageService {
  constructor() {}

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    const file = makeFile(`public/${filePath}`);
    const [exists] = await file.exists();
    return exists ? file : null;
  }

  async downloadObject(file: StoredObject, cacheTtlSec: number = 3600): Promise<Response> {
    // Entity uploads are content-immutable (fresh UUID per write, only ever
    // overwritten by a retried PUT before anything references them), so they
    // can be cached hard. s-maxage lets Vercel's edge cache serve repeat
    // loads without re-invoking the function.
    const cacheControl = (isPublic: boolean): string => {
      if (!isPublic) {
        return `private, max-age=${cacheTtlSec}`;
      }
      return file.name.startsWith("uploads/")
        ? "public, max-age=31536000, s-maxage=31536000, immutable"
        : `public, max-age=${cacheTtlSec}, s-maxage=86400, stale-while-revalidate=604800`;
    };

    // Blob-backed objects are proxied from the store's CDN URL: same-origin
    // for the browser (canvas exports need this), no local disk involved.
    const publicUrl = file.publicUrl();
    if (publicUrl) {
      const upstream = await fetch(publicUrl);
      if (upstream.status === 404) {
        throw new ObjectNotFoundError();
      }
      if (!upstream.ok || !upstream.body) {
        throw new Error(`Failed to fetch object ${file.name}: ${upstream.status}`);
      }
      const headers: Record<string, string> = {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": cacheControl(true),
      };
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) {
        headers["Content-Length"] = contentLength;
      }
      return new Response(upstream.body, { headers });
    }

    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = (file as StoredFile).createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": metadata.contentType || "application/octet-stream",
      "Cache-Control": cacheControl(isPublic),
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  /**
   * Upload raw bytes server-side (no upload-URL round-trip) and return the
   * normalized object path (`/objects/uploads/<id>`). Used for AI-generated
   * images that originate on the server as base64 data URLs: instead of
   * embedding the multi-MB data URL in a prompt, we persist the bytes and
   * reference them via a short serving URL. The object is marked public so it
   * can be served (and browser-cached) without authentication.
   */
  async uploadBytes(buffer: Buffer, contentType: string): Promise<string> {
    const objectId = randomUUID();
    const file = makeFile(`uploads/${objectId}`);
    await file.save(buffer, { contentType });

    const objectPath = `/objects/uploads/${objectId}`;
    // Blob objects are implicitly public (see blobStoredFile.ts); only the
    // filesystem driver persists ACL sidecars.
    if (storageDriver() === "fs") {
      await setObjectAclPolicy(file, { owner: "system", visibility: "public" });
    }
    return objectPath;
  }

  /**
   * Decode a `data:<mime>;base64,<data>` URL and upload it. Returns the
   * normalized object path. Throws if the string is not a base64 data URL.
   */
  async uploadDataUrl(dataUrl: string): Promise<string> {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) {
      throw new Error("Not a base64 data URL");
    }
    const contentType = match[1];
    const buffer = Buffer.from(match[2], "base64");
    return this.uploadBytes(buffer, contentType);
  }

  /**
   * Reserve an object id and return the URL the client should PUT the file
   * bytes to. Served by the direct-upload route in routes/storage.ts.
   */
  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    return `${UPLOAD_URL_PREFIX}${objectId}`;
  }

  /** Persist bytes PUT by a client to a reserved upload id. */
  async saveDirectUpload(
    objectId: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!SAFE_ID_PATTERN.test(objectId)) {
      throw new ObjectNotFoundError();
    }
    const file = makeFile(`uploads/${objectId}`);
    await file.save(buffer, { contentType });
    return `/objects/uploads/${objectId}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    const file = makeFile(entityId);
    const [exists] = await file.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return file;
  }

  /**
   * Map an upload URL (as returned by getObjectEntityUploadURL) to its
   * canonical `/objects/...` path. Paths already in canonical form pass
   * through unchanged.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    const idx = rawPath.indexOf(UPLOAD_URL_PREFIX);
    if (idx !== -1) {
      const objectId = rawPath
        .slice(idx + UPLOAD_URL_PREFIX.length)
        .split(/[?#]/)[0];
      return `/objects/uploads/${objectId}`;
    }
    return rawPath;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

/** Ensure the storage directories exist so first reads/writes don't race mkdir. */
export async function ensureStorageDirs(): Promise<void> {
  if (storageDriver() !== "fs") {
    return;
  }
  await fsp.mkdir(path.join(getStorageRoot(), "uploads"), { recursive: true });
  await fsp.mkdir(path.join(getStorageRoot(), "public"), { recursive: true });
}
