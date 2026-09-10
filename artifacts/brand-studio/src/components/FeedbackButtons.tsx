import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The parts of a piece and the kinds of fault — the same lists the server
 * accepts (routes/feedback.ts). Structured so a verdict is machine-readable. */
export const FEEDBACK_ELEMENTS: { value: string; label: string }[] = [
  { value: "whole", label: "Whole piece" },
  { value: "photo", label: "Photo" },
  { value: "headline", label: "Headline" },
  { value: "subheadline", label: "Sub-line" },
  { value: "message", label: "Message" },
  { value: "cta", label: "Search pill / button" },
  { value: "band", label: "Pattern band" },
  { value: "panel", label: "Panel" },
  { value: "lockup", label: "Logo lockup" },
  { value: "logo", label: "Logo tile" },
  { value: "copy", label: "Copy / wording" },
];
export const FEEDBACK_FAULTS: { value: string; label: string }[] = [
  { value: "too_big", label: "Too big" },
  { value: "too_small", label: "Too small" },
  { value: "wrong_position", label: "Wrong position" },
  { value: "cut_off", label: "Cut off" },
  { value: "missing", label: "Missing" },
  { value: "illegible", label: "Illegible" },
  { value: "wrong_style", label: "Wrong style for this campaign" },
  { value: "off_brand_colour_or_font", label: "Off-brand colour or font" },
  { value: "wrong_crop", label: "Wrong crop" },
  { value: "other", label: "Something else" },
];
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface FeedbackItem {
  id: number;
  subjectType: string;
  subjectId: number;
  verdict: "correct" | "incorrect";
  elementId: string | null;
  elementLabel: string | null;
  note: string | null;
}

export async function postFeedback(payload: {
  subjectType: "template" | "asset";
  subjectId: number;
  verdict: "correct" | "incorrect";
  note?: string;
  elementId?: string;
  elementLabel?: string;
  elementSlot?: string;
  fault?: string;
  expected?: string;
  severity?: "send_back" | "fix_next_time";
}): Promise<boolean> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export function useFeedbackList(subjectType: "template" | "asset") {
  return useQuery<{ items: FeedbackItem[] }>({
    queryKey: ["feedback", subjectType],
    queryFn: async () => {
      const res = await fetch(`/api/feedback?subjectType=${subjectType}`, { credentials: "include" });
      if (!res.ok) throw new Error("feedback fetch failed");
      return res.json();
    },
    staleTime: 30_000,
  });
}

/**
 * Right/Wrong verdict buttons for a whole piece (WIP artwork, template, or a
 * generated asset). "Wrong" opens a note box — say WHAT is wrong; the note is
 * stored as a do-not-repeat rule that future generation prompts read back.
 */
export function FeedbackButtons({
  subjectType,
  subjectId,
  size = "sm",
}: {
  subjectType: "template" | "asset";
  subjectId: number;
  size?: "sm" | "default";
}) {
  const { data } = useFeedbackList(subjectType);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [element, setElement] = useState("whole");
  const [fault, setFault] = useState("");
  const [expected, setExpected] = useState("");
  const [severity, setSeverity] = useState<"send_back" | "fix_next_time">("send_back");
  const [busy, setBusy] = useState(false);

  // Latest verdict wins for display.
  const latest = (data?.items ?? []).find((i) => i.subjectId === subjectId && !i.elementId);

  const submit = async (verdict: "correct" | "incorrect", n?: string) => {
    setBusy(true);
    const ok = await postFeedback({
      subjectType,
      subjectId,
      verdict,
      note: n,
      ...(verdict === "incorrect"
        ? {
            elementSlot: element,
            ...(fault ? { fault } : {}),
            ...(expected.trim() ? { expected: expected.trim() } : {}),
            severity,
          }
        : {}),
    });
    setBusy(false);
    if (!ok) {
      toast({ title: "Sign in to leave feedback", variant: "destructive" });
      return;
    }
    const faultLabel = FEEDBACK_FAULTS.find((f) => f.value === fault)?.label;
    const elementLabel = FEEDBACK_ELEMENTS.find((e) => e.value === element)?.label;
    toast({
      title: verdict === "correct" ? "Marked as right" : "Marked as wrong",
      description:
        verdict === "incorrect"
          ? `${elementLabel ?? "Piece"}${faultLabel ? `: ${faultLabel.toLowerCase()}` : ""}${expected.trim() ? ` — expected ${expected.trim()}` : ""}. The engine reads this on the next piece of this shape.`
          : undefined,
    });
    setNoteOpen(false);
    setNote("");
    setFault("");
    setExpected("");
    setElement("whole");
    setSeverity("send_back");
    queryClient.invalidateQueries({ queryKey: ["feedback", subjectType] });
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant={latest?.verdict === "correct" ? "default" : "outline"}
          size={size}
          className={cn("gap-1.5", latest?.verdict === "correct" && "bg-[#5b9c33] hover:bg-[#4e8a2b] text-white")}
          disabled={busy}
          onClick={() => submit("correct")}
          data-testid={`feedback-right-${subjectType}-${subjectId}`}
          title="This is right"
        >
          <ThumbsUp className="w-3.5 h-3.5" />
          Right
        </Button>
        <Button
          type="button"
          variant={latest?.verdict === "incorrect" ? "destructive" : "outline"}
          size={size}
          className="gap-1.5"
          disabled={busy}
          onClick={() => setNoteOpen(true)}
          data-testid={`feedback-wrong-${subjectType}-${subjectId}`}
          title="Something is wrong — tell the studio what"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
          Wrong
        </Button>
      </div>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>What's wrong?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Say which part, what kind of fault, and what you expected. Each answer becomes a rule the engine checks on the next piece of this shape.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fb-element">Which part</Label>
              <Select value={element} onValueChange={setElement}>
                <SelectTrigger id="fb-element" data-testid="feedback-element"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FEEDBACK_ELEMENTS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-fault">What is wrong</Label>
              <Select value={fault} onValueChange={setFault}>
                <SelectTrigger id="fb-fault" data-testid="feedback-fault"><SelectValue placeholder="Pick a fault" /></SelectTrigger>
                <SelectContent>
                  {FEEDBACK_FAULTS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fb-expected">What you expected (a number or a short rule)</Label>
            <Input id="fb-expected" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder='e.g. "pill about 32px tall" or "lockup at the bottom of the panel"' data-testid="feedback-expected" />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Severity</span>
            {([["send_back", "Send back"], ["fix_next_time", "Fix next time"]] as const).map(([v, l]) => (
              <Button key={v} type="button" size="sm" variant={severity === v ? "default" : "outline"} className="h-7" onClick={() => setSeverity(v)} data-testid={`feedback-severity-${v}`}>{l}</Button>
            ))}
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything the fields don't capture (optional)"
            rows={2}
            data-testid="feedback-note"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || !fault}
              onClick={() => submit("incorrect", note)}
              data-testid="feedback-note-submit"
            >
              Mark wrong
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
