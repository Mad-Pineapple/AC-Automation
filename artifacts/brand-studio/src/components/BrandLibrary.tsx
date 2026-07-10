import { useRef, useState } from "react";
import {
  useListBrandAssets,
  useCreateBrandAsset,
  useDeleteBrandAsset,
  useUpdateBrand,
  useDissectImage,
  useCreateTemplate,
  useListTemplates,
  getListBrandAssetsQueryKey,
  getGetBrandQueryKey,
  getListBrandsQueryKey,
  getListTemplatesQueryKey,
  type Brand,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { isTemplateFolder } from "@/lib/templateFolders";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { BrandHeader } from "@/components/BrandHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ImageIcon,
  Upload,
  Trash2,
  Star,
  Loader2,
  Sparkles,
  Folder,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";

export function BrandLibrary({
  brandId,
  brand,
  isAdmin,
  canUpload,
}: {
  brandId: number;
  brand: Brand;
  isAdmin: boolean;
  canUpload: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: assets, isLoading } = useListBrandAssets(brandId);
  const createAsset = useCreateBrandAsset();
  const deleteAsset = useDeleteBrandAsset();
  const updateBrand = useUpdateBrand();

  const { uploadFile, isUploading } = useUpload();
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [uploadFolder, setUploadFolder] = useState<string>("");
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (name: string) =>
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const dissectImage = useDissectImage();
  const createTemplate = useCreateTemplate();
  const { data: templates } = useListTemplates();
  const [learning, setLearning] = useState(false);
  const [learnProgress, setLearnProgress] = useState<{
    done: number;
    total: number;
    name: string;
  } | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListBrandAssetsQueryKey(brandId),
    });

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setPendingName(file.name);
      const result = await uploadFile(file);
      if (!result) {
        toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
        continue;
      }
      await new Promise<void>((resolve) => {
        createAsset.mutate(
          {
            brandId,
            data: {
              name: file.name,
              kind: "image",
              folder: uploadFolder || null,
              objectPath: result.objectPath,
              contentType: file.type || null,
            },
          },
          {
            onSuccess: () => {
              invalidate();
              resolve();
            },
            onError: () => {
              toast({ title: `Failed to save ${file.name}`, variant: "destructive" });
              resolve();
            },
          },
        );
      });
    }
    setPendingName(null);
    toast({ title: "Upload complete" });
  };

  const handleDelete = (id: number) => {
    deleteAsset.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Asset deleted" });
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      },
    );
  };

  const handleSetLogo = (url: string) => {
    updateBrand.mutate(
      { id: brandId, data: { logoUrl: url } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBrandQueryKey(brandId) });
          queryClient.invalidateQueries({ queryKey: getListBrandsQueryKey() });
          toast({ title: "Brand logo updated" });
        },
        onError: () => toast({ title: "Failed to set logo", variant: "destructive" }),
      },
    );
  };

  // Learn every library file into Knowledge: vision-dissect each image into a
  // freeform "knowledge" template so its real size and layout are captured and
  // reusable. Non-destructive (the file stays in the library) and idempotent —
  // files already learned (matched by sourceImageUrl) are skipped.
  const learnedSources = new Set(
    (templates ?? [])
      .filter((t) => t.category === "knowledge" && t.sourceImageUrl)
      .map((t) => t.sourceImageUrl as string),
  );

  const handleLearnAll = async () => {
    const toLearn = (assets ?? []).filter(
      (a) => a.kind !== "file" && !learnedSources.has(a.url),
    );
    if (toLearn.length === 0) {
      toast({
        title: "Nothing to learn",
        description: "Every file in this library is already in Knowledge.",
      });
      return;
    }

    setLearning(true);
    let done = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < toLearn.length; i++) {
      const asset = toLearn[i];
      setLearnProgress({ done: i, total: toLearn.length, name: asset.name });
      const friendly = asset.name.replace(/\.[^.]+$/, "").trim();
      try {
        const res = await dissectImage.mutateAsync({
          data: { objectPath: asset.objectPath },
        });
        const elements = res.config.elements ?? [];
        if (elements.length === 0) {
          skipped++;
          continue;
        }
        await createTemplate.mutateAsync({
          data: {
            name: friendly || res.name,
            description: null,
            category: "knowledge",
            width: res.width,
            height: res.height,
            sourceImageUrl: asset.url,
            config: { kind: "freeform", elements },
          },
        });
        done++;
      } catch {
        failed++;
      }
    }
    setLearnProgress(null);
    setLearning(false);
    queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });

    const extra: string[] = [];
    if (skipped) extra.push(`${skipped} had no detectable layout`);
    if (failed) extra.push(`${failed} failed`);
    toast({
      title: done
        ? `Learned ${done} file${done === 1 ? "" : "s"} into Knowledge`
        : "No files learned",
      description: extra.join(" · ") || "Their sizes and layouts were captured.",
      variant: done ? undefined : "destructive",
    });
  };

  // Group assets into folders; unfiled assets render first, ungrouped, so a
  // library that never uses folders looks exactly like it did before.
  // Template folders live on the Templates page, not here.
  const visibleAssets = (assets ?? []).filter((a) => !isTemplateFolder(a.folder));
  const folderNames = Array.from(
    new Set(visibleAssets.map((a) => a.folder).filter((f): f is string => !!f)),
  ).sort((a, b) => a.localeCompare(b));
  const unfiled = visibleAssets.filter((a) => !a.folder);
  const byFolder = new Map(
    folderNames.map((f) => [f, visibleAssets.filter((a) => a.folder === f)]),
  );

  const handlePickUploadFolder = (value: string) => {
    if (value === "__new__") {
      const name = window.prompt("New folder name");
      setUploadFolder(name?.trim() || "");
    } else {
      setUploadFolder(value);
    }
  };

  const renderAssetCard = (asset: NonNullable<typeof assets>[number]) => {
    const isCurrentLogo = brand.logoUrl === asset.url;
    // Non-image files (PDFs, video project files, …) can't render in an <img>;
    // show a document tile that opens the file instead.
    const isFile =
      asset.kind === "file" || !(asset.contentType ?? "image/").startsWith("image/");
    const fileExt = asset.name.split(".").pop()?.toUpperCase();
    return (
      <Card key={asset.id} className="overflow-hidden group relative">
        {isFile ? (
          <a
            href={asset.url}
            target="_blank"
            rel="noreferrer"
            className="aspect-square bg-muted/40 flex flex-col items-center justify-center gap-2 p-2 hover:bg-muted/70"
            title={`Open ${asset.name}`}
          >
            <FileText className="w-10 h-10 text-muted-foreground" />
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
              {fileExt}
            </Badge>
          </a>
        ) : (
          <div className="aspect-square bg-muted/40 flex items-center justify-center p-2">
            <img
              src={asset.url}
              alt={asset.name}
              loading="lazy"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}
        {isCurrentLogo && (
          <Badge className="absolute top-1.5 left-1.5 text-[10px] h-5 px-1.5 gap-1">
            <Star className="w-2.5 h-2.5 fill-current" />
            Logo
          </Badge>
        )}
        <div className="p-2 space-y-1.5">
          <p className="text-xs font-medium truncate" title={asset.name}>
            {asset.name}
          </p>
          {isAdmin && (
            <div className="flex gap-1">
              {!isFile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] px-1.5 flex-1 gap-1"
                  disabled={isCurrentLogo || updateBrand.isPending}
                  onClick={() => handleSetLogo(asset.url)}
                >
                  <Star className="w-3 h-3" />
                  {isCurrentLogo ? "Logo" : "Set logo"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-destructive hover:text-destructive"
                disabled={deleteAsset.isPending}
                onClick={() => handleDelete(asset.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <BrandHeader brand={brand} />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BrandHeader brand={brand} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Reusable logos and images for this brand. Upload once, then set a logo,
          pick an image as a brief's product image, or learn creatives into
          Knowledge to reuse their sizes and layouts.
        </p>
        <div className="flex items-center gap-2">
          {isAdmin && (assets?.length ?? 0) > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={learning}
              onClick={handleLearnAll}
            >
              {learning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {learning
                ? learnProgress
                  ? `Learning ${learnProgress.done + 1}/${learnProgress.total}…`
                  : "Learning…"
                : "Learn all into Knowledge"}
            </Button>
          )}
          {canUpload && (
            <div className="flex items-center gap-2">
              <select
                value={uploadFolder}
                onChange={(e) => handlePickUploadFolder(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs text-muted-foreground"
                title="Folder for new uploads"
              >
                <option value="">No folder</option>
                {folderNames.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
                {uploadFolder && !folderNames.includes(uploadFolder) && (
                  <option value={uploadFolder}>{uploadFolder}</option>
                )}
                <option value="__new__">New folder…</option>
              </select>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                className="gap-1.5"
                disabled={isUploading || createAsset.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading || createAsset.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {isUploading || createAsset.isPending
                  ? pendingName
                    ? `Uploading ${pendingName}…`
                    : "Uploading…"
                  : "Upload assets"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {!assets?.length ? (
        <Card className="border-dashed p-10 text-center">
          <ImageIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-sm">No assets yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
            {canUpload
              ? "Upload logos or product images to build a reusable library for this brand."
              : "Sign in to upload logos or product images to this brand library."}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {unfiled.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {unfiled.map(renderAssetCard)}
            </div>
          )}
          {folderNames.map((name) => {
            const items = byFolder.get(name) ?? [];
            const open = openFolders.has(name);
            return (
              <div key={name} className="rounded-xl border">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 rounded-xl"
                  onClick={() => toggleFolder(name)}
                >
                  {open ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{name}</span>
                  <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5">
                    {items.length}
                  </Badge>
                </button>
                {open && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-3 pt-0">
                    {items.map(renderAssetCard)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
