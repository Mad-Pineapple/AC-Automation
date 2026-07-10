import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Brand, FreeformElement } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  defaultImageFit,
  freeformBaseStyle,
  freeformImageStyle,
  freeformRectStyle,
  freeformTextStyle,
} from "@/components/TemplateRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Type,
  Square,
  ImageIcon,
  Trash2,
  ChevronUp,
  ChevronDown,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Loader2,
  Undo2,
  Redo2,
} from "lucide-react";

const TEXT_ROLES = ["headline", "subhead", "body", "cta", "other"] as const;
const IMAGE_ROLES = ["product", "logo", "decoration"] as const;
const MIN_SIZE = 8;
const HISTORY_LIMIT = 100;

type Box = { x: number; y: number; w: number; h: number };
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_POS: Record<Handle, { left: string; top: string; cursor: string }> = {
  nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
  n: { left: "50%", top: "0%", cursor: "ns-resize" },
  ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
  e: { left: "100%", top: "50%", cursor: "ew-resize" },
  se: { left: "100%", top: "100%", cursor: "nwse-resize" },
  s: { left: "50%", top: "100%", cursor: "ns-resize" },
  sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
  w: { left: "0%", top: "50%", cursor: "ew-resize" },
};

function resizeBox(orig: Box, handle: Handle, dx: number, dy: number): Box {
  let { x, y, w, h } = orig;
  if (handle.includes("e")) w = Math.max(MIN_SIZE, orig.w + dx);
  if (handle.includes("s")) h = Math.max(MIN_SIZE, orig.h + dy);
  if (handle.includes("w")) {
    w = Math.max(MIN_SIZE, orig.w - dx);
    x = orig.x + (orig.w - w);
  }
  if (handle.includes("n")) {
    h = Math.max(MIN_SIZE, orig.h - dy);
    y = orig.y + (orig.h - h);
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

let uid = 0;
function newId(prefix: string): string {
  uid += 1;
  return `${prefix}_${Date.now().toString(36)}_${uid}`;
}

interface FreeformEditorProps {
  width: number;
  height: number;
  brand: Brand;
  initialElements: FreeformElement[];
  onChange: (elements: FreeformElement[]) => void;
}

interface DragState {
  mode: "move" | "resize";
  handle?: Handle;
  id: string;
  startX: number;
  startY: number;
  orig: Box;
}

export function FreeformEditor({ width, height, brand, initialElements, onChange }: FreeformEditorProps) {
  const [els, setEls] = useState<FreeformElement[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [, setHistTick] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pastRef = useRef<FreeformElement[][]>([]);
  const futureRef = useRef<FreeformElement[][]>([]);
  const dragStartElsRef = useRef<FreeformElement[] | null>(null);
  const draggedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const { uploadFile, isUploading } = useUpload();

  // Fit the (width x height) canvas into the available column width.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => {
      const avail = node.clientWidth;
      if (avail > 0) setScale(Math.min(1, avail / width));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [width]);

  const selected = els.find((e) => e.id === selectedId) ?? null;
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  // Push a snapshot of the current elements onto the undo stack (and clear the
  // redo stack). Called just before any mutation so it can be reverted.
  const recordPast = useCallback((snapshot: FreeformElement[]) => {
    const past = pastRef.current;
    if (past.length > 0 && past[past.length - 1] === snapshot) return;
    pastRef.current = [...past, snapshot].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    setHistTick((t) => t + 1);
  }, []);

  // Apply a change and notify the parent, recording the prior state for undo.
  const mutate = useCallback(
    (fn: (prev: FreeformElement[]) => FreeformElement[]) => {
      recordPast(els);
      setEls((prev) => {
        const next = fn(prev);
        onChangeRef.current(next);
        return next;
      });
    },
    [els, recordPast],
  );

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const previous = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [els, ...futureRef.current].slice(0, HISTORY_LIMIT);
    setEls(previous);
    onChangeRef.current(previous);
    setSelectedId(null);
    setHistTick((t) => t + 1);
  }, [els]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, els].slice(-HISTORY_LIMIT);
    setEls(next);
    onChangeRef.current(next);
    setSelectedId(null);
    setHistTick((t) => t + 1);
  }, [els]);

  const patchSelected = useCallback(
    (patch: Partial<FreeformElement>) => {
      if (!selectedId) return;
      mutate((prev) => prev.map((e) => (e.id === selectedId ? ({ ...e, ...patch } as FreeformElement) : e)));
    },
    [mutate, selectedId],
  );

  // ---- Pointer drag / resize ------------------------------------------------

  const beginDrag = (e: React.PointerEvent, el: FreeformElement, mode: "move" | "resize", handle?: Handle) => {
    if (e.button !== 0 || !el.id) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSelectedId(el.id);
    dragStartElsRef.current = els;
    draggedRef.current = false;
    dragRef.current = {
      mode,
      handle,
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: el.x ?? 0, y: el.y ?? 0, w: el.w ?? 0, h: el.h ?? 0 },
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    draggedRef.current = true;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    setEls((prev) =>
      prev.map((el) => {
        if (el.id !== d.id) return el;
        if (d.mode === "move") {
          return { ...el, x: Math.round(d.orig.x + dx), y: Math.round(d.orig.y + dy) };
        }
        return { ...el, ...resizeBox(d.orig, d.handle!, dx, dy) };
      }),
    );
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    const startEls = dragStartElsRef.current;
    dragStartElsRef.current = null;
    // Record the pre-drag state for undo only when the element actually moved.
    if (draggedRef.current && startEls) recordPast(startEls);
    draggedRef.current = false;
    // Commit the final geometry to the parent.
    setEls((prev) => {
      onChangeRef.current(prev);
      return prev;
    });
  };

  // ---- Keyboard nudge / delete ----------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
    if (!typing && (e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (!typing && (e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      redo();
      return;
    }
    if (!selectedId) return;
    if (typing) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    mutate((prev) =>
      prev.map((el) => (el.id === selectedId ? { ...el, x: (el.x ?? 0) + m[0], y: (el.y ?? 0) + m[1] } : el)),
    );
  };

  // ---- Add / delete / reorder ----------------------------------------------

  const addElement = (type: "text" | "rect" | "image") => {
    const base = { id: newId(type), x: 40, y: 40, w: type === "text" ? 240 : 200, h: type === "text" ? 48 : 160 };
    let el: FreeformElement;
    if (type === "text") {
      el = { ...base, type: "text", role: "other", text: "New text", fontSize: 28, fontWeight: 400, color: "#111827", align: "left", lineHeight: 1.2 };
    } else if (type === "rect") {
      el = { ...base, type: "rect", fill: "#e5e7eb", radius: 0 };
    } else {
      el = { ...base, type: "image", role: "decoration", src: null };
    }
    mutate((prev) => [...prev, el]);
    setSelectedId(el.id!);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    mutate((prev) => prev.filter((e) => e.id !== selectedId));
    setSelectedId(null);
  };

  // Move an element one step in z-order (array order). dir +1 = forward (up).
  const reorder = (id: string, dir: 1 | -1) => {
    mutate((prev) => {
      const i = prev.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const replaceImage = async (file: File) => {
    const uploaded = await uploadFile(file);
    if (!uploaded || !selectedId) return;
    patchSelected({ src: `/api/storage${uploaded.objectPath}` } as Partial<FreeformElement>);
  };

  // ---- Render ---------------------------------------------------------------

  const handleSize = 10 / scale;
  const outline = 1.5 / scale;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
      {/* Canvas */}
      <div
        className="space-y-3 outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="freeform-editor"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => addElement("text")} data-testid="button-add-text">
            <Type className="w-4 h-4 mr-1.5" /> Text
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addElement("rect")} data-testid="button-add-rect">
            <Square className="w-4 h-4 mr-1.5" /> Shape
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => addElement("image")} data-testid="button-add-image">
            <ImageIcon className="w-4 h-4 mr-1.5" /> Image
          </Button>
          <div className="w-px h-6 bg-border mx-1" aria-hidden />
          <Button type="button" size="sm" variant="outline" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)" data-testid="button-undo">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘+Shift+Z)" data-testid="button-redo">
            <Redo2 className="w-4 h-4" />
          </Button>
          <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={removeSelected} disabled={!selectedId} title="Delete selected (Del)" data-testid="button-delete-selected">
            <Trash2 className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground font-mono ml-auto">
            {width}×{height}px · {Math.round(scale * 100)}%
          </span>
        </div>

        <div ref={containerRef} className="bg-muted/30 rounded-lg p-3 overflow-auto">
          <div style={{ width: width * scale, height: height * scale, position: "relative", margin: "0 auto" }}>
            <div
              onPointerDown={() => setSelectedId(null)}
              style={{
                width,
                height,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                position: "absolute",
                top: 0,
                left: 0,
                // Match FreeformCanvas, which always paints a white page so the
                // editor preview is faithful to the exported asset (a PDF page is
                // white by default; any colour is captured as a rect element).
                backgroundColor: "#ffffff",
                overflow: "hidden",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
              }}
            >
              {els.map((el, i) => {
                const isSel = el.id === selectedId;
                const base = freeformBaseStyle(el, i + 1);
                return (
                  <div
                    key={el.id ?? i}
                    onPointerDown={(e) => beginDrag(e, el, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    style={{
                      ...base,
                      cursor: "move",
                      boxShadow: isSel ? `0 0 0 ${outline}px #6366f1` : undefined,
                    }}
                    data-testid={`element-${el.id}`}
                  >
                    {el.type === "rect" && (
                      <div style={{ width: "100%", height: "100%", ...freeformRectStyle(el) }} />
                    )}
                    {el.type === "image" &&
                      (el.src ? (
                        <img src={el.src} alt="" draggable={false} style={{ width: "100%", height: "100%", ...freeformImageStyle(el) }} />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "#f1f5f9",
                            color: "#94a3b8",
                            fontSize: 14,
                            border: "1px dashed #cbd5e1",
                          }}
                        >
                          Image
                        </div>
                      ))}
                    {el.type === "text" && (
                      <div style={{ width: "100%", height: "100%", ...freeformTextStyle(el, brand.fontFamily) }}>
                        {el.text || "Text"}
                      </div>
                    )}

                    {isSel &&
                      HANDLES.map((h) => (
                        <div
                          key={h}
                          onPointerDown={(e) => beginDrag(e, el, "resize", h)}
                          onPointerMove={onPointerMove}
                          onPointerUp={onPointerUp}
                          style={{
                            position: "absolute",
                            left: HANDLE_POS[h].left,
                            top: HANDLE_POS[h].top,
                            width: handleSize,
                            height: handleSize,
                            marginLeft: -handleSize / 2,
                            marginTop: -handleSize / 2,
                            background: "#fff",
                            border: `${outline}px solid #6366f1`,
                            borderRadius: 2,
                            cursor: HANDLE_POS[h].cursor,
                            zIndex: 9999,
                          }}
                        />
                      ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Click to select · drag to move · drag handles to resize · arrow keys nudge (Shift = 10px) · Delete removes.
        </p>
      </div>

      {/* Inspector + layers */}
      <div className="space-y-4">
        <Inspector
          selected={selected}
          brandFont={brand.fontFamily}
          isUploading={isUploading}
          onPatch={patchSelected}
          onReplaceImage={replaceImage}
          onDelete={removeSelected}
        />
        <Layers
          els={els}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReorder={reorder}
        />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

function ColorField({
  label,
  value,
  onChange,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testid?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 rounded border border-border bg-transparent p-0.5"
          data-testid={testid ? `${testid}-swatch` : undefined}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 font-mono text-xs" data-testid={testid} />
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  testid,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  testid?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-xs"
        data-testid={testid}
      />
    </div>
  );
}

function Inspector({
  selected,
  brandFont,
  isUploading,
  onPatch,
  onReplaceImage,
  onDelete,
}: {
  selected: FreeformElement | null;
  brandFont: string;
  isUploading: boolean;
  onPatch: (patch: Partial<FreeformElement>) => void;
  onReplaceImage: (file: File) => void;
  onDelete: () => void;
}) {
  if (!selected) {
    return (
      <div className="rounded-lg border border-border/50 p-4 text-sm text-muted-foreground">
        Select an element to edit it.
      </div>
    );
  }

  const el = selected;

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold capitalize">{el.type}</span>
        <Button type="button" size="sm" variant="ghost" className="text-destructive h-7 px-2" onClick={onDelete} data-testid="button-delete-element">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={el.x ?? 0} onChange={(v) => onPatch({ x: v })} testid="input-x" />
        <NumField label="Y" value={el.y ?? 0} onChange={(v) => onPatch({ y: v })} testid="input-y" />
        <NumField label="W" value={el.w ?? 0} onChange={(v) => onPatch({ w: Math.max(MIN_SIZE, v) })} testid="input-w" />
        <NumField label="H" value={el.h ?? 0} onChange={(v) => onPatch({ h: Math.max(MIN_SIZE, v) })} testid="input-h" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Opacity · {Math.round((el.opacity ?? 1) * 100)}%</Label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={el.opacity ?? 1}
          onChange={(e) => onPatch({ opacity: Number(e.target.value) })}
          className="w-full"
          data-testid="input-opacity"
        />
      </div>

      {el.type === "text" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Text</Label>
            <Textarea
              value={el.text ?? ""}
              onChange={(e) => onPatch({ text: e.target.value })}
              rows={2}
              className="text-xs"
              data-testid="input-text"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Font size" value={el.fontSize ?? 16} onChange={(v) => onPatch({ fontSize: Math.max(1, v) })} testid="input-fontsize" />
            <div className="space-y-1.5">
              <Label className="text-xs">Style</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={(el.fontWeight ?? 400) >= 700 ? "default" : "outline"}
                  className="h-8 flex-1 px-0"
                  onClick={() => onPatch({ fontWeight: (el.fontWeight ?? 400) >= 700 ? 400 : 700 })}
                  data-testid="button-bold"
                >
                  <Bold className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={el.fontStyle === "italic" ? "default" : "outline"}
                  className="h-8 flex-1 px-0"
                  onClick={() => onPatch({ fontStyle: el.fontStyle === "italic" ? "normal" : "italic" })}
                  data-testid="button-italic"
                >
                  <Italic className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
          <ColorField label="Color" value={el.color ?? "#111827"} onChange={(v) => onPatch({ color: v })} testid="input-color" />
          <div className="space-y-1.5">
            <Label className="text-xs">Align</Label>
            <div className="flex gap-1">
              {([
                ["left", AlignLeft],
                ["center", AlignCenter],
                ["right", AlignRight],
              ] as const).map(([a, Icon]) => (
                <Button
                  key={a}
                  type="button"
                  size="sm"
                  variant={(el.align ?? "left") === a ? "default" : "outline"}
                  className="h-8 flex-1 px-0"
                  onClick={() => onPatch({ align: a })}
                  data-testid={`button-align-${a}`}
                >
                  <Icon className="w-4 h-4" />
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Font family</Label>
            <Input
              value={el.fontFamily ?? ""}
              placeholder={brandFont}
              onChange={(e) => onPatch({ fontFamily: e.target.value })}
              className="h-8 text-xs"
              data-testid="input-fontfamily"
            />
          </div>
          <RoleSelect roles={TEXT_ROLES} value={el.role ?? "other"} onChange={(v) => onPatch({ role: v })} />
        </>
      )}

      {el.type === "image" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Image</Label>
            <label className="block">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onReplaceImage(f);
                }}
              />
              <span
                className="flex items-center justify-center gap-2 h-9 rounded-md border border-input text-xs cursor-pointer hover:bg-muted/50"
                data-testid="button-replace-image"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                {isUploading ? "Uploading…" : el.src ? "Replace image" : "Upload image"}
              </span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fit</Label>
            <div className="flex gap-1">
              {(["cover", "contain"] as const).map((f) => {
                const active = (el.fit ?? defaultImageFit(el.role)) === f;
                return (
                  <Button
                    key={f}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-8 flex-1 px-0 text-xs capitalize"
                    onClick={() => onPatch({ fit: f })}
                    data-testid={`button-fit-${f}`}
                  >
                    {f}
                  </Button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">
              Cover fills the area (may crop). Contain fits the whole image inside.
            </p>
          </div>
          <NumField label="Corner radius" value={el.radius ?? 0} onChange={(v) => onPatch({ radius: Math.max(0, v) })} testid="input-radius" />
          <RoleSelect roles={IMAGE_ROLES} value={el.role ?? "decoration"} onChange={(v) => onPatch({ role: v })} />
        </>
      )}

      {el.type === "rect" && (
        <>
          <ColorField label="Fill" value={el.fill ?? "#e5e7eb"} onChange={(v) => onPatch({ fill: v })} testid="input-fill" />
          <NumField label="Corner radius" value={el.radius ?? 0} onChange={(v) => onPatch({ radius: Math.max(0, v) })} testid="input-radius" />
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Border width" value={el.borderWidth ?? 0} onChange={(v) => onPatch({ borderWidth: Math.max(0, v) })} testid="input-borderwidth" />
            <ColorField label="Border color" value={el.borderColor ?? "#000000"} onChange={(v) => onPatch({ borderColor: v })} testid="input-bordercolor" />
          </div>
        </>
      )}
    </div>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
}: {
  roles: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Role</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs" data-testid="select-role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r} value={r} className="capitalize text-xs">
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground leading-tight">
        Role decides which brief field (headline / body / product image…) fills this element.
      </p>
    </div>
  );
}

function Layers({
  els,
  selectedId,
  onSelect,
  onReorder,
}: {
  els: FreeformElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (id: string, dir: 1 | -1) => void;
}) {
  return (
    <div className="rounded-lg border border-border/50 p-3 space-y-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layers</span>
      <div className="space-y-1 max-h-64 overflow-auto">
        {[...els].reverse().map((el) => {
          const isSel = el.id === selectedId;
          const label = el.type === "text" ? el.text || "Text" : el.type === "rect" ? "Shape" : "Image";
          return (
            <div
              key={el.id}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs cursor-pointer ${
                isSel ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
              }`}
              onClick={() => el.id && onSelect(el.id)}
              data-testid={`layer-${el.id}`}
            >
              <span className="font-mono uppercase text-[10px] w-9 shrink-0 text-muted-foreground">{el.type}</span>
              <span className="truncate flex-1">{label}</span>
              <button
                type="button"
                className="p-0.5 hover:text-foreground text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  el.id && onReorder(el.id, 1);
                }}
                data-testid={`layer-up-${el.id}`}
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="p-0.5 hover:text-foreground text-muted-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  el.id && onReorder(el.id, -1);
                }}
                data-testid={`layer-down-${el.id}`}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        {els.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1">No elements yet.</p>}
      </div>
    </div>
  );
}
