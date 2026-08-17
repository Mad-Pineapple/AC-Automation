import { useState } from "react";
import { useUser } from "@clerk/react";
import { useListBrands } from "@workspace/api-client-react";
import { useMe } from "@/hooks/use-me";
import { BrandLibrary } from "@/components/BrandLibrary";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Images } from "lucide-react";

/**
 * Standalone brand library browser (top-level "Library" nav item), so imagery
 * and files can be explored independently of building a brief. Reuses the
 * same BrandLibrary component as the brand edit page's Library tab.
 */
export default function LibraryPage() {
  const { isSignedIn } = useUser();
  const { data: meData } = useMe();
  const isAdmin = meData?.role === "admin";
  const { data: brands, isLoading } = useListBrands();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const brand =
    brands?.find((b) => b.id === selectedId) ?? brands?.[0] ?? null;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight font-sans">Library</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm uppercase tracking-widest">
            Brand imagery, logos & files
          </p>
        </div>
        {brands && brands.length > 1 && (
          <Select
            value={String(brand?.id ?? "")}
            onValueChange={(v) => setSelectedId(Number(v))}
          >
            <SelectTrigger className="w-56" data-testid="select-library-brand">
              <SelectValue placeholder="Select a brand" />
            </SelectTrigger>
            <SelectContent>
              {brands.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-xl" />
          ))}
        </div>
      ) : !brand ? (
        <Card className="border-dashed bg-transparent p-12 text-center">
          <Images className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium">No brands found</h3>
          <p className="text-muted-foreground mt-1">
            Create a brand first — its library lives here.
          </p>
        </Card>
      ) : (
        <BrandLibrary
          brandId={brand.id}
          brand={brand}
          isAdmin={isAdmin}
          canUpload={!!isSignedIn}
        />
      )}
    </div>
  );
}
