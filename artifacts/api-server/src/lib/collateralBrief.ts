/**
 * Design Studio collateral-brief interpreter.
 *
 * Marketers brief the studio with a standard workbook ("Auckland Council
 * Design Studio" template): an INSTRUCTIONS sheet, a campaign sheet whose
 * header row carries Project Number / Deliverable / Sizes / content columns,
 * and a GLOSSARY OF NAMES AND SIZES sheet. This parses any workbook in that
 * shape into a structured plan: channels → deliverables with resolved pixel
 * sizes (glossary-backed when the size cell is missing or unparseable),
 * content directions, click URLs, dates and quantities.
 *
 * XLSX is read with the deps already on board (jszip + fast-xml-parser) —
 * shared strings, inline strings, numbers and date serials are handled.
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface DeliverableContent {
  headline?: string;
  body?: string;
  image?: string;
  cta?: string;
  clickUrl?: string;
  logos?: string;
}

export interface Deliverable {
  channel: string;
  projectNumber: string;
  name: string;
  rawSize: string;
  widthPx: number | null;
  heightPx: number | null;
  unit: "px" | "mm";
  count: number;
  content: DeliverableContent;
  proofDate: string | null;
  dispatchDate: string | null;
  notes: string | null;
}

export interface CollateralPlan {
  campaignName: string;
  projectNumbers: string[];
  deliverables: Deliverable[];
  uniqueSizes: { width: number; height: number; unit: "px" | "mm"; count: number; names: string[] }[];
  warnings: string[];
}

type Cell = string | number | null;
type Row = Cell[];

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    if (ch >= "A" && ch <= "Z") n = n * 26 + (ch.charCodeAt(0) - 64);
    else break;
  }
  return n - 1;
}

/** Excel date serial -> ISO date (1900 system). */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function readSheets(bytes: Buffer): Promise<Map<string, Row[]>> {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const read = async (path: string) => {
    const f = zip.file(path);
    return f ? parser.parse(await f.async("string")) : null;
  };

  // Shared strings.
  const sstXml = await read("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sstXml?.sst?.si) {
    for (const si of Array.isArray(sstXml.sst.si) ? sstXml.sst.si : [sstXml.sst.si]) {
      if (typeof si?.t === "object" ? si.t?.["#text"] !== undefined : si?.t !== undefined) {
        const t = typeof si.t === "object" ? si.t["#text"] : si.t;
        shared.push(String(t ?? ""));
      } else if (si?.r) {
        const runs = Array.isArray(si.r) ? si.r : [si.r];
        shared.push(runs.map((r: any) => (typeof r?.t === "object" ? r.t?.["#text"] ?? "" : r?.t ?? "")).join(""));
      } else {
        shared.push("");
      }
    }
  }

  // Workbook sheet names -> sheet files (by order; rels indirection is
  // overkill for Studio workbooks, which store sheet1.xml.. in order).
  const wb = await read("xl/workbook.xml");
  const sheetDefs = wb?.workbook?.sheets?.sheet;
  const defs = Array.isArray(sheetDefs) ? sheetDefs : sheetDefs ? [sheetDefs] : [];
  const out = new Map<string, Row[]>();
  for (let i = 0; i < defs.length; i++) {
    const name = String(defs[i]?.["@_name"] ?? `Sheet${i + 1}`);
    const xml = await read(`xl/worksheets/sheet${i + 1}.xml`);
    const rowsXml = xml?.worksheet?.sheetData?.row;
    const rowsArr = Array.isArray(rowsXml) ? rowsXml : rowsXml ? [rowsXml] : [];
    const rows: Row[] = [];
    for (const r of rowsArr) {
      const rowIdx = Number(r?.["@_r"] ?? rows.length + 1) - 1;
      while (rows.length <= rowIdx) rows.push([]);
      const cells = Array.isArray(r?.c) ? r.c : r?.c ? [r.c] : [];
      for (const c of cells) {
        const ref = String(c?.["@_r"] ?? "A1");
        const ci = colIndex(ref);
        const type = c?.["@_t"];
        let value: Cell = null;
        const v = c?.v;
        const raw = typeof v === "object" ? v?.["#text"] : v;
        if (type === "s") value = shared[Number(raw)] ?? null;
        else if (type === "inlineStr") value = String(typeof c?.is?.t === "object" ? c.is.t["#text"] : c?.is?.t ?? "");
        else if (type === "str") value = String(raw ?? "");
        else if (raw !== undefined && raw !== null && raw !== "") value = Number(raw);
        rows[rowIdx][ci] = value;
      }
    }
    out.set(name, rows);
  }
  return out;
}

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(?:px|mm|pixels)?\s*W?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(px|mm|pixels)?/i;

function parseSize(raw: string): { w: number; h: number; unit: "px" | "mm" } | null {
  const m = SIZE_RE.exec(raw);
  if (!m) return null;
  const unit = /mm/i.test(raw) ? "mm" : "px";
  return { w: Math.round(Number(m[1])), h: Math.round(Number(m[2])), unit };
}

function text(c: Cell): string {
  return c === null || c === undefined ? "" : String(c).trim();
}

export async function parseCollateralBrief(bytes: Buffer): Promise<CollateralPlan> {
  const sheets = await readSheets(bytes);
  const warnings: string[] = [];

  // Glossary: canonical deliverable name -> size.
  const glossary = new Map<string, { w: number; h: number; unit: "px" | "mm" }>();
  for (const [name, rows] of sheets) {
    if (!/glossary/i.test(name)) continue;
    for (const row of rows) {
      const label = text(row?.[0]);
      const size = parseSize(text(row?.[1]));
      if (label && size) glossary.set(label.toLowerCase(), size);
    }
  }

  // The campaign sheet: the one with a "Project Number" header.
  let campaign: Row[] | null = null;
  let campaignSheetName = "";
  for (const [name, rows] of sheets) {
    if (/glossary|instruction/i.test(name)) continue;
    if (rows.some((r) => r?.some((c) => /project number/i.test(text(c))))) {
      campaign = rows;
      campaignSheetName = name;
      break;
    }
  }
  if (!campaign) throw new Error("No sheet with a 'Project Number' header found — is this the Design Studio collateral template?");

  const headerIdx = campaign.findIndex((r) => r?.some((c) => /project number/i.test(text(c))));
  const header = campaign[headerIdx] ?? [];
  const sub = campaign[headerIdx + 1] ?? [];
  const findCol = (re: RegExp, from = 0): number => {
    for (let i = from; i < Math.max(header.length, sub.length); i++) {
      if (re.test(text(header[i])) || re.test(text(sub[i]))) return i;
    }
    return -1;
  };
  const cols = {
    project: findCol(/project number/i),
    name: findCol(/deliverable/i),
    size: findCol(/size/i),
    headline: findCol(/headline/i),
    body: findCol(/body copy/i),
    image: findCol(/image/i),
    cta: findCol(/call to action/i),
    click: findCol(/click tag|link url/i),
    logos: findCol(/logo/i),
    proof: findCol(/proof/i),
    dispatch: findCol(/dispatch/i),
    notes: findCol(/notes/i),
  };

  const campaignName =
    text(campaign[0]?.find((c) => text(c)) ?? "") || campaignSheetName;

  const deliverables: Deliverable[] = [];
  let channel = "GENERAL";
  for (let i = headerIdx + 1; i < campaign.length; i++) {
    const row = campaign[i] ?? [];
    const project = text(row[cols.project]);
    const name = text(row[cols.name]);
    const nonEmpty = row.filter((c) => text(c)).length;
    // Section banner: a lone text cell (it sits in the project-number
    // column in the Studio template), with no deliverable beside it.
    const banner = text(row[0]) || project;
    if (!name && nonEmpty === 1 && banner && !/please|glossary|important/i.test(banner)) {
      channel = banner.toUpperCase();
      continue;
    }
    if (!project || !name || /project number to be entered/i.test(project)) continue;

    const rawSize = text(row[cols.size]);
    let size = rawSize ? parseSize(rawSize) : null;
    if (!size) {
      const g = glossary.get(name.toLowerCase());
      if (g) {
        size = g;
        if (rawSize) warnings.push(`Row ${i + 1}: size "${rawSize}" unparseable — used glossary size for "${name}".`);
      } else if (rawSize) {
        warnings.push(`Row ${i + 1}: could not parse size "${rawSize}" and "${name}" is not in the glossary.`);
      } else {
        warnings.push(`Row ${i + 1}: no size given and "${name}" is not in the glossary.`);
      }
    }

    const dateOf = (c: Cell): string | null => (typeof c === "number" ? serialToIso(c) : text(c) || null);
    deliverables.push({
      channel,
      projectNumber: project,
      name,
      rawSize,
      widthPx: size ? size.w : null,
      heightPx: size ? size.h : null,
      unit: size?.unit ?? "px",
      count: 1,
      content: {
        headline: text(row[cols.headline]) || undefined,
        body: text(row[cols.body]) || undefined,
        image: text(row[cols.image]) || undefined,
        cta: text(row[cols.cta]) || undefined,
        clickUrl: text(row[cols.click]) || undefined,
        logos: text(row[cols.logos]) || undefined,
      },
      proofDate: dateOf(row[cols.proof]),
      dispatchDate: dateOf(row[cols.dispatch]),
      notes: text(row[cols.notes]) || null,
    });
  }

  // Collapse identical deliverables into a count; collect unique sizes.
  const merged: Deliverable[] = [];
  for (const d of deliverables) {
    const twin = merged.find(
      (m) =>
        m.name === d.name &&
        m.widthPx === d.widthPx &&
        m.heightPx === d.heightPx &&
        m.channel === d.channel &&
        JSON.stringify(m.content) === JSON.stringify(d.content),
    );
    if (twin) twin.count++;
    else merged.push(d);
  }
  const sizeKey = (d: Deliverable) => `${d.widthPx}x${d.heightPx}${d.unit}`;
  const uniq = new Map<string, { width: number; height: number; unit: "px" | "mm"; count: number; names: Set<string> }>();
  for (const d of merged) {
    if (d.widthPx == null || d.heightPx == null) continue;
    const k = sizeKey(d);
    const e = uniq.get(k) ?? { width: d.widthPx, height: d.heightPx, unit: d.unit, count: 0, names: new Set<string>() };
    e.count += d.count;
    e.names.add(d.name);
    uniq.set(k, e);
  }

  return {
    campaignName,
    projectNumbers: [...new Set(merged.map((d) => d.projectNumber))],
    deliverables: merged,
    uniqueSizes: [...uniq.values()]
      .map((e) => ({ width: e.width, height: e.height, unit: e.unit, count: e.count, names: [...e.names] }))
      .sort((a, b) => b.count - a.count),
    warnings,
  };
}
