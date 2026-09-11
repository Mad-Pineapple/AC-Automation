import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetLayoutProfile, useUpdateLayoutProfileRules, getGetLayoutProfileQueryKey, type PartRules } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, SlidersHorizontal, Check } from "lucide-react";

/**
 * Behaviour rules per part of a campaign layout profile — the designer's
 * dials over what the measurements imply: where a part pins, how it sizes,
 * whether it may be dropped when a zone is tight, its minimum size, and what
 * it must never overlap. Saved on the profile; every later build uses them.
 */

const PARTS: Array<{ slot: string; label: string; pins: Array<[string, string]>; sizes: Array<[string, string]> }> = [
  { slot: "headline", label: "Headline (with sub-line)", pins: [["measured", "Where the examples put it"], ["top", "Top of the photo zone"], ["centre", "Centre of the photo zone"]], sizes: [["measured", "Measured share of the short side"]] },
  { slot: "cutout", label: "Cut-out (the car)", pins: [["on-copy", "Under the copy, as in the examples"], ["zone-bottom", "Bottom of the photo zone"], ["none", "Leave it out"]], sizes: [["measured", "Measured share of the zone width"]] },
  { slot: "band", label: "Pattern band", pins: [["panel-edge", "Panel's outer edge"], ["none", "Leave it out"]], sizes: [["fit-width", "Full zone width"]] },
  { slot: "message", label: "Message", pins: [["measured", "Measured height in the panel"]], sizes: [["measured", "Measured share"]] },
  { slot: "cta", label: "Button", pins: [["measured", "Measured height in the panel"]], sizes: [["fixed", "Placed asset at its pixel size"], ["scale", "Scale with the panel"], ["fit-width", "Fill the panel width"]] },
  { slot: "lockup", label: "Lockup", pins: [["measured", "Measured height in the panel"]], sizes: [["measured", "Measured share"]] },
  { slot: "logo", label: "Logo tile", pins: [["bottom", "Bottom-right, brand grid"]], sizes: [["measured", "Grid division of the short side"]] },
];

export function PartRulesEditor({ profileId }: { profileId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const profile = useGetLayoutProfile(profileId, { query: { queryKey: getGetLayoutProfileQueryKey(profileId) } });
  const save = useUpdateLayoutProfileRules();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, PartRules>>({});
  useEffect(() => {
    if (profile.data?.rules) setDraft(profile.data.rules as Record<string, PartRules>);
  }, [profile.data]);
  const set = (slot: string, patch: Partial<PartRules>) => setDraft((d) => ({ ...d, [slot]: { ...(d[slot] ?? {}), ...patch } }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.data?.rules ?? {});

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 text-xs" data-testid="part-rules">
      <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left" onClick={() => setOpen((o) => !o)} data-testid="part-rules-toggle">
        <span className="flex items-center gap-1.5 font-semibold"><SlidersHorizontal className="w-3.5 h-3.5" /> Part rules for this campaign</span>
        <span className="text-muted-foreground">{open ? "Hide" : "Adjust"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-muted-foreground">Defaults come from the measured examples. Change a rule and every size built from this profile follows it; the check rejects a size that breaks a minimum or an overlap rule.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground uppercase tracking-wide text-[10px]">
                  <th className="text-left py-1 pr-2">Part</th>
                  <th className="text-left py-1 pr-2">Pinned to</th>
                  <th className="text-left py-1 pr-2">Size</th>
                  <th className="text-left py-1 pr-2">Drop when tight</th>
                  <th className="text-left py-1 pr-2">Min px</th>
                  <th className="text-left py-1">Never overlaps</th>
                </tr>
              </thead>
              <tbody>
                {PARTS.map((p) => {
                  const r = draft[p.slot] ?? {};
                  return (
                    <tr key={p.slot} className="border-t border-border/40">
                      <td className="py-1 pr-2 font-medium whitespace-nowrap">{p.label}</td>
                      <td className="py-1 pr-2">
                        <select className="bg-background border border-border rounded px-1 py-0.5" value={r.pin ?? p.pins[0][0]} onChange={(e) => set(p.slot, { pin: e.target.value as PartRules["pin"] })} data-testid={`rule-pin-${p.slot}`}>
                          {p.pins.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <select className="bg-background border border-border rounded px-1 py-0.5" value={r.size ?? p.sizes[0][0]} onChange={(e) => set(p.slot, { size: e.target.value as PartRules["size"] })} data-testid={`rule-size-${p.slot}`}>
                          {p.sizes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <input type="checkbox" checked={!!r.dropWhenTight} onChange={(e) => set(p.slot, { dropWhenTight: e.target.checked })} data-testid={`rule-drop-${p.slot}`} />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" min={0} max={2000} className="w-16 bg-background border border-border rounded px-1 py-0.5" value={r.minPx ?? ""} onChange={(e) => set(p.slot, { minPx: e.target.value === "" ? undefined : Number(e.target.value) })} data-testid={`rule-min-${p.slot}`} />
                      </td>
                      <td className="py-1 text-muted-foreground">{(r.neverOverlap ?? []).join(", ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate(
                  { id: profileId, data: { rules: draft } },
                  {
                    onSuccess: () => {
                      queryClient.invalidateQueries({ queryKey: getGetLayoutProfileQueryKey(profileId) });
                      toast({ title: "Rules saved", description: "Every size built from this profile now follows them." });
                    },
                    onError: (e) => toast({ title: "Could not save the rules", description: e instanceof Error ? e.message.slice(0, 160) : undefined, variant: "destructive" }),
                  },
                )
              }
              data-testid="button-save-rules"
            >
              {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Save rules
            </Button>
            {profile.isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          </div>
        </div>
      )}
    </div>
  );
}
