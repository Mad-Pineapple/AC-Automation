import express, { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError, storageDriver } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const CLIENT_TOKEN_PATH = "/storage/uploads/client-token";
// Client tokens are scoped to entity-upload keys only, so an authenticated
// user can't mint a token that overwrites seeded public/ assets.
const CLIENT_UPLOAD_PATHNAME = /^uploads\/[A-Za-z0-9_-]+$/;
const CLIENT_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

/**
 * POST /storage/uploads/request-url
 *
 * Request an upload URL for a file.
 * The client sends JSON metadata (name, size, contentType) - NOT the file.
 * Then PUTs the file to the returned URL (served by the direct-upload route below).
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    // The API contract promises an absolute URL (clients PUT to it verbatim),
    // so resolve the relative upload path against the request origin.
    const relativeUploadUrl = await objectStorageService.getObjectEntityUploadURL();
    const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0];
    const host = req.get("x-forwarded-host") || req.get("host");
    const uploadURL = `${proto}://${host}${relativeUploadUrl}`;
    const objectPath = objectStorageService.normalizeObjectEntityPath(relativeUploadUrl);

    // On blob storage, tell the client to upload direct-to-store instead of
    // PUTting through this API: serverless request bodies cap at ~4.5 MB.
    const clientUpload =
      storageDriver() === "vercel-blob"
        ? {
            handleUploadUrl: `/api${CLIENT_TOKEN_PATH}`,
            pathname: objectPath.replace(/^\/objects\//, ""),
          }
        : undefined;

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
        ...(clientUpload ? { clientUpload } : {}),
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * PUT /storage/uploads/direct/:id
 *
 * Second step of the upload flow: the client PUTs the raw file bytes to the
 * uploadURL returned by request-url. Replaces the cloud-storage presigned
 * URL - bytes are written to local object storage instead.
 */
router.put(
  "/storage/uploads/direct/:id",
  requireAuth,
  express.raw({ type: () => true, limit: "100mb" }),
  async (req: Request, res: Response) => {
    try {
      const rawContentType = req.headers["content-type"];
      const contentType =
        (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType) ||
        "application/octet-stream";
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0) {
        res.status(400).json({ error: "Empty upload body" });
        return;
      }
      const rawId = req.params.id;
      const objectId = Array.isArray(rawId) ? rawId.join("/") : rawId;
      const objectPath = await objectStorageService.saveDirectUpload(
        objectId,
        body,
        contentType,
      );
      res.status(200).json({ objectPath });
    } catch (error) {
      req.log.error({ err: error }, "Error storing uploaded file");
      res.status(500).json({ error: "Failed to store uploaded file" });
    }
  },
);

/**
 * POST /storage/uploads/client-token
 *
 * Vercel Blob client-upload handshake (@vercel/blob/client). Two message
 * types arrive here: token requests from the browser (Clerk-authenticated),
 * and upload-completed webhooks from Vercel's infrastructure (authenticated
 * by the x-vercel-signature HMAC, which handleUpload verifies itself).
 * Only enabled on the blob driver; direct-to-store uploads bypass the
 * serverless request-body limit that caps the PUT route above.
 */
router.post(
  CLIENT_TOKEN_PATH,
  (req: Request, res: Response, next: () => void) => {
    if (req.get("x-vercel-signature")) {
      next();
      return;
    }
    requireAuth(req, res, next);
  },
  async (req: Request, res: Response) => {
    if (storageDriver() !== "vercel-blob") {
      res.status(404).json({ error: "Client uploads are only available on blob storage" });
      return;
    }
    try {
      const jsonResponse = await handleUpload({
        body: req.body as HandleUploadBody,
        request: req,
        onBeforeGenerateToken: async (pathname) => {
          if (!CLIENT_UPLOAD_PATHNAME.test(pathname)) {
            throw new Error("Invalid upload pathname");
          }
          return {
            addRandomSuffix: false,
            allowOverwrite: true,
            maximumSizeInBytes: CLIENT_UPLOAD_MAX_BYTES,
          };
        },
        onUploadCompleted: async ({ blob }) => {
          req.log.info({ pathname: blob.pathname }, "Client upload completed");
        },
      });
      res.json(jsonResponse);
    } catch (error) {
      req.log.error({ err: error }, "Client upload token error");
      res.status(400).json({
        error: error instanceof Error ? error.message : "Client upload failed",
      });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from the `public/` folder of the object storage dir.
 * These are unconditionally public - no authentication or ACL checks.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from the `uploads/` folder of the object storage dir.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route example (uncomment to require auth + ACL) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
