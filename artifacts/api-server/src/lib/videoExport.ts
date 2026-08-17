import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger";

/**
 * Render an animated HTML creative to video (the Storyteq pattern, minus the
 * After Effects pipeline): headless Chromium plays the banner's CSS
 * animations in real time and we capture the result.
 *
 * - GIF: timed screenshot frames assembled by sharp (no ffmpeg needed).
 *   Output is downscaled — full-res social GIFs are tens of MB for no gain.
 * - MP4: Playwright's built-in recording produces WebM; when a system ffmpeg
 *   exists it's transcoded to H.264 MP4 (what ad/social platforms want),
 *   otherwise the WebM is returned as-is.
 *
 * Requires Playwright + a downloaded Chromium on the host, so this is a
 * long-lived-server feature; serverless deployments get a clear 501 from the
 * route instead of a crash (the import + launch are guarded).
 */

export interface VideoExportResult {
  buffer: Buffer;
  contentType: string;
  ext: "gif" | "mp4" | "webm";
}

const DEFAULT_DURATION_MS = 9_000;
const GIF_FPS = 8;
const GIF_MAX_WIDTH = 640;

async function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`)),
    );
  });
}

export async function renderHtmlToVideo(
  html: string,
  width: number,
  height: number,
  format: "gif" | "mp4",
  durationMs = DEFAULT_DURATION_MS,
): Promise<VideoExportResult> {
  // Dynamic import so environments without Playwright fail at request time
  // with a friendly error, not at boot.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const workDir = await mkdtemp(path.join(tmpdir(), "banner-video-"));

  try {
    if (format === "gif") {
      const scale = Math.min(1, GIF_MAX_WIDTH / width);
      const gifW = Math.round(width * scale);
      const gifH = Math.round(height * scale);
      // Render at authored size; each frame is downscaled during capture.
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(html, { waitUntil: "networkidle" });

      const frameCount = Math.round((durationMs / 1000) * GIF_FPS);
      const frameDelayMs = 1000 / GIF_FPS;
      const frames: Buffer[] = [];
      const sharp = (await import("sharp")).default;
      const start = Date.now();
      for (let i = 0; i < frameCount; i++) {
        const due = start + i * frameDelayMs;
        const wait = due - Date.now();
        if (wait > 0) await page.waitForTimeout(wait);
        const png = await page.screenshot({ type: "png" });
        frames.push(await sharp(png).resize(gifW, gifH).ensureAlpha().raw().toBuffer());
      }
      await page.close();

      const gif = await sharp(Buffer.concat(frames), {
        // Animated raw input: `pages` lives inside `raw` (sharp ≥0.33; the
        // published typings don't know the property yet, hence the cast).
        raw: { width: gifW, height: gifH, channels: 4, pages: frames.length } as unknown as {
          width: number;
          height: number;
          channels: 4;
        },
      })
        .gif({ delay: Math.round(frameDelayMs / 10) * 10, loop: 0 })
        .toBuffer();
      return { buffer: gif, contentType: "image/gif", ext: "gif" };
    }

    // MP4/WebM path: real-time recording at full resolution.
    const context = await browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: workDir, size: { width, height } },
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.waitForTimeout(durationMs);
    const video = page.video();
    await context.close(); // flushes the recording
    const webmPath = await video!.path();

    if (await ffmpegAvailable()) {
      const mp4Path = path.join(workDir, "out.mp4");
      await runFfmpeg([
        "-y",
        "-i", webmPath,
        // Trim recording startup lag, keep the animation window.
        "-t", String(durationMs / 1000),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        // H.264 requires even dimensions.
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-movflags", "+faststart",
        mp4Path,
      ]);
      return { buffer: await readFile(mp4Path), contentType: "video/mp4", ext: "mp4" };
    }

    logger.warn("ffmpeg not found; returning WebM instead of MP4");
    return { buffer: await readFile(webmPath), contentType: "video/webm", ext: "webm" };
  } finally {
    await browser.close();
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
