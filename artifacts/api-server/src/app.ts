import express, { type Express } from "express";
import cors from "cors";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import trackRouter from "./routes/track";
import { logger } from "./lib/logger";
import { clerkConfigured, devAuthBypass } from "./lib/authConfig";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Clerk is optional: without keys the app is read-only (Clerk's middleware
// would otherwise 307-redirect browser requests into a broken handshake).
if (clerkConfigured) {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
} else if (devAuthBypass) {
  logger.warn("DEV_AUTH_BYPASS is on: every request is treated as a local admin. Never use this in production.");
} else {
  logger.warn("Clerk keys not set: running read-only (sign-in and all writes disabled).");
}

app.use("/api", router);

// Public ad-tracking endpoints - no auth, hit by external browsers serving ad tags.
app.use("/track", trackRouter);

// Serve the built brand-studio frontend (single-deployment setup). STATIC_DIR
// overrides the default location; if neither exists the server is API-only
// (e.g. local dev, where Vite serves the frontend and proxies /api here).
const staticDir =
  process.env.STATIC_DIR ||
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../brand-studio/dist/public",
  );
if (existsSync(staticDir)) {
  // Hashed bundles under /assets are immutable — cache hard. index.html must
  // NEVER be cached: it names the current bundle, and a cached copy leaves
  // browsers running stale builds after every deploy.
  app.use(
    express.static(staticDir, {
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );
  // SPA fallback: any non-API GET serves index.html so client routing works.
  app.get("*path", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/track")) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving frontend static build");
}

export default app;
