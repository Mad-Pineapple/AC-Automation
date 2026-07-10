import { ObjectStorageService } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

const MAX_PAGES = 30;
const MAX_CHARS = 20_000;

/**
 * Download a PDF from object storage and extract its text content.
 *
 * Uses the pdfjs-dist legacy build (pure JS, runs on the main thread with no
 * web worker) so it works under Node. Caps pages and characters to keep the
 * downstream LLM call bounded. Returns an empty string for image-only /
 * scanned PDFs that have no extractable text layer.
 */
export async function extractPdfText(objectPath: string): Promise<string> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const response = await objectStorageService.downloadObject(file);
  const arrayBuffer = await response.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  try {
    const numPages = Math.min(doc.numPages, MAX_PAGES);
    let text = "";
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      text += `${pageText}\n`;
      if (text.length >= MAX_CHARS) break;
    }
    return text.slice(0, MAX_CHARS).trim();
  } finally {
    await loadingTask.destroy();
  }
}
