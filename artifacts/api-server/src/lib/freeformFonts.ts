/**
 * National 2 font loading for server-side freeform rendering.
 *
 * The brand ships National 2 as WOFF1 (artifacts/brand-studio/public/fonts).
 * Both consumers of the server renderer want raw sfnt (TTF/OTF) bytes:
 * pdf-lib embeds the font file verbatim (a WOFF container is not a valid
 * FontFile2 stream), and @napi-rs/canvas is happiest with a plain sfnt too.
 * WOFF1 is just an sfnt whose tables are individually zlib-compressed, so
 * we unpack it here with node's zlib — no third-party font tooling needed.
 *
 * Converted bytes are cached in memory for the life of the process.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { GlobalFonts } from "@napi-rs/canvas";

export const NATIONAL2_FAMILY = "National 2";

export interface FontMetrics {
  unitsPerEm: number;
  /** hhea ascender / descender (descender is positive here). */
  ascent: number;
  descent: number;
}

export interface LoadedFont {
  weight: 400 | 700;
  /** Raw sfnt (TTF/OTF) bytes, ready for pdf-lib / canvas. */
  sfnt: Uint8Array;
  metrics: FontMetrics;
}

const FONT_FILES: Record<400 | 700, string> = {
  400: "national2-regular.woff",
  700: "national2-bold.woff",
};

// ---------------------------------------------------------------------------
// WOFF1 -> sfnt
// ---------------------------------------------------------------------------

/** Decode a WOFF1 container to the equivalent TTF/OTF byte stream. Input that
 * is already an sfnt (TTF/OTF) is returned unchanged. */
export function woffToSfnt(input: Uint8Array): Uint8Array {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const sig = buf.readUInt32BE(0);
  if (sig !== 0x774f4646 /* 'wOFF' */) {
    if (sig === 0x774f4632 /* 'wOF2' */) throw new Error("WOFF2 fonts are not supported (need WOFF1 or TTF)");
    return input; // 0x00010000 / 'OTTO' / 'true': already an sfnt
  }
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);

  const tables: { tag: Buffer; data: Buffer; checksum: number }[] = [];
  let dirOffset = 44;
  for (let i = 0; i < numTables; i++) {
    const tag = buf.subarray(dirOffset, dirOffset + 4);
    const offset = buf.readUInt32BE(dirOffset + 4);
    const compLength = buf.readUInt32BE(dirOffset + 8);
    const origLength = buf.readUInt32BE(dirOffset + 12);
    const checksum = buf.readUInt32BE(dirOffset + 16);
    const raw = buf.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw);
    if (data.length !== origLength) throw new Error(`WOFF table ${tag.toString("latin1")} decoded to wrong length`);
    tables.push({ tag: Buffer.from(tag), data, checksum });
    dirOffset += 20;
  }

  // sfnt header + 16-byte table directory, tables 4-byte aligned. The WOFF
  // directory is already sorted by tag, which is what sfnt requires too.
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;

  const pad4 = (n: number) => (n + 3) & ~3;
  let total = 12 + numTables * 16;
  for (const t of tables) total += pad4(t.data.length);
  const out = Buffer.alloc(total);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(rangeShift, 10);

  let dataOffset = 12 + numTables * 16;
  tables.forEach((t, i) => {
    const d = 12 + i * 16;
    t.tag.copy(out, d);
    out.writeUInt32BE(t.checksum >>> 0, d + 4);
    out.writeUInt32BE(dataOffset, d + 8);
    out.writeUInt32BE(t.data.length, d + 12);
    t.data.copy(out, dataOffset);
    dataOffset += pad4(t.data.length);
  });
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/** Pull unitsPerEm (head) and ascender/descender (hhea) out of an sfnt. */
export function readSfntMetrics(sfnt: Uint8Array): FontMetrics {
  const buf = Buffer.from(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const numTables = buf.readUInt16BE(4);
  let head: number | null = null;
  let hhea: number | null = null;
  for (let i = 0; i < numTables; i++) {
    const d = 12 + i * 16;
    const tag = buf.toString("latin1", d, d + 4);
    const offset = buf.readUInt32BE(d + 8);
    if (tag === "head") head = offset;
    if (tag === "hhea") hhea = offset;
  }
  const unitsPerEm = head != null ? buf.readUInt16BE(head + 18) : 1000;
  const ascent = hhea != null ? buf.readInt16BE(hhea + 4) : Math.round(unitsPerEm * 0.8);
  const descent = hhea != null ? Math.abs(buf.readInt16BE(hhea + 6)) : Math.round(unitsPerEm * 0.2);
  return { unitsPerEm, ascent, descent };
}

// ---------------------------------------------------------------------------
// Locating + loading the font files
// ---------------------------------------------------------------------------

function candidateFontDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dirs = [
    process.env.FREEFORM_FONT_DIR,
    // src/lib (tsx) -> artifacts/brand-studio/public/fonts
    path.resolve(here, "../../../brand-studio/public/fonts"),
    // dist/ (built server) -> artifacts/brand-studio/public/fonts
    path.resolve(here, "../../brand-studio/public/fonts"),
    // api/ (Vercel bundle at repo root)
    path.resolve(here, "../artifacts/brand-studio/public/fonts"),
    path.resolve(process.cwd(), "artifacts/brand-studio/public/fonts"),
    process.env.STATIC_DIR ? path.join(process.env.STATIC_DIR, "fonts") : undefined,
    // Built frontend sits next to the server in single-deployment setups.
    path.resolve(here, "../../brand-studio/dist/public/fonts"),
  ];
  return dirs.filter((d): d is string => !!d);
}

async function readFontFile(file: string): Promise<Uint8Array> {
  for (const dir of candidateFontDirs()) {
    const p = path.join(dir, file);
    if (existsSync(p)) return new Uint8Array(readFileSync(p));
  }
  // Serverless fallback: the frontend's public dir is served statically.
  const base = process.env.PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (base) {
    const res = await fetch(`${base.replace(/\/+$/, "")}/fonts/${file}`);
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error(`Font file ${file} not found (searched ${candidateFontDirs().join(", ")})`);
}

let loadPromise: Promise<Record<400 | 700, LoadedFont>> | null = null;

/** Load (once) both National 2 weights as sfnt bytes and register them with
 * the canvas font registry under the "National 2" family name. */
export function loadNational2(): Promise<Record<400 | 700, LoadedFont>> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const out = {} as Record<400 | 700, LoadedFont>;
      for (const weight of [400, 700] as const) {
        const woff = await readFontFile(FONT_FILES[weight]);
        const sfnt = woffToSfnt(woff);
        GlobalFonts.register(Buffer.from(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength), NATIONAL2_FAMILY);
        out[weight] = { weight, sfnt, metrics: readSfntMetrics(sfnt) };
      }
      return out;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

/** True when a family name resolves to a registered (or system) font that the
 * canvas can actually draw with. */
export function hasFontFamily(family: string): boolean {
  return GlobalFonts.has(family);
}
