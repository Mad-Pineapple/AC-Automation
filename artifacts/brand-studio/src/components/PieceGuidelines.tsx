import { useState } from "react";
import { useAuth } from "@clerk/react";
import { BookOpen, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { tokenOrNull } from "@/lib/authToken";

interface Passage { heading: string; body: string; source: string }
interface Item { topic: string; label: string; elementIds: string[]; passages: Passage[] }

/**
 * The brand-guideline passages that apply to what is on this piece (a logo
 * tile, a pattern band, a photograph…). Read on request: they used to be
 * copied into every build's notes, where they buried the rejections and
 * "left out" lines a designer actually needs to see.
 */
export function PieceGuidelines({ templateId }: { templateId: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { getToken } = useAuth();

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || items || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const token = await tokenOrNull(getToken);
      const res = await fetch(`/api/guidelines/for-template/${templateId}`, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { items?: Item[] };
      setItems(body.items ?? []);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 border-t border-border/50 pt-2" data-testid="piece-guidelines">
      <button type="button" onClick={toggle} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground" data-testid="button-piece-guidelines" aria-expanded={open}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <BookOpen className="h-3.5 w-3.5" />
        Guidelines for this piece
      </button>
      {open && (
        <div className="mt-2 space-y-2.5">
          {busy && <p className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Reading the guidelines…</p>}
          {failed && <p className="text-muted-foreground">The guidelines could not be read just now.</p>}
          {items && items.length === 0 && <p className="text-muted-foreground">No indexed guideline passages apply to what is on this piece.</p>}
          {items?.map((g) => (
            <div key={g.topic}>
              <p className="font-semibold text-foreground">{g.label}</p>
              <ul className="mt-0.5 list-disc space-y-1 pl-4 text-muted-foreground">
                {g.passages.slice(0, 3).map((p, i) => (
                  <li key={i}>
                    {p.heading && <span className="font-medium text-foreground/80">{p.heading}: </span>}
                    {p.body.length > 260 ? `${p.body.slice(0, 260)}…` : p.body}
                    <span className="ml-1 text-[10px] opacity-70">({p.source})</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
