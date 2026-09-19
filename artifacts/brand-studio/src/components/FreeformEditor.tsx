import type React from "react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Brand, FreeformElement } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import {
  defaultImageFit,
  freeformBaseStyle,
  freeformImageStyle,
  freeformRectStyle,
  freeformTextStyle,
  useFontsReady,
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
  Lock,
  Unlock,
  Ruler,
  Maximize2,
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

/** Keep the original aspect ratio while a CORNER handle is dragged: the
 * larger of the two relative changes wins, and the opposite corner stays put.
 * Edge handles resize one axis and are returned unchanged. */
function constrainBox(orig: Box, handle: Handle, box: Box): Box {
  if (handle.length !== 2 || orig.w <= 0 || orig.h <= 0) return box;
  const s = Math.max(box.w / orig.w, box.h / orig.h);
  const w = Math.max(MIN_SIZE, Math.round(orig.w * s));
  const h = Math.max(MIN_SIZE, Math.round(orig.h * s));
  return {
    x: handle.includes("w") ? orig.x + orig.w - w : orig.x,
    y: handle.includes("n") ? orig.y + orig.h - h : orig.y,
    w,
    h,
  };
}

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
  /** Reviewer feedback hooks: verdicts on a specific element. */
  onMarkWrong?: (el: FreeformElement) => void;
  onMarkCorrect?: (el: FreeformElement) => void;
  /** Extra controls rendered in the canvas toolbar, after Proportional and Guides. */
  toolbarExtra?: ReactNode;
}

interface DragMember {
  id: string;
  orig: Box;
  fontSize?: number;
}

interface DragState {
  mode: "move" | "resize";
  handle?: Handle;
  id: string;
  startX: number;
  startY: number;
  /** Bounding box of everything being dragged (one element or a group). */
  orig: Box;
  members: DragMember[];
}

function unionBox(boxes: Box[]): Box {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function FreeformEditor({ width, height, brand, initialElements, onChange, onMarkWrong, onMarkCorrect, toolbarExtra }: FreeformEditorProps) {
  useFontsReady();
  const [els, setEls] = useState<FreeformElement[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Extra members of a Shift-click group; selectedId stays the primary
  // (the inspector edits it), the group moves and resizes together.
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [showGuides, setShowGuides] = useState(true);
  // Corner-handle resizing keeps the aspect ratio while this is on; holding
  // Shift during the drag flips it for that drag.
  const [keepRatio, setKeepRatio] = useState(true);
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

  const selectedIds = selectedId ? [selectedId, ...groupIds.filter((g) => g !== selectedId)] : [];
  const selectedSet = new Set(selectedIds);
  const selectOnly = (id: string | null) => {
    setSelectedId(id);
    setGroupIds([]);
  };
  /** Shift-click: add to or remove from the group. */
  const toggleInSelection = (id: string) => {
    if (!selectedId) {
      setSelectedId(id);
      return;
    }
    if (id === selectedId) {
      // Dropping the primary promotes the next member, if any.
      const [next, ...rest] = groupIds;
      setSelectedId(next ?? null);
      setGroupIds(rest);
      return;
    }
    setGroupIds((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  };

  // Fit the (width x height) canvas into the available column width AND the
  // viewport height, so tall masters (e.g. imported posters) don't force the
  // user to scroll the artwork.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => {
      const avail = node.clientWidth;
      const maxH = Math.max(360, window.innerHeight * 0.78);
      if (avail > 0) setScale(Math.min(1, avail / width, maxH / height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [width, height]);

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
    setGroupIds([]);
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
    setGroupIds([]);
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
    // Shift-click builds a group instead of starting a drag.
    if (e.shiftKey && mode === "move") {
      toggleInSelection(el.id);
      return;
    }
    const inSelection = selectedSet.has(el.id);
    if (!inSelection) selectOnly(el.id);
    // Dragging any member of the group drags the whole group; locked
    // members stay selectable (so the panel can unlock them) but never move.
    const ids = inSelection && selectedIds.length > 1 ? selectedIds : [el.id];
    const members: DragMember[] = els
      .filter((m) => m.id && ids.includes(m.id) && !m.locked)
      .map((m) => ({ id: m.id!, orig: { x: m.x ?? 0, y: m.y ?? 0, w: m.w ?? 0, h: m.h ?? 0 }, ...(m.type === "text" ? { fontSize: m.fontSize } : {}) }));
    if (members.length === 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragStartElsRef.current = els;
    draggedRef.current = false;
    dragRef.current = {
      mode,
      handle,
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      orig: unionBox(members.map((m) => m.orig)),
      members,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    draggedRef.current = true;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const byId = new Map(d.members.map((m) => [m.id, m]));
    const group = d.members.length > 1;
    // Resize: the group's bounding box follows the handle, every member is
    // scaled inside it (text size follows the smaller axis scale).
    const proportional = keepRatio !== e.shiftKey;
    const fit = (orig: Box) => {
      const box = resizeBox(orig, d.handle!, dx, dy);
      return proportional ? constrainBox(orig, d.handle!, box) : box;
    };
    const nb = d.mode === "resize" ? fit(d.orig) : null;
    const sx = nb ? nb.w / Math.max(1, d.orig.w) : 1;
    const sy = nb ? nb.h / Math.max(1, d.orig.h) : 1;
    setEls((prev) =>
      prev.map((el) => {
        const m = el.id ? byId.get(el.id) : undefined;
        if (!m) return el;
        if (d.mode === "move") {
          return { ...el, x: Math.round(m.orig.x + dx), y: Math.round(m.orig.y + dy) };
        }
        if (!group) {
          const box = fit(m.orig);
          // Live copy scales with its box on a proportional corner drag, so
          // the type grows or shrinks with the frame instead of reflowing.
          if (el.type === "text" && m.fontSize && proportional && d.handle!.length === 2) {
            const s = box.w / Math.max(1, m.orig.w);
            return { ...el, ...box, fontSize: Math.max(6, Math.round(m.fontSize * s)) };
          }
          return { ...el, ...box };
        }
        const scaled = {
          x: Math.round(nb!.x + (m.orig.x - d.orig.x) * sx),
          y: Math.round(nb!.y + (m.orig.y - d.orig.y) * sy),
          w: Math.max(1, Math.round(m.orig.w * sx)),
          h: Math.max(1, Math.round(m.orig.h * sy)),
        };
        if (el.type === "text" && m.fontSize) {
          return { ...el, ...scaled, fontSize: Math.max(6, Math.round(m.fontSize * Math.min(sx, sy))) };
        }
        return { ...el, ...scaled };
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
    if (e.key === "Escape") {
      selectOnly(null);
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
      prev.map((el) => (el.id && selectedSet.has(el.id) && !el.locked ? { ...el, x: (el.x ?? 0) + m[0], y: (el.y ?? 0) + m[1] } : el)),
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
    selectOnly(el.id!);
  };

  const removeSelected = () => {
    if (selectedIds.length === 0) return;
    // Locked elements can't be deleted (incl. via the Del key) — unlock first.
    const doomed = new Set(els.filter((e) => e.id && selectedSet.has(e.id) && !e.locked).map((e) => e.id!));
    if (doomed.size === 0) return;
    mutate((prev) => prev.filter((e) => !e.id || !doomed.has(e.id)));
    selectOnly(null);
  };

  // Move an element one step in z-order (array order). dir +1 = forward (up).
  const toggleLock = (id: string) => {
    mutate((prev) => prev.map((e) => (e.id === id ? ({ ...e, locked: e.locked ? undefined : true } as FreeformElement) : e)));
  };

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
          <div className="w-px h-6 bg-border mx-1" aria-hidden />
          <Button
            type="button"
            size="sm"
            variant={keepRatio ? "secondary" : "outline"}
            onClick={() => setKeepRatio((v) => !v)}
            title="Keep proportions when dragging a corner handle (hold Shift while dragging to do the opposite)"
            data-testid="button-toggle-ratio"
          >
            <Maximize2 className="w-4 h-4 mr-1.5" /> Proportional
          </Button>
          <Button
            type="button"
            size="sm"
            variant={showGuides ? "secondary" : "outline"}
            onClick={() => setShowGuides((v) => !v)}
            title="Brand grid guides: page margin, tile grid, logo tile zone and centre lines"
            data-testid="button-toggle-guides"
          >
            <Ruler className="w-4 h-4 mr-1.5" /> Guides
          </Button>
          {toolbarExtra}
          <span className="text-xs text-muted-foreground font-mono ml-auto">
            {width}×{height}px · {Math.round(scale * 100)}%
          </span>
        </div>

        <div ref={containerRef} className="bg-muted/30 rounded-lg p-3 overflow-auto">
          <div style={{ width: width * scale, height: height * scale, position: "relative", margin: "0 auto" }}>
            <div
              onPointerDown={() => selectOnly(null)}
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
                const isSel = !!el.id && selectedSet.has(el.id);
                const single = isSel && selectedIds.length === 1;
                // Match the renderer: copy layers always paint above imagery.
                const base = freeformBaseStyle(el, el.type === "text" ? i + 1001 : i + 1);
                return (
                  <div
                    key={el.id ?? i}
                    onPointerDown={(e) => beginDrag(e, el, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    style={{
                      ...base,
                      cursor: el.locked ? "default" : "move",
                      boxShadow: isSel
                        ? `0 0 0 ${outline}px ${el.locked ? "#94a3b8" : "#6366f1"}`
                        : undefined,
                    }}
                    data-testid={`element-${el.id}`}
                  >
                    {el.type === "rect" && (
                      <div style={{ width: "100%", height: "100%", ...freeformRectStyle(el) }} />
                    )}
                    {/* The photo's hero area (focusBox) still steers adapted-size
                        crops, but it is data on the element, not something the
                        designer can drag — so it is no longer drawn over the art. */}
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

                    {el.locked && (
                      <div
                        style={{
                          position: "absolute",
                          top: 2 / scale,
                          right: 2 / scale,
                          width: 16 / scale,
                          height: 16 / scale,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 3 / scale,
                          background: isSel ? "#94a3b8" : "rgba(148,163,184,0.85)",
                          color: "#fff",
                          zIndex: 9999,
                          pointerEvents: "none",
                        }}
                        title="Locked"
                        data-testid={`lock-badge-${el.id}`}
                      >
                        <Lock style={{ width: 10 / scale, height: 10 / scale }} />
                      </div>
                    )}

                    {single &&
                      !el.locked &&
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
              {selectedIds.length > 1 && (() => {
                const members = els.filter((m) => m.id && selectedSet.has(m.id));
                const movable = members.filter((m) => !m.locked);
                if (movable.length === 0) return null;
                const bb = unionBox(movable.map((m) => ({ x: m.x ?? 0, y: m.y ?? 0, w: m.w ?? 0, h: m.h ?? 0 })));
                const primary = els.find((m) => m.id === selectedId) ?? movable[0];
                return (
                  <div
                    style={{ position: "absolute", left: bb.x, top: bb.y, width: bb.w, height: bb.h, outline: `${outline}px dashed #6366f1`, outlineOffset: 2 / scale, pointerEvents: "none", zIndex: 9998 }}
                    data-testid="group-frame"
                  >
                    {HANDLES.map((h) => (
                      <div
                        key={h}
                        onPointerDown={(e) => beginDrag(e, primary, "resize", h)}
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
                          pointerEvents: "auto",
                          zIndex: 9999,
                        }}
                        data-testid={`group-handle-${h}`}
                      />
                    ))}
                  </div>
                );
              })()}
              {showGuides && <BrandGuides width={width} height={height} scale={scale} />}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Click to select · Shift-click to add to a group · drag to move (a group moves together) · drag handles to resize (a group scales together; corners keep proportions while Proportional is on, Shift flips it) · arrow keys nudge (Shift = 10px) · Delete removes · Esc clears.
          {selectedIds.length > 1 ? ` ${selectedIds.length} selected.` : ""}
          {showGuides ? " Guides: page margin (dashed), tile grid, logo tile zone, centre lines." : ""}
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
            onMarkWrong={onMarkWrong}
            onMarkCorrect={onMarkCorrect}
          />
        <Layers
          els={els}
          selectedIds={selectedIds}
          onSelect={(id, additive) => (additive ? toggleInSelection(id) : selectOnly(id))}
          onReorder={reorder}
          onToggleLock={toggleLock}
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
  onMarkWrong,
  onMarkCorrect,
}: {
  selected: FreeformElement | null;
  brandFont: string;
  isUploading: boolean;
  onPatch: (patch: Partial<FreeformElement>) => void;
  onReplaceImage: (file: File) => void;
  onDelete: () => void;
  onMarkWrong?: (el: FreeformElement) => void;
  onMarkCorrect?: (el: FreeformElement) => void;
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
        <div className="flex items-center gap-1">
          {onMarkCorrect && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 text-[#5b9c33] hover:text-[#5b9c33]"
              onClick={() => onMarkCorrect(el)}
              title="This element is correct — teach the studio it got this right"
              data-testid="button-mark-element-correct"
            >
              👍 Correct
            </Button>
          )}
          {onMarkWrong && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
              onClick={() => onMarkWrong(el)}
              title="This element is wrong — tell the studio what to fix"
              data-testid="button-mark-element-wrong"
            >
              👎 Wrong
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={el.locked ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs gap-1"
            onClick={() => onPatch({ locked: el.locked ? undefined : true })}
            title={
              el.locked
                ? "Unlock: allow moving/editing and brief copy substitution"
                : "Lock: pin this element — it can't be moved and brief copy never replaces its content"
            }
            data-testid="button-lock-element"
          >
            {el.locked ? "🔒 Locked" : "🔓 Lock"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-destructive h-7 px-2" onClick={onDelete} disabled={el.locked} data-testid="button-delete-element">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {el.locked && (
        <p className="text-xs text-muted-foreground rounded bg-muted/60 px-2 py-1.5">
          Pinned brand element — unlock to edit. Generated copy never replaces
          locked content.
        </p>
      )}

      {/* Liquid layout (InDesign's object-based model): pins to the zone
          edges and springs on width/height. Nothing set = inferred from
          where the element sits in the master. */}
      {(() => {
        const c = (el.constraints ?? {}) as { pinTop?: boolean; pinBottom?: boolean; pinLeft?: boolean; pinRight?: boolean; flexW?: boolean; flexH?: boolean };
        const has = Object.values(c).some(Boolean);
        const toggle = (k: keyof typeof c) => {
          const next = { ...c, [k]: c[k] ? undefined : true };
          const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v === true));
          onPatch({ constraints: Object.keys(clean).length ? clean : undefined } as Partial<FreeformElement>);
        };
        const pinBtn = (k: keyof typeof c, label: string, title: string) => (
          <button
            type="button"
            key={k}
            onClick={() => toggle(k)}
            title={title}
            aria-pressed={!!c[k]}
            data-testid={`liquid-${k}`}
            className={`h-6 min-w-6 px-1.5 rounded border text-[11px] font-mono ${c[k] ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
          >
            {label}
          </button>
        );
        return (
          <div className="rounded border border-border/60 px-2 py-1.5 space-y-1" data-testid="liquid-layout">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" title="How this element behaves when the artwork is built at another size">Liquid layout</span>
              <span className="text-[10px] text-muted-foreground">{has ? "set by you" : "auto from master"}</span>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-muted-foreground mr-0.5">Pin</span>
              {pinBtn("pinTop", "T", "Pin to the top of its zone")}
              {pinBtn("pinBottom", "B", "Pin to the bottom of its zone")}
              {pinBtn("pinLeft", "L", "Pin to the left edge of its zone")}
              {pinBtn("pinRight", "R", "Pin to the right edge of its zone")}
              <span className="text-[10px] text-muted-foreground ml-1 mr-0.5">Flex</span>
              {pinBtn("flexW", "W", "Width stretches with the zone (pin left + right for full width)")}
              {pinBtn("flexH", "H", "Height stretches with the zone")}
              {has && (
                <button type="button" onClick={() => onPatch({ constraints: undefined } as Partial<FreeformElement>)} className="ml-auto text-[10px] text-muted-foreground hover:underline" data-testid="liquid-auto">Auto</button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Native disabled propagation: every field goes read-only while locked. */}
      <fieldset disabled={!!el.locked} className="space-y-4 border-0 m-0 p-0 min-w-0 disabled:opacity-60">

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
          {el.role !== "logo" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Hero area (% of image)</Label>
              <div className="grid grid-cols-4 gap-1">
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <Input
                    key={k}
                    type="number"
                    min={0}
                    max={100}
                    className="h-8 text-xs px-1"
                    placeholder={k.toUpperCase()}
                    value={el.focusBox ? Math.round(((el.focusBox as Record<string, number>)[k] ?? 0) * 100) : ""}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(100, Number(e.target.value))) / 100;
                      const cur = el.focusBox ?? { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
                      onPatch({ focusBox: { ...cur, [k]: v } });
                    }}
                    data-testid={`input-hero-${k}`}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 text-xs"
                  onClick={() => onPatch({ focusBox: el.focusBox ? undefined : { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } })}
                  data-testid="button-hero-toggle"
                >
                  {el.focusBox ? "Clear hero area" : "Set hero area"}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                The subject every adapted size crops around. Detected at import; adjust here.
              </p>
            </div>
          )}
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

      </fieldset>
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

/** Brand grid drawn over the page: margin, tile grid, logo tile zone,
 * centre lines. Same numbers as the guidelines and lib/logoRules.ts —
 * tile = shortest axis ÷ 6 (full height on strips), margin = tile ÷ 3. */
function BrandGuides({ width, height, scale }: { width: number; height: number; scale: number }) {
  const short = Math.min(width, height);
  const isStrip = height <= 120;
  const tile = isStrip ? height : Math.max(24, Math.round(short / 6));
  const margin = isStrip ? Math.round((height - Math.round(height * 0.64)) / 2) : Math.max(8, Math.round(tile / 3));
  const hair = 1 / scale;
  const grid: React.ReactNode[] = [];
  if (!isStrip && tile >= 12) {
    for (let x = tile; x < width; x += tile) grid.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} stroke="#0ea5e9" strokeOpacity={0.18} strokeWidth={hair} />);
    for (let y = tile; y < height; y += tile) grid.push(<line key={`h${y}`} x1={0} y1={y} x2={width} y2={y} stroke="#0ea5e9" strokeOpacity={0.18} strokeWidth={hair} />);
  }
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 10000 }}
      data-testid="brand-guides"
    >
      {grid}
      <rect x={margin} y={margin} width={Math.max(0, width - margin * 2)} height={Math.max(0, height - margin * 2)} fill="none" stroke="#e11d48" strokeOpacity={0.7} strokeWidth={hair} strokeDasharray={`${6 / scale} ${4 / scale}`} />
      <line x1={width / 2} y1={0} x2={width / 2} y2={height} stroke="#0ea5e9" strokeOpacity={0.45} strokeWidth={hair} strokeDasharray={`${3 / scale} ${3 / scale}`} />
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#0ea5e9" strokeOpacity={0.45} strokeWidth={hair} strokeDasharray={`${3 / scale} ${3 / scale}`} />
      <rect x={width - tile} y={isStrip ? 0 : height - tile} width={tile} height={tile} fill="#f59e0b" fillOpacity={0.08} stroke="#f59e0b" strokeOpacity={0.8} strokeWidth={hair} strokeDasharray={`${4 / scale} ${3 / scale}`} />
      <text x={width - tile + 3 / scale} y={(isStrip ? 0 : height - tile) + 11 / scale} fontSize={10 / scale} fill="#b45309" fontFamily="ui-monospace, monospace">logo tile</text>
      <text x={margin + 3 / scale} y={margin + 11 / scale} fontSize={10 / scale} fill="#be123c" fontFamily="ui-monospace, monospace">margin {margin}px · tile {tile}px</text>
    </svg>
  );
}

function Layers({
  els,
  selectedIds,
  onSelect,
  onReorder,
  onToggleLock,
}: {
  els: FreeformElement[];
  selectedIds: string[];
  onSelect: (id: string, additive: boolean) => void;
  onReorder: (id: string, dir: 1 | -1) => void;
  onToggleLock: (id: string) => void;
}) {
  const selectedRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Keep the selected row visible by scrolling the LIST only. scrollIntoView
  // would also scroll the page, yanking the designer away from the canvas.
  useEffect(() => {
    const row = selectedRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const top = row.offsetTop - list.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [selectedIds[0]]);
  const selectedId = selectedIds[0] ?? null;
  const selectedSet = new Set(selectedIds);
  const lockedCount = els.filter((e) => e.locked).length;
  return (
    <div className="rounded-lg border border-border/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layers</span>
        <span className="text-[10px] text-muted-foreground">{lockedCount} locked · {els.length - lockedCount} unlocked</span>
      </div>
      <div ref={listRef} className="space-y-1 max-h-64 overflow-auto relative">
        {[...els].reverse().map((el) => {
          const isSel = !!el.id && selectedSet.has(el.id);
          const { slot, layerName } = el as { slot?: string; layerName?: string };
          const semanticLayer = layerName
            ?.replace(/^art\s*[:_/-]\s*/i, "")
            .replace(/[_-]+/g, " ")
            .trim();
          const label = semanticLayer || slot || (el.type === "text" ? el.text || "Text" : el.type === "rect" ? "Shape" : "Image");
          return (
            <div
              key={el.id}
              ref={el.id === selectedId ? selectedRef : undefined}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs cursor-pointer border-l-2 ${
                isSel ? "bg-primary/15 text-primary border-primary font-medium" : "border-transparent hover:bg-muted/50"
              } ${el.locked && !isSel ? "text-muted-foreground" : ""}`}
              onClick={(e) => el.id && onSelect(el.id, e.shiftKey)}
              data-testid={`layer-${el.id}`}
              aria-current={isSel ? "true" : undefined}
            >
              <button
                type="button"
                className={`p-0.5 shrink-0 ${el.locked ? "text-amber-600" : "text-muted-foreground/60 hover:text-foreground"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  el.id && onToggleLock(el.id);
                }}
                title={el.locked ? "Locked — click to unlock" : "Unlocked — click to lock"}
                aria-label={el.locked ? "Unlock layer" : "Lock layer"}
                data-testid={`layer-lock-${el.id}`}
              >
                {el.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
              <span className="font-mono uppercase text-[10px] w-9 shrink-0 text-muted-foreground">{el.type}</span>
              <span className="truncate flex-1">{label}</span>
              {slot && slot.toLowerCase() !== label.toLowerCase() && <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground shrink-0">{slot}</span>}
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
