---
name: pdfjs v6 operator-list shape
description: How to read rects/images/fill-colors from pdfjs-dist v6 getOperatorList() — the arg shapes changed and bite silently.
---

When extracting vector graphics from a PDF via `page.getOperatorList()` with pdfjs-dist v6 (legacy build, server-side), the operator arg shapes differ from older pdfjs and from most online examples. Wrong assumptions fail **silently** (no throw), producing empty rects/images.

- **`OPS.constructPath` args = `[paintOp, packedSegments, bbox]`** (3 args):
  - `args[0]` is the paint intent op itself (e.g. `OPS.fill`=22, `OPS.eoFill`=23, `OPS.fillStroke`=24…). There is **no separate `OPS.fill` operator** afterward — the intent is embedded here. Code that waits for a standalone fill op never fires.
  - `args[2]` is the path bounding box `[minX, minY, maxX, maxY]` in current user space. For a rectangle fill this bbox *is* the rectangle — use it directly instead of decoding `args[1]`.
  - **`bbox` is a typed array (Float32Array), NOT a plain Array.** `Array.isArray(bbox)` returns `false`. Check `bbox.length >= 4` and index into it; don't gate on `Array.isArray`. (`JSON.stringify` of it shows `{"0":..,"1":..}`, a tell-tale of a typed array.)
- **Fill colors come pre-normalized as CSS hex strings.** `OPS.setFillRGBColor` arg is `"#rrggbb"` (a string), not `[r,g,b]` numbers. Same for `setFillColor`/`setFillColorN`. Only `setFillGray`/`setFillCMYKColor` give numbers needing conversion.
- **`OPS.paintImageXObject` args = `[objId, w, h]`**; resolve bytes via `page.objs.get(objId)`. `OPS.paintJpegXObject` is `undefined` in v6 (gone). Image placement = unit square `[0,1]^2` transformed by the current CTM (track save/restore/transform).

**Why:** these shapes are not in the public typings and changed across major versions; an `Array.isArray` guard or `[r,g,b]` color assumption compiles fine and throws nothing, just yields zero results.
**How to apply:** when debugging "text extracts but rects/images are empty", dump `argsArray[i]` for `constructPath`/`paintImageXObject` with a replacer that converts `ArrayBuffer.isView` → `Array.from` before trusting any shape.
