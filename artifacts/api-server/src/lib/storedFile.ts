import { promises as fsp, createReadStream, type ReadStream } from "fs";
import path from "path";

/**
 * A file on local disk with a JSON metadata sidecar (`<file>.meta.json`).
 *
 * Mirrors the small slice of the `@google-cloud/storage` File API this
 * codebase used (tuple-returning exists/download/getMetadata, save,
 * setMetadata, createReadStream) so call sites work unchanged with
 * filesystem-backed storage.
 */

export interface StoredFileMetadata {
  contentType?: string;
  size?: number;
  // Free-form custom metadata (e.g. the ACL policy JSON).
  metadata?: Record<string, string>;
}

/**
 * Backend-agnostic stored object. Two implementations exist: `StoredFile`
 * (local filesystem, the default) and `BlobStoredFile` (Vercel Blob, used on
 * serverless deployments where the filesystem is ephemeral). Call sites only
 * ever go through this interface via ObjectStorageService.
 */
export interface StoredObject {
  /** Logical name (relative object path), for error messages. */
  readonly name: string;
  exists(): Promise<[boolean]>;
  download(): Promise<[Buffer]>;
  getMetadata(): Promise<[StoredFileMetadata]>;
  setMetadata(update: { metadata?: Record<string, string> }): Promise<void>;
  save(buffer: Buffer, options?: { contentType?: string }): Promise<void>;
  /**
   * Directly fetchable URL when the backing store exposes one (e.g. the Blob
   * CDN); null for local files. Used by downloadObject to proxy from the CDN
   * instead of reading disk.
   */
  publicUrl(): string | null;
}

interface SidecarData {
  contentType?: string;
  metadata?: Record<string, string>;
}

// Fallback content types for files that predate a sidecar (e.g. seeded
// public assets dropped straight into the storage directory).
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
};

export class StoredFile implements StoredObject {
  constructor(
    /** Logical name (relative object path), for error messages. */
    public readonly name: string,
    /** Absolute path on disk. */
    public readonly absolutePath: string,
  ) {}

  publicUrl(): string | null {
    return null;
  }

  private get sidecarPath(): string {
    return `${this.absolutePath}.meta.json`;
  }

  private async readSidecar(): Promise<SidecarData> {
    try {
      const raw = await fsp.readFile(this.sidecarPath, "utf8");
      return JSON.parse(raw) as SidecarData;
    } catch {
      return {};
    }
  }

  private async writeSidecar(data: SidecarData): Promise<void> {
    await fsp.writeFile(this.sidecarPath, JSON.stringify(data), "utf8");
  }

  async exists(): Promise<[boolean]> {
    try {
      const stat = await fsp.stat(this.absolutePath);
      return [stat.isFile()];
    } catch {
      return [false];
    }
  }

  async download(): Promise<[Buffer]> {
    return [await fsp.readFile(this.absolutePath)];
  }

  async getMetadata(): Promise<[StoredFileMetadata]> {
    const sidecar = await this.readSidecar();
    let size: number | undefined;
    try {
      size = (await fsp.stat(this.absolutePath)).size;
    } catch {
      size = undefined;
    }
    const contentType =
      sidecar.contentType ??
      EXTENSION_CONTENT_TYPES[path.extname(this.absolutePath).toLowerCase()];
    return [{ contentType, size, metadata: sidecar.metadata }];
  }

  async setMetadata(update: {
    metadata?: Record<string, string>;
  }): Promise<void> {
    const sidecar = await this.readSidecar();
    await this.writeSidecar({
      ...sidecar,
      metadata: { ...sidecar.metadata, ...update.metadata },
    });
  }

  async save(buffer: Buffer, options?: { contentType?: string }): Promise<void> {
    await fsp.mkdir(path.dirname(this.absolutePath), { recursive: true });
    await fsp.writeFile(this.absolutePath, buffer);
    if (options?.contentType) {
      const sidecar = await this.readSidecar();
      await this.writeSidecar({ ...sidecar, contentType: options.contentType });
    }
  }

  createReadStream(): ReadStream {
    return createReadStream(this.absolutePath);
  }
}
