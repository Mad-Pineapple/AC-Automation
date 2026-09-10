# Style spec — AC brand digital layouts (field + koru frame)

Draft for designer correction. Numbers were read off the "AC Brand Digital layouts" InDesign
package (1080×1920, 1920×1080, two 970×250 variants) — see `docs/brand-layout-style.md` for the
full measurements. Change any cell that is wrong; add rows for anything missing. Status: **draft,
2026-09-08**. This style is not yet a recipe in the engine; the rebuild engine still uses the Get
Ready model for these masters, which is why the reviewer models marked them wrong.

## Recognise it by

- Flat light-aqua field `#81dbe5` across the whole canvas. No panel, no gradient, no scrim.
- Photo inside the koru / circle frame, oversized so it bleeds off at least one edge.
- Headline in National 2 Condensed Bold, all caps, navy `#0c253b`, on the field, never over the photo.
- White search pill with a magnifier disc; kotahitanga band along the bottom edge; white pōhutukawa tile flush bottom-right.

## Axis per shape

| Shape class | Axis | Notes |
|---|---|---|
| Portrait 9:16 | reading order top to bottom: headline, photo frame, body, pill, band + tile | |
| Landscape 16:9 | photo frame owns the left half; right column stacks headline, body, pill, band | |
| Wide strip 970×250 | photo frame left third; ONE message element beside it (headline OR body + pill), band above the tile | variants A and B are alternatives, not a stack |
| Tower, square | **not shipped — please say what you would do** | |

## Zone shares

| Shape | Photo frame | Copy column | Band | Tolerance |
|---|---|---|---|---|
| Portrait | 62% of height, square 110% of width, offset −11% | headline top 4–14%; body 72–79%; pill 82–87% | bottom 10%, stops before the tile | ±5% |
| Landscape | 58% of width, square 102% of height, bleeds left | right column from 53% | 44–91% of width, under the copy, 18% tall | ±5% |
| Strip | 29% of width, bleeds top/bottom/left | 33–83% of width | 14% of width above the tile only | ±5% |

## Parts

| Part | Size | Position | Floor / never below | Dropped when |
|---|---|---|---|---|
| Headline | 27% of short (portrait), 22% (landscape), 57% (strip, one word); tracking +5 | left-aligned on the field | 12px | strip variant B |
| Body copy | 6.7% of short on large canvases, 17.6% on the strip; centred; tracking −25; max 2 lines | under the photo (portrait) / under the headline (landscape) | 12px | strip variant A |
| Search pill | fixed unit per family: 556×91 on 1080/1920 canvases, 334×54 on the strip; label ~35px inset; magnifier disc ~12px from the right | centred under the body (portrait); in the column (landscape); right of the copy (strip) | 24px | never |
| Logo tile | square, 17% of short (180px on 1080-short, 125px on the 250 strip), flush bottom-right, zero margin | bottom-right | — | never (no social square shipped) |
| Band | kotahitanga strip along the bottom edge, stops short of the tile | bottom (portrait), under the copy column (landscape), above the tile (strip) | — | never |
| Photo | one image, koru frame, bleeds off ≥ 1 edge; stem enters from the lower-left, never the lower-right | see zone shares | — | never |

## Never

- Copy over the photo.
- Band running under the tile.
- Pill scaled with the canvas instead of kept at the family unit.
- Frame stem entering from the lower-right.
- Panel, gradient or scrim added to the field.

## Tolerances

- Pill ±4px. Zone shares ±5%. Headline size ±3% of short.

## Reference pieces

- "AC Brand Digital layouts" package, pages 1, 3, 5 and 6 — marked right by the designers on 2026-09-06.
- Missing: a signed-off tower, square and strip for this style.
