import type { Brand } from "@workspace/api-client-react";

const FONT_STACKS: Record<string, string> = {
  "Plus Jakarta Sans": "Plus Jakarta Sans, sans-serif",
  "Space Grotesk": "Space Grotesk, monospace",
  Georgia: "Georgia, serif",
  "Playfair Display": "Playfair Display, serif",
  Inter: "Inter, sans-serif",
};

export function BrandIdentityPreview({ brand }: { brand: Brand }) {
  const swatches = [
    { label: "Primary", color: brand.primaryColor },
    { label: "Secondary", color: brand.secondaryColor },
    { label: "Accent", color: brand.accentColor },
  ];

  const fontStack = FONT_STACKS[brand.fontFamily] ?? "Inter, sans-serif";

  return (
    <div
      className="flex items-center gap-4 rounded-lg border border-border/50 bg-muted/30 p-3"
      data-testid="brand-identity-preview"
    >
      <div
        className="flex h-12 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-border"
        style={{ backgroundColor: brand.backgroundColor || "#f0f0f0" }}
      >
        {brand.logoUrl ? (
          <img src={brand.logoUrl} alt={brand.name} className="h-9 object-contain" />
        ) : (
          <span
            className="px-1 text-xs font-bold leading-tight"
            style={{ color: brand.textColor || "#000" }}
          >
            {brand.name}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{brand.name}</p>
        <div className="mt-1.5 flex items-center gap-2">
          {swatches.map(({ label, color }) =>
            color ? (
              <div
                key={label}
                className="h-5 w-5 rounded-full border border-border shadow-sm"
                style={{ backgroundColor: color }}
                title={`${label}: ${color}`}
                data-testid={`swatch-${label.toLowerCase()}`}
              />
            ) : null,
          )}
        </div>
        {(brand.fontFamily || brand.toneOfVoice) && (
          <div className="mt-2 space-y-0.5">
            {brand.fontFamily && (
              <p
                className="truncate text-xs text-muted-foreground"
                title={brand.fontFamily}
                data-testid="brand-font-family"
              >
                <span className="font-medium text-foreground/70">Font:</span>{" "}
                <span style={{ fontFamily: fontStack }}>{brand.fontFamily}</span>
              </p>
            )}
            {brand.toneOfVoice && (
              <p
                className="truncate text-xs text-muted-foreground"
                title={brand.toneOfVoice}
                data-testid="brand-tone-of-voice"
              >
                <span className="font-medium text-foreground/70">Tone:</span> {brand.toneOfVoice}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
