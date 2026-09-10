import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface AttentionItem {
  id: string;
  kind: "review" | "compliance" | "wip" | "note";
  emoji: string;
  title: string;
  message: string;
  href: string;
}

const KIND_ACCENT: Record<AttentionItem["kind"], string> = {
  review: "border-l-[#0073bd]",
  compliance: "border-l-[#de0a2b]",
  wip: "border-l-[#f59e0b]",
  note: "border-l-[#5b9c33]",
};

const DISMISS_KEY = "stanDismissed";

function dismissedSet(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/**
 * Chat (was Stan) — the studio assistant. Floats small speech bubbles bottom-right for
 * anything that needs attention (campaigns waiting on review, compliance
 * failures, imports parked in WIP). Click a bubble to read the full message
 * and jump straight to the right page; dismiss to quiet it for this session.
 */
export function StanBubbles() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const { data } = useQuery<{ items: AttentionItem[] }>({
    queryKey: ["stan-attention"],
    queryFn: async () => {
      const res = await fetch("/api/attention", { credentials: "include" });
      if (!res.ok) throw new Error("attention fetch failed");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const dismissed = dismissedSet();
  const items = (data?.items ?? []).filter((i) => !dismissed.has(i.id));
  if (items.length === 0) return null;

  const dismiss = (id: string) => {
    const next = dismissedSet();
    next.add(id);
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
    } catch {
      /* private mode — bubbles just persist */
    }
    if (openId === id) setOpenId(null);
    setTick((t) => t + 1);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2.5 max-w-[calc(100vw-2.5rem)]">
      {items.map((item) => {
        const open = openId === item.id;
        return (
          <div key={item.id} className="flex flex-col items-end">
            {open ? (
              <div
                className={cn(
                  "relative w-80 max-w-full rounded-2xl rounded-br-sm border border-border bg-card text-card-foreground shadow-xl border-l-4 p-4",
                  KIND_ACCENT[item.kind],
                )}
                data-testid={`stan-open-${item.id}`}
              >
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground"
                  onClick={() => dismiss(item.id)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-start gap-2.5 pr-5">
                  <span className="text-xl leading-none mt-0.5">{item.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.message}</p>
                    <Link
                      href={item.href}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary mt-2.5 hover:underline"
                      onClick={() => setOpenId(null)}
                    >
                      Take me there <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
                {/* speech-bubble tail */}
                <div className="absolute -bottom-[7px] right-5 w-3.5 h-3.5 rotate-45 bg-card border-b border-r border-border" />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                className="group relative flex items-center gap-2 rounded-full rounded-br-sm border border-border bg-card text-card-foreground shadow-lg pl-3 pr-4 py-2 text-xs font-semibold hover:shadow-xl hover:-translate-y-0.5 transition-all"
                data-testid={`stan-bubble-${item.id}`}
              >
                <span className="text-base leading-none">{item.emoji}</span>
                <span className="truncate max-w-[180px]">{item.title}</span>
                {/* speech-bubble tail */}
                <span className="absolute -bottom-[5px] right-4 w-2.5 h-2.5 rotate-45 bg-card border-b border-r border-border" />
              </button>
            )}
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground/70 pr-1 select-none">Chat · studio assistant</p>
    </div>
  );
}
