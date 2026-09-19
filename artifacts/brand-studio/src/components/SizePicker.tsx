import { Button } from "@/components/ui/button";
import { presetsByGroup, orientationOf, type AdaptPreset, type Orientation } from "@/lib/adaptPresets";

/** The size drawn to proportion, so portrait and landscape read at a glance
 *  before the numbers do. Extreme strips keep a visible 4px minimum. */
export function ShapeGlyph({ width, height, active = false, box = 26 }: { width: number; height: number; active?: boolean; box?: number }) {
  const k = box / Math.max(width, height);
  const w = Math.max(4, Math.round(width * k));
  const h = Math.max(4, Math.round(height * k));
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: box, height: box }} aria-hidden>
      <span className={`rounded-[2px] border-2 ${active ? "border-primary bg-primary/20" : "border-muted-foreground/60 bg-muted"}`} style={{ width: w, height: h }} />
    </span>
  );
}

const ORIENTATION_STYLE: Record<Orientation, string> = {
  Portrait: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  Landscape: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  Square: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
};

export function OrientationTag({ width, height }: { width: number; height: number }) {
  const o = orientationOf(width, height);
  return <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide ${ORIENTATION_STYLE[o]}`}>{o}</span>;
}

/**
 * The size catalogue as a picker, grouped by how the piece is delivered
 * (OOH / HTML / Statics / Print), with the placement each size runs in
 * beside its dimensions. Shared by Adapt to other sizes and the import page.
 */
export function SizePicker({
  selected,
  onToggle,
  onSetMany,
  testPrefix = "adapt-target",
  columns = "grid-cols-1 sm:grid-cols-2",
}: {
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSetMany?: (keys: string[], on: boolean) => void;
  testPrefix?: string;
  columns?: string;
}) {
  const groups = presetsByGroup();
  return (
    <div className="space-y-4">
      {groups.map(({ group, presets }) => {
        const allOn = presets.every((p) => selected.has(p.key));
        return (
          <section key={group.key} data-testid={`size-group-${group.key}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide">{group.label}</h4>
                <p className="text-[11px] text-muted-foreground">{group.hint}</p>
              </div>
              {onSetMany && (
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onSetMany(presets.map((p) => p.key), !allOn)} data-testid={`size-group-toggle-${group.key}`}>
                  {allOn ? "Clear" : "Select all"}
                </Button>
              )}
            </div>
            <div className={`grid ${columns} gap-1.5`}>
              {presets.map((p: AdaptPreset) => {
                const on = selected.has(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onToggle(p.key)}
                    aria-pressed={on}
                    className={`flex items-center gap-2.5 rounded-lg border-2 px-3 py-1.5 text-left transition-colors ${on ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40"}`}
                    data-testid={`${testPrefix}-${p.key}`}
                    title={`${p.label} — ${orientationOf(p.width, p.height)} ${p.width}×${p.height}`}
                  >
                    <ShapeGlyph width={p.width} height={p.height} active={on} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium leading-tight">
                        {p.label}
                        <span className="font-mono text-[11px] font-normal text-muted-foreground">{p.width}×{p.height}</span>
                        <OrientationTag width={p.width} height={p.height} />
                      </span>
                      <span className="block text-[11px] text-muted-foreground leading-snug">{p.placement}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
