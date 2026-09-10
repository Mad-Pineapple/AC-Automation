# AC brand digital layout style — measured from the designer's master

Source: **"AC Brand Digital layouts" InDesign package** (four spreads: 1080×1920, 1920×1080, and two
970×250 variants), imported 2026-09-03 and verified against the package's own PDF. Every number
below is read off the IDML geometry (canvas pixels), not estimated. This is the house style for
council digital creative that is *not* a specific campaign look (Get Ready has its own, see
`complex-size-layouts.md`).

Use it three ways: as the reference the AI sense-check judges against (`scripts/src/ai-layout-trial.ts`
with `STYLE=brand`), as the rule the brand-review skill quotes, and as the inputs for a "field"
recipe in `lib/recipes.ts` when that composition is implemented.

## 1. The composition: a flat field, not a photo-and-panel split

Unlike the Get Ready model (photo zone + solid Ocean panel), these layouts sit everything on a
**single light field** and give the photo a **shaped frame**:

| Element | Treatment |
|---|---|
| Field | Full-canvas flat fill `#81dbe5` (light aqua). No gradient, no scrim. |
| Photo | One image in a **koru/circle frame** (a circle with a tail into the bottom-left), oversize and offset so it bleeds off one edge. |
| Headline | National 2 **Condensed Bold**, ALL CAPS, left-aligned, dark navy `#0c253b`, **on the field** — never over the photo. |
| Body copy | National 2 Bold, centred, navy, **tracking −25**, max 2 lines. |
| Search pill | White capsule, "Search" (Regular) + phrase (Bold), magnifier disc at the right end. |
| Pattern band | Kotahitanga pattern strip along the bottom edge, stopping short of the logo tile. |
| Logo tile | White pōhutukawa tile flush in the **bottom-right corner**, square. |

## 2. Geometry by shape (fractions of the canvas; short = short axis)

### Portrait 9:16 (1080×1920)

| Element | x | y | w | h | Notes |
|---|---|---|---|---|---|
| Headline | 5% | 4% | 92% | 10% | 293px = **27% of short**, tracking +5 |
| Photo frame | −11% | 16% | 110% | 62% | square 1183px, bleeds left and right |
| Body copy | 9% | 72% | 81% | 7% | 72px = **6.7% of short**, 2 lines |
| Search pill | 24% | 82% | 51% | 4.7% | 556×91, label 61px (5.6% short), magnifier 67px |
| Pattern band | 0% | 90% | 84% | 10% | full bleed bottom-left, stops before tile |
| Logo tile | 83% | 91% | 17% | 9.4% | 180×180, flush corner |

Reading order top to bottom: headline → photo → body → pill → band/tile.

### Landscape 16:9 (1920×1080)

| Element | x | y | w | h | Notes |
|---|---|---|---|---|---|
| Photo frame | −4% | 5% | 58% | 102% | square 1106px, bleeds left; owns the left half |
| Headline | 53% | 15% | 42% | 15% | 239px = **22% of short** |
| Body copy | 56% | 40% | 38% | 12% | 72px (6.7% short) |
| Search pill | 60% | 60% | 29% | 8.4% | 556×91 — **same pixel pill as portrait** |
| Pattern band | 44% | 83% | 47% | 18% | runs under the copy column to the tile |
| Logo tile | 91% | 83% | 9.4% | 17% | 180×180, flush corner |

The right column is a stack: headline, body, pill, band. The photo never carries type.

### Wide strip 970×250 (two variants)

| Element | x | y | w | h | Notes |
|---|---|---|---|---|---|
| Photo frame | −1% | 0% | 29% | 114% | square 285px, bleeds top/bottom/left |
| Headline (variant A) | 33% | 31% | 50% | 38% | 143px = **57% of short** — one word, huge |
| Body copy (variant B) | 33% | 14% | 45% | 32% | 44px (17.6% short), centred, 2 lines |
| Search pill (variant B) | 39% | 64% | 34% | 22% | 334×54, label 37px, magnifier 40px |
| Pattern band | 87% | −2% | 14% | 54% | short piece above the tile only |
| Logo tile | 87% | 50% | 13% | 50% | 125×125, flush bottom-right |

Variant A (headline only) and variant B (body + pill) are alternatives, not a stack: a strip carries
one message element.

## 3. Constants that hold across shapes

- **Pill is a fixed unit per family**: 556×91 on the 1080/1920 formats, 334×54 on the strip.
  Label sits left with ~35px inset; magnifier disc inset ~12px from the right end.
- **Logo tile is flush to the bottom-right corner** with zero margin, sized 17% of the short axis
  (180px on 1080-short canvases, 125px on the 250 strip = 50%).
- **Headline scale** is generous: 27% of short (portrait), 22% (landscape), 57% (strip).
- **Body copy** 6.7% of short on large canvases, 17.6% on the strip; always centred; tracking −25.
- **Photo bleeds** off at least one edge; the shaped frame's curve is the brand's koru device.

## 4. What the importer must preserve (learned the hard way)

- Keep **National 2 Condensed** as its own family (collapsing it to National 2 makes the headline
  overflow and clip).
- Shaped photo frames are reproduced from the document PDF (text objects stripped first), not drawn
  as squares.
- Tracking becomes letter-spacing; a −25 body copy is ~2.5% narrower than untracked and that is the
  difference between two lines and three.
- A run that starts with a space keeps it ("Search" + " layouts").

## 5. Checklist for a sense-check against this style

1. Field is flat `#81dbe5`; no panel, no scrim, no gradient.
2. Photo is in a shaped frame and bleeds an edge; nothing is drawn over it.
3. Headline is Condensed Bold caps, left-aligned, on the field, at the scale above ± 10%.
4. Body is centred National 2 Bold, ≤ 2 lines, not colliding with the pill.
5. Pill is the fixed unit, label on one line, magnifier inside the capsule.
6. Pattern band along the bottom (or above the tile on the strip), stopping short of the tile.
7. Logo tile flush bottom-right, undistorted.
8. Placeholder copy ("HEADLINE", "Body copy here.") is expected on the master — not a defect.

## 6. The pōhutukawa mark, the anther and patterns (from the June 2025 guidelines)

These apply to every layout in this style and are enforced by `lib/layoutCheck.ts` where a rule
can be measured.

**Pōhutukawa tile (the logo)**
- Colour mark inside a **white square tile**, mark centred with 1/8 clearspace top and bottom.
- The tile is the grid unit: short axis ÷ 4, 6 or 8 (print) or ÷ 1, 2 or 4 (digital). The master
  uses short ÷ 6 on 1080-short canvases (180px) and short ÷ 2 on the 970×250 strip (125px).
- Placement **bottom-right**, flush to the corner in this style. Never redrawn, recoloured,
  distorted, cropped or wrapped in another box.
- Colour version only on white or ≤20% colour/image density; the light `#81dbe5` field qualifies.
- **1080×1080 social tiles carry no logo**; Facebook covers carry no logo and no patterns.

**Anther (the circle-on-a-stem device — the koru photo frame is this device)**
- A large circle with a straight stem entering from the **left, lower-left at 45°, or bottom
  centre — never from the lower-right**.
- As a housing device: image inside with copy outside (this style), or copy inside with image
  outside. Backgrounds behind copy must pass contrast.
- As big as the margins allow; **never covered by the pōhutukawa tile**.
- A **cropped anther is subject to design review** — the 970×250 strip, where the circle bleeds
  three edges, is such a case and should be signed off, not auto-shipped.

**Kotahitanga patterns**
- Background texture: **never above 30% opacity** (three-row 30/20/10, two-row 20/10, single row
  20–30%).
- Stamp treatment: 2–3 motifs at full colour, snapped to the grid, **next to** the tile — the
  bottom band in this style is a stamp row, so it **stops at the tile's edge and never runs under
  it** (the master currently overlaps by 5px; trim it).
- Patterns may use any brand colour; social tiles and carousels carry no anther inside frames.
