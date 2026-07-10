import { type Brand } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";

export function BrandHeader({ brand }: { brand: Brand }) {
  const swatches = [
    { label: "Primary", color: brand.primaryColor },
    { label: "Secondary", color: brand.secondaryColor },
    { label: "Accent", color: brand.accentColor },
    { label: "Background", color: brand.backgroundColor },
    { label: "Text", color: brand.textColor },
  ].filter((s) => s.color);

  return (
    <Card className="flex items-center gap-4 p-3 border-border/60">
      <div
        className="w-12 h-12 rounded-lg border border-border flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={{ backgroundColor: brand.backgroundColor || "#f4f4f5" }}
      >
        {brand.logoUrl ? (
          <img
            src={brand.logoUrl}
            alt={brand.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span
            className="text-lg font-bold"
            style={{ color: brand.textColor || "#000" }}
          >
            {brand.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">{brand.name}</p>
        {brand.industry && (
          <p className="text-xs text-muted-foreground truncate">{brand.industry}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {swatches.map(({ label, color }) => (
          <div
            key={label}
            className="w-5 h-5 rounded-md border border-border"
            style={{ backgroundColor: color }}
            title={`${label}: ${color}`}
          />
        ))}
      </div>
    </Card>
  );
}
