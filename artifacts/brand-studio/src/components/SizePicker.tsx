import { Button } from "@/components/ui/button";
import { presetsByGroup, type AdaptPreset } from "@/lib/adaptPresets";

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
                    className={`rounded-lg border-2 px-3 py-1.5 text-left transition-colors ${on ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40"}`}
                    data-testid={`${testPrefix}-${p.key}`}
                  >
                    <p className="text-sm font-medium leading-tight">
                      {p.label} <span className="font-mono text-[11px] text-muted-foreground">{p.width}×{p.height}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-snug">{p.placement}</p>
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
