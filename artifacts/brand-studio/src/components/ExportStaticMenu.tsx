/**
 * "Export" dropdown for freeform templates: server-rendered PNG / JPG /
 * print PDF / whole-family zip, downloaded through a blob URL so the Clerk
 * session (cookie + bearer token) travels with the request.
 */
import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { tokenOrNull } from "@/lib/authToken";

interface ExportStaticMenuProps {
  templateId: number;
  templateName: string;
  /** Explicit family ids for the zip (defaults to "adapted from" lookup). */
  familyIds?: number[];
  size?: "sm" | "default";
}

type ExportKind = "png1" | "png2" | "jpg" | "pdf" | "zip" | "sheet";

const LABELS: Record<ExportKind, string> = {
  png1: "PNG @1x",
  png2: "PNG @2x",
  jpg: "JPG",
  pdf: "Print PDF (bleed + marks)",
  zip: "Whole family (zip)",
  sheet: "Meta tracking sheet (CSV)",
};

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

export function ExportStaticMenu({ templateId, templateName, familyIds, size = "default" }: ExportStaticMenuProps) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<ExportKind | null>(null);

  const run = async (kind: ExportKind) => {
    if (busy) return;
    setBusy(kind);
    try {
      const base = `/api/templates/${templateId}`;
      let url: string;
      let init: RequestInit = { method: "GET" };
      switch (kind) {
        case "png1":
          url = `${base}/export.png?scale=1`;
          break;
        case "png2":
          url = `${base}/export.png?scale=2`;
          break;
        case "jpg":
          url = `${base}/export.jpg?quality=90&scale=1`;
          break;
        case "pdf":
          url = `${base}/export.pdf?bleed=3&marks=1&cmyk=1`;
          break;
        case "zip":
          url = `${base}/export-family.zip`;
          init = {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(familyIds && familyIds.length > 0 ? { ids: familyIds } : {}),
          };
          break;
        case "sheet": {
          const campaign = window.prompt("Campaign name for the sheet (used in utm_campaign and file names):", templateName.split(" — ")[0]);
          if (campaign === null) { setBusy(null); return; }
          const clickUrl = window.prompt("Destination URL (optional — parameters are appended):", "") ?? "";
          const q = new URLSearchParams({ campaign });
          if (/^https?:\/\//i.test(clickUrl.trim())) q.set("clickUrl", clickUrl.trim());
          if (familyIds && familyIds.length > 0) q.set("ids", familyIds.join(","));
          url = `${base}/tracking-sheet.csv?${q.toString()}`;
          break;
        }
      }

      // Same auth as the generated API client: the Clerk session cookie, plus
      // a bearer token when Clerk has loaded (works for cross-origin dev too).
      const headers = new Headers(init.headers);
      let token: string | null = null;
      try {
        token = await tokenOrNull(getToken);
      } catch {
        token = null;
      }
      if (token) headers.set("authorization", `Bearer ${token}`);

      const res = await fetch(url, { ...init, headers, credentials: "include" });
      if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const ext = kind === "zip" ? "zip" : kind === "pdf" ? "pdf" : kind === "jpg" ? "jpg" : kind === "sheet" ? "csv" : "png";
      const fallback = `${templateName.replace(/[^\w.-]+/g, "-") || "template"}.${ext}`;
      const filename = filenameFromDisposition(res.headers.get("content-disposition"), fallback);

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

      const warningsHeader = res.headers.get("x-export-warnings");
      if (warningsHeader) {
        try {
          const warnings = JSON.parse(decodeURIComponent(warningsHeader)) as string[];
          if (warnings.length > 0) {
            toast({
              title: `Exported with ${warnings.length} prepress warning${warnings.length === 1 ? "" : "s"}`,
              description: warnings.slice(0, 3).join(" · "),
            });
          }
        } catch {
          /* ignore malformed header */
        }
      }
    } catch (err) {
      toast({
        title: `Export failed (${LABELS[kind]})`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} className="gap-2" disabled={busy !== null} data-testid="button-export-static">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {busy ? `Exporting ${LABELS[busy]}…` : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Static image</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void run("png1")} data-testid="export-png-1x">
          {LABELS.png1}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run("png2")} data-testid="export-png-2x">
          {LABELS.png2}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run("jpg")} data-testid="export-jpg">
          {LABELS.jpg}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Print</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void run("pdf")} data-testid="export-pdf">
          {LABELS.pdf}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void run("zip")} data-testid="export-family-zip">
          {LABELS.zip}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Paid social</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void run("sheet")} data-testid="export-tracking-sheet">
          {LABELS.sheet}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ExportStaticMenu;
