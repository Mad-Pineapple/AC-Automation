import { ObjectStorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

const MAX_CHARS = 20_000;

/**
 * Download a Word (.docx) file from object storage and extract its raw text.
 *
 * Uses mammoth, which reads the Open XML (.docx) format only — legacy binary
 * .doc files are not supported. Caps characters to keep the downstream LLM call
 * bounded. Returns an empty string when the document has no extractable text.
 */
export async function extractDocxText(objectPath: string): Promise<string> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const response = await objectStorageService.downloadObject(file);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? "").slice(0, MAX_CHARS).trim();
}
