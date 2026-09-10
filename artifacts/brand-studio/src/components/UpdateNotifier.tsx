import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A long-lived SPA tab keeps running old code after a deploy — imports and
 * fixes silently misbehave. This watches the served page's ETag (checked on
 * window focus and every few minutes) and, when a new build is live, shows a
 * bar asking for one click to reload.
 */
export function UpdateNotifier() {
  const [updateReady, setUpdateReady] = useState(false);
  const baseline = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const res = await fetch("/", { method: "HEAD", cache: "no-store" });
        const tag = res.headers.get("etag");
        if (!tag || stop) return;
        if (baseline.current === null) baseline.current = tag;
        else if (tag !== baseline.current) setUpdateReady(true);
      } catch {
        /* offline — try again later */
      }
    };
    check();
    const interval = setInterval(check, 3 * 60 * 1000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      stop = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-3 bg-[#11263d] text-white text-sm px-4 py-2.5 shadow-lg">
      <span>
        A new version of the studio is available — reload to use the latest features.
      </span>
      <Button
        size="sm"
        className="h-7 bg-white text-[#11263d] hover:bg-white/90 gap-1.5"
        onClick={() => window.location.reload()}
        data-testid="button-reload-update"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Reload now
      </Button>
    </div>
  );
}
