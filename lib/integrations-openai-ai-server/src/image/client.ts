import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY must be set.");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Optional override (e.g. a proxy/gateway); defaults to https://api.openai.com/v1
  baseURL: process.env.OPENAI_BASE_URL,
});

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  const base64 = (response.data ?? [])[0]?.b64_json ?? "";
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
  });

  const imageBase64 = (response.data ?? [])[0]?.b64_json ?? "";
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}

/**
 * Edit/compose images from in-memory buffers (no temp files), using one or more
 * reference images so the output follows their visual style. Supports the
 * gpt-image-1 sizes so the result can match a target canvas orientation.
 */
export async function editImageBuffers(
  images: { buffer: Buffer; mimeType: string }[],
  prompt: string,
  size: "1024x1024" | "1536x1024" | "1024x1536" = "1024x1024"
): Promise<Buffer> {
  const files = await Promise.all(
    images.map((img, i) => {
      const ext = (img.mimeType.split("/")[1] || "png").split("+")[0];
      return toFile(img.buffer, `reference-${i}.${ext}`, { type: img.mimeType });
    })
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: files,
    prompt,
    size,
  });

  const imageBase64 = (response.data ?? [])[0]?.b64_json ?? "";
  return Buffer.from(imageBase64, "base64");
}
