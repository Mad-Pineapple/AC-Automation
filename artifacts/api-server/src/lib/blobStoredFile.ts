import { head, put, BlobNotFoundError } from "@vercel/blob";
import type { StoredObject, StoredFileMetadata } from "./storedFile";

/**
 * Vercel Blob-backed stored object, used when BLOB_READ_WRITE_TOKEN is set
 * (or STORAGE_DRIVER=vercel-blob). Objects are stored under the same keys the
 * filesystem driver uses (`uploads/<id>`, `public/<path>`), so `/objects/...`
 * paths persisted in the database work unchanged across drivers.
 *
 * Everything in a Vercel Blob store is publicly readable by URL, so the ACL
 * metadata this app writes for filesystem objects (always public/system in
 * practice) is not persisted: getMetadata reports every object as public.
 */

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";
const PUBLIC_ACL = JSON.stringify({ owner: "system", visibility: "public" });

/**
 * Base URL of the blob store. Derived from the read-write token
 * (vercel_blob_rw_<storeId>_...); BLOB_STORE_BASE_URL overrides it if the
 * token format ever changes.
 */
export function blobStoreBaseUrl(): string {
  const explicit = process.env.BLOB_STORE_BASE_URL;
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const match = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token);
  if (!match) {
    throw new Error(
      "Cannot derive the blob store URL from BLOB_READ_WRITE_TOKEN; set BLOB_STORE_BASE_URL explicitly",
    );
  }
  return `https://${match[1].toLowerCase()}.public.blob.vercel-storage.com`;
}

export class BlobStoredFile implements StoredObject {
  constructor(
    /** Logical name (relative object path) = the blob pathname. */
    public readonly name: string,
  ) {}

  publicUrl(): string {
    const encoded = this.name.split("/").map(encodeURIComponent).join("/");
    return `${blobStoreBaseUrl()}/${encoded}`;
  }

  async exists(): Promise<[boolean]> {
    try {
      await head(this.publicUrl());
      return [true];
    } catch (err) {
      if (err instanceof BlobNotFoundError) {
        return [false];
      }
      throw err;
    }
  }

  async download(): Promise<[Buffer]> {
    const response = await fetch(this.publicUrl());
    if (!response.ok) {
      throw new Error(`Failed to download blob ${this.name}: ${response.status}`);
    }
    return [Buffer.from(await response.arrayBuffer())];
  }

  async getMetadata(): Promise<[StoredFileMetadata]> {
    try {
      const meta = await head(this.publicUrl());
      return [
        {
          contentType: meta.contentType,
          size: meta.size,
          metadata: { [ACL_POLICY_METADATA_KEY]: PUBLIC_ACL },
        },
      ];
    } catch (err) {
      if (err instanceof BlobNotFoundError) {
        return [{ metadata: { [ACL_POLICY_METADATA_KEY]: PUBLIC_ACL } }];
      }
      throw err;
    }
  }

  // ACL metadata is not persisted on blob storage (see module doc).
  async setMetadata(_update: { metadata?: Record<string, string> }): Promise<void> {}

  async save(buffer: Buffer, options?: { contentType?: string }): Promise<void> {
    await put(this.name, buffer, {
      access: "public",
      contentType: options?.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }
}
