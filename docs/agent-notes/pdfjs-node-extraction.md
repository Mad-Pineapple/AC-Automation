---
name: pdfjs-dist server-side text extraction
description: How to extract PDF text in the Node api-server (esbuild bundle) without a worker.
---

# Server-side PDF text extraction with pdfjs-dist

To extract text from PDFs in the Node api-server, import the **legacy** build
(`pdfjs-dist/legacy/build/pdf.mjs`) and run worker-less. Iterate pages with
`getPage` → `getTextContent`, join `item.str`. Pass `useSystemFonts: true`.
Always `await loadingTask.destroy()` in a `finally` (free native handles; the
loading task — not the document — owns cleanup).

**Why:** the default browser build expects a Web Worker and DOM; in Node it
throws/“fake worker” warns. The legacy build is the pure-JS path meant for Node.

**How to apply:**
- Cap work before parsing (e.g. ~30 pages / ~20k chars) — PDFs can be huge and
  parsing is synchronous on the event loop.
- If extracted text is effectively empty (scanned/image-only PDF), return 422 —
  pdfjs cannot OCR.
- esbuild must **externalize `pdfjs-dist`** (add to externals in `build.mjs`,
  same as `@google-cloud/canvas`); it ships in node_modules at runtime and does
  not bundle cleanly.
