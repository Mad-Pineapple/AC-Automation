import { logger } from "./logger";

/**
 * Vercel's Node runtime exposes the active invocation's context (including
 * waitUntil) on this well-known global symbol. This is the same lookup
 * @vercel/functions performs — inlined here because that package drags in a
 * transitive zod@4 that breaks the frontend's type resolution.
 */
const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

function vercelWaitUntil(promise: Promise<unknown>): void {
  const context = (
    globalThis as {
      [VERCEL_REQUEST_CONTEXT]?: { get?: () => { waitUntil?: (p: Promise<unknown>) => void } };
    }
  )[VERCEL_REQUEST_CONTEXT]?.get?.();
  context?.waitUntil?.(promise);
}

/**
 * Run an async task after the response has been sent (fire-and-forget from
 * the request handler's point of view).
 *
 * On a long-lived Node server this is just an unawaited promise. On Vercel,
 * the runtime freezes a function as soon as the response completes, killing
 * in-flight work — waitUntil tells it to keep the invocation alive until the
 * task settles (up to the function's maxDuration). Outside Vercel the context
 * global is absent and this degrades to the plain unawaited promise.
 */
export function runInBackground(task: () => Promise<void>): void {
  const promise = task().catch((err) => {
    logger.error({ err }, "Background task failed");
  });
  vercelWaitUntil(promise);
}
