import { useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Plays the ORIGINAL HTML banner (animation intact) that arrived with an
 * imported HTML5 / Google Web Designer package. The file is stored at import
 * as `config.previewHtml`; the WIP layers are the editable reconstruction.
 */
export function HtmlPreviewDialog({
  previewHtml,
  name,
  width,
  height,
  size = "sm",
  label = "Preview HTML",
  className = "gap-1.5",
  testId = "button-preview-html",
}: {
  previewHtml: string;
  name: string;
  width: number;
  height: number;
  size?: "sm" | "default";
  label?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const PREVIEW_MAX_W = 640;
  const PREVIEW_MAX_H = 520;
  const scale = Math.min(1, PREVIEW_MAX_W / width, PREVIEW_MAX_H / height);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        data-testid={testId}
        title="Play the original HTML banner with its animation"
      >
        <Play className="w-3.5 h-3.5" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={{ maxWidth: Math.max(360, width * scale + 48) }}>
          <DialogHeader>
            <DialogTitle className="text-sm">{name} — original HTML banner</DialogTitle>
          </DialogHeader>
          <div
            className="mx-auto overflow-hidden rounded border border-border bg-muted/30"
            style={{ width: width * scale, height: height * scale }}
          >
            {open && (
              <iframe
                src={previewHtml}
                sandbox="allow-scripts allow-same-origin"
                title={`${name} preview`}
                style={{ width, height, border: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              The imported file playing as delivered — animation included. The layers in the editor are the editable reconstruction.
            </p>
            <a href={previewHtml} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary whitespace-nowrap hover:underline">
              Open full size ↗
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
