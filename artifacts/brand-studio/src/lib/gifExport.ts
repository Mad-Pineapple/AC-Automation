import type { Brand, Asset } from "@workspace/api-client-react";
import { getTemplateConfig } from "@/components/TemplateRenderer";
import { createRoot } from "react-dom/client";
import { createElement } from "react";

const FRAME_COUNT = 20;
const FRAME_DELAY = 8;

export const HTML_BANNER_WIDTH = 728;
export const HTML_BANNER_HEIGHT = 90;

export async function captureHtmlBannerAsPng(
  html: string,
  width = HTML_BANNER_WIDTH,
  height = HTML_BANNER_HEIGHT,
): Promise<Blob | null> {
  try {
    const { toPng } = await import("html-to-image");
    const DOMPurify = (await import("dompurify")).default;
    const sanitized = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

    const container = document.createElement("div");
    container.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${width}px;height:${height}px;overflow:hidden;pointer-events:none`;
    container.innerHTML = sanitized;
    document.body.appendChild(container);

    try {
      const dataUrl = await toPng(container, { width, height, pixelRatio: 1 });
      const res = await fetch(dataUrl);
      return await res.blob();
    } finally {
      document.body.removeChild(container);
    }
  } catch {
    return null;
  }
}

export async function captureAssetAsJpg(asset: Asset, brand: Brand): Promise<Blob | null> {
  const { toJpeg } = await import("html-to-image");
  const { TemplateRenderer } = await import("@/components/TemplateRenderer");
  const config = getTemplateConfig(asset.templateSize);
  const { width, height } = config;

  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${width}px;height:${height}px;overflow:hidden`;
  document.body.appendChild(container);

  const root = createRoot(container);
  await new Promise<void>((resolve) => {
    root.render(
      createElement(TemplateRenderer, {
        templateSize: asset.templateSize,
        brand,
        headline: asset.headline,
        bodyText: asset.bodyText,
        callToAction: asset.callToAction,
        imageUrl: asset.imageUrl,
        isAnimated: false,
        scale: 1,
      })
    );
    setTimeout(resolve, 600);
  });

  try {
    const dataUrl = await toJpeg(container.firstElementChild as HTMLElement, { width, height, pixelRatio: 1, quality: 0.92 });
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch {
    return null;
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

export async function captureAssetAsPng(asset: Asset, brand: Brand): Promise<Blob | null> {
  const { toPng } = await import("html-to-image");
  const { TemplateRenderer } = await import("@/components/TemplateRenderer");
  const config = getTemplateConfig(asset.templateSize);
  const { width, height } = config;

  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${width}px;height:${height}px;overflow:hidden`;
  document.body.appendChild(container);

  const root = createRoot(container);
  await new Promise<void>((resolve) => {
    root.render(
      createElement(TemplateRenderer, {
        templateSize: asset.templateSize,
        brand,
        headline: asset.headline,
        bodyText: asset.bodyText,
        callToAction: asset.callToAction,
        imageUrl: asset.imageUrl,
        isAnimated: false,
        scale: 1,
      })
    );
    setTimeout(resolve, 600);
  });

  try {
    const dataUrl = await toPng(container.firstElementChild as HTMLElement, { width, height, pixelRatio: 1 });
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch {
    return null;
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

export async function captureAnimatedAssetAsGif(asset: Asset, brand: Brand): Promise<Blob | null> {
  const { toPng } = await import("html-to-image");
  const { TemplateRenderer } = await import("@/components/TemplateRenderer");
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");

  const config = getTemplateConfig(asset.templateSize);
  const { width, height } = config;
  const scale = 0.5;
  const gifW = Math.round(width * scale);
  const gifH = Math.round(height * scale);

  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${gifW}px;height:${gifH}px;overflow:hidden`;
  document.body.appendChild(container);
  const root = createRoot(container);

  await new Promise<void>((resolve) => {
    root.render(
      createElement(TemplateRenderer, {
        templateSize: asset.templateSize,
        brand,
        headline: asset.headline,
        bodyText: asset.bodyText,
        callToAction: asset.callToAction,
        imageUrl: asset.imageUrl,
        isAnimated: true,
        scale,
      })
    );
    setTimeout(resolve, 400);
  });

  try {
    const enc = GIFEncoder();
    const animDuration = 2500;

    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = (i / FRAME_COUNT) * animDuration;
      const frameDataUrl = await toPng(container.firstElementChild as HTMLElement, {
        width: gifW,
        height: gifH,
        pixelRatio: 1,
        style: { animationDelay: `-${t}ms` },
      });

      const img = new Image();
      img.src = frameDataUrl;
      await new Promise<void>(r => { img.onload = () => r(); });

      const canvas = document.createElement("canvas");
      canvas.width = gifW;
      canvas.height = gifH;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, gifW, gifH);
      const pixels = imageData.data;

      const rgba = new Uint8Array(gifW * gifH * 4);
      for (let j = 0; j < gifW * gifH; j++) {
        rgba[j * 4] = pixels[j * 4];
        rgba[j * 4 + 1] = pixels[j * 4 + 1];
        rgba[j * 4 + 2] = pixels[j * 4 + 2];
        rgba[j * 4 + 3] = 255;
      }

      const palette = quantize(rgba, 256);
      const indexed = applyPalette(rgba, palette);
      enc.writeFrame(indexed, gifW, gifH, { palette, delay: FRAME_DELAY * 10 });
    }

    enc.finish();
    const raw = enc.bytes();
    const buf = new Uint8Array(raw.length);
    buf.set(raw);
    return new Blob([buf], { type: "image/gif" });
  } catch {
    return null;
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}
