import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateBrandStyle, getListBrandStylesQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Bookmark, Code2, Eye, Loader2 } from "lucide-react";

interface HtmlBannerEditorProps {
  assetId: number;
  briefId: number;
  brandId: number;
  brandName: string;
  campaignName: string;
  initialHtml: string;
  onSave: (html: string) => Promise<void>;
}

export default function HtmlBannerEditor({
  assetId,
  briefId: _briefId,
  brandId,
  brandName,
  campaignName,
  initialHtml,
  onSave,
}: HtmlBannerEditorProps) {
  const [html, setHtml] = useState(initialHtml);
  const [previewHtml, setPreviewHtml] = useState(initialHtml);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useState<"split" | "preview" | "code">("split");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createStyle = useCreateBrandStyle();

  const handleChange = useCallback((value: string) => {
    setHtml(value);
    setIsDirty(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewHtml(value);
    }, 400);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(html);
      setIsDirty(false);
      toast({ title: "HTML saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveStyle = () => {
    createStyle.mutate(
      {
        brandId,
        data: {
          html,
          brandName,
          campaignName,
        },
      },
      {
        onSuccess: (style) => {
          queryClient.invalidateQueries({ queryKey: getListBrandStylesQueryKey(brandId) });
          toast({ title: `Style saved: "${style.name}"`, description: "Future AI banners will reference this style." });
        },
        onError: () => {
          toast({ title: "Failed to save style", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="flex flex-col gap-3" data-testid={`html-editor-${assetId}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <Button
            variant={view === "split" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setView("split")}
          >
            Split
          </Button>
          <Button
            variant={view === "code" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setView("code")}
          >
            <Code2 className="w-3 h-3 mr-1" /> Code
          </Button>
          <Button
            variant={view === "preview" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setView("preview")}
          >
            <Eye className="w-3 h-3 mr-1" /> Preview
          </Button>
        </div>
        <div className="flex gap-2">
          {isDirty && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Save HTML
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={handleSaveStyle}
            disabled={createStyle.isPending}
          >
            {createStyle.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Bookmark className="w-3 h-3" />
            )}
            Save Style
          </Button>
        </div>
      </div>

      <div
        className={`grid gap-3 ${
          view === "split" ? "grid-cols-2" : "grid-cols-1"
        }`}
        style={{ minHeight: 320 }}
      >
        {(view === "split" || view === "code") && (
          <div className="flex flex-col">
            <div className="text-xs text-muted-foreground font-mono mb-1 flex items-center gap-1.5">
              <Code2 className="w-3 h-3" /> HTML
              {isDirty && <Badge variant="outline" className="text-[10px] h-4 px-1">unsaved</Badge>}
            </div>
            <textarea
              value={html}
              onChange={(e) => handleChange(e.target.value)}
              className="flex-1 w-full font-mono text-xs bg-muted/50 border border-border rounded-md p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
              style={{ minHeight: 300 }}
              spellCheck={false}
              data-testid={`textarea-html-${assetId}`}
            />
          </div>
        )}
        {(view === "split" || view === "preview") && (
          <div className="flex flex-col">
            <div className="text-xs text-muted-foreground font-mono mb-1 flex items-center gap-1.5">
              <Eye className="w-3 h-3" /> Live Preview
            </div>
            <div className="flex-1 border border-border rounded-md overflow-hidden bg-white" style={{ minHeight: 300 }}>
              <iframe
                srcDoc={previewHtml}
                sandbox="allow-scripts"
                className="w-full h-full"
                style={{ border: "none", minHeight: 300 }}
                title="HTML Banner Preview"
                data-testid={`iframe-preview-${assetId}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
