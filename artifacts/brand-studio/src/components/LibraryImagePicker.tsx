import { useState } from "react";
import { useListBrandAssets, getListBrandAssetsQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ImageIcon } from "lucide-react";
import { isTemplateFolder } from "@/lib/templateFolders";

/**
 * "Choose from library" button + dialog that picks an image from the brand's
 * asset library (the imported Frontify collection plus any uploads). Used
 * anywhere a product image can be set.
 */
export function LibraryImagePicker({
  brandId,
  onSelect,
}: {
  brandId: string;
  onSelect: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const numericId = Number(brandId);
  const enabled = open && Number.isInteger(numericId) && numericId > 0;
  const { data: assets, isLoading } = useListBrandAssets(numericId, {
    query: { enabled, queryKey: getListBrandAssetsQueryKey(numericId) },
  });

  // Only real imagery makes sense as a product image: drop documents/videos
  // (kind "file") and template-folder files. Logos stay pickable but live in
  // their own folder so they don't bury the photography and illustrations.
  const pickable = (assets ?? []).filter((a) => a.kind !== "file" && !isTemplateFolder(a.folder));
  const folders = Array.from(
    new Set(pickable.map((a) => a.folder).filter((f): f is string => !!f)),
  ).sort((a, b) => a.localeCompare(b));
  const shown = activeFolder ? pickable.filter((a) => a.folder === activeFolder) : pickable;
  // Checkerboard behind thumbnails so white/light artwork (e.g. white logos on
  // transparent backgrounds) doesn't vanish into the dialog background.
  const checkerboard = {
    backgroundImage: "repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%)",
    backgroundSize: "16px 16px",
  } as const;

  if (!brandId) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ImageIcon className="h-3 w-3" />
          Choose from library
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Brand Library</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
        ) : pickable.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No images in this brand's library yet. Add some from the brand's Library tab.
          </p>
        ) : (
          <>
            {folders.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={activeFolder === null ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setActiveFolder(null)}
                >
                  All ({pickable.length})
                </Button>
                {folders.map((f) => (
                  <Button
                    key={f}
                    type="button"
                    size="sm"
                    variant={activeFolder === f ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setActiveFolder(f)}
                  >
                    {f} ({pickable.filter((a) => a.folder === f).length})
                  </Button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto">
              {shown.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="group border border-border rounded-lg overflow-hidden hover:border-primary transition-colors"
                  onClick={() => {
                    onSelect(asset.url);
                    setOpen(false);
                  }}
                >
                  <div
                    className="aspect-square flex items-center justify-center p-2"
                    style={checkerboard}
                  >
                    <img
                      src={asset.url}
                      alt={asset.name}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <p className="text-[11px] truncate px-1.5 py-1" title={asset.name}>
                    {asset.name}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
