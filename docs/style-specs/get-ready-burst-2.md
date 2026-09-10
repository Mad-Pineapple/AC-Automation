# Style spec — AEM Get Ready, Burst 2 (26-PRO-0461)

Audit of every delivered piece in **Large campaign example**, measured on 2026-09-10. Machine form:
`artifacts/api-server/src/lib/styleSpecs/getReadyBurst2.ts` — the adapter and Claude's check read that;
this file is the designer's copy of the same numbers with the audit notes. Correct any cell that is wrong.

## What was audited

| Source | Pieces | How measured |
|---|---|---|
| InDesign masters, JCDecaux 384×592 and 960×256, standard + SLIM | 12 (Storms, Quakes, Tsunami × 2 sizes × 2 packages) | IDML text frames and rects: exact px, font, size, colour |
| Google Web Designer working files, 300×600 and 970×250 | 6 (3 hazards × 2 sizes) | Layer geometry from the HTML, resting frame |
| DV360 HTML5 finals, Phases 1–3 (V1–V10) | 20 (10 versions × 2 sizes) | Layer geometry from the HTML |
| DV360 statics, Phases 1–3 | 20 | Visual contact sheets + pixel sampling |
| Collateral production sheet V3 | 50 rows | Every size the campaign ships in |

All 32 importable packages imported cleanly into the studio; nothing in the folder was skipped.

## Recognise it by

- Photograph of the hazard with the hazard word set in the **DS-Digital clock face**, white, colons between letter
  pairs: `ST:OR:MS`, `QU:AK:ES`, `TSU:NA:MI`. In Phase 2 the word becomes a countdown, `47:34:23`.
- A **solid campaign-blue panel** carrying the yellow message, the CTA and the AEM + Council lockup.
- The **kotahitanga tohu band** on the seam (tall) or along the top of the panel (wide).
- A navy gradient scrim under the copy; the Storms pieces carry a cut-out flooded car on the photo.

## Reading order (most important first)

1. Hazard word / countdown — the headline. It is the only thing that must survive every size.
2. Kicker or sub-line — "IT'S TIME TO TALK" (Phase 1), "TIME'S RUNNING OUT TO MAKE A PLAN" (Phase 2) above; "CAN STRIKE SUDDENLY" (Phase 3, OOH) below.
3. Message — "Make a plan today." / "Make a plan this daylight saving weekend." in yellow.
4. CTA — display: yellow **LEARN MORE** button (clickable); OOH: white **Auckland emergency** search pill.
5. Lockup — AEM + Council, last in the panel stack. Strips would carry the pōhutukawa tile instead (none shipped).

## Zones

| Shape class | Axis | Photo share | Band | Measured on |
|---|---|---|---|---|
| Portrait (384×592, 300×600, 384×576, 432×768, 704×1408, 384×768, 1080×1920, 2160×3840) | stacked | **56.9%** of height (OOH), 56.8% (display) | 5.9% of height on the seam (OOH); inside the panel graphic on display | IDML rect + GWD panel layer |
| Wide (960×256, 970×250, 1440×480, 1280×448, 1184×400, 768×256, 1824×432, 2688×672) | side | **50%** of width (OOH); **69%** (DV360 970×250) | 16.9% of height along the top of the panel (OOH), 14.8% (display) | IDML rect + GWD panel layer |
| Landscape (1920×1080, 1200×600) | side | 55% (interpolated — no shipped example) | 15% | — |
| Square (300×250, 1080×1080) | stacked | 60% (interpolated — no shipped example) | 5% | — |
| Strip (728×90 etc.) | row | 30% | none | brand rule — none shipped |

Tolerance ±3% on the measured classes, ±5% on interpolated ones.

## Parts — measured

| Part | OOH 384×592 | OOH 960×256 | Display 300×600 | Display 970×250 |
|---|---|---|---|---|
| Headline (DS-Digital) | 95px = 25% of short; box 88% of zone width; block centre at 45% of the photo zone | 110px = 43% of short; box 41% of canvas width; block centre at 36% of height | glyph run 57px tall = 19% of short; run 84–93% of width; top at 19–26% of height | glyph run 96px = 38% of height; run 49% of width; top at 7% (working files and finals agree) |
| Kicker / sub-line (National 2 Bold, white) | 28px = 29% of headline; centred, 83% of width, directly under | 32px = 29% of headline; under the headline in the photo column | 30px image directly under the headline | 40px image at 49% of height |
| Message (National 2 Bold, `#ffeb3d`) | 26px = 6.8% of short; centred at 71.6% of height (top third of the panel) | 29px = 11% of short; at x 61%, y 38% (top of the panel column) | baked in the panel graphic, top of panel | baked in the panel graphic |
| CTA | white search pill 239×29px: 7.5% of short tall, 62% of width; label 19px `#111827`; icon 21px at the right; at 77% of height | white pill 267×32px: 12.5% of short tall, 56% of the panel; label 22px; at 53% of height | yellow LEARN MORE 181×43px (fixed asset), 60% of width, at 77% of height | yellow LEARN MORE 181×43px (same fixed asset), 60% of the panel, at 48% of height |
| Lockup (AEM + Council) | 192×47px: 12.2% of short tall, 50% of width, at 89% of height | 195×47px: 18.5% of short tall, 40% of the panel, at 73.5% of height | baked in the panel graphic, bottom | baked in the panel graphic, bottom |
| Band (tohu strip) | 35px on the seam = 5.9% of height, full width | 43px along the top of the panel = 16.9% of height, panel width | inside the panel graphic | inside the panel graphic |
| Scrim | navy `#0c253b` gradient, top 50% of the photo zone | top 77% of the photo column | 196px image at 31% of height | — |
| Photo | cover, panned to the subject | cover | 121–175% oversize, panned | 106% oversize |
| Cut-out car (Storms) | on the photo, bottom of the zone | on the photo, bottom | 240×142 = 80% of width, at 35% of height | 313×82 = 32% of width, bottom |

### What the numbers say, in designer terms

- **The headline is sized to the short side, not the canvas.** A quarter of the short side on portrait OOH, more on wide where there is no competition for height. Display goes smaller (19%) because the yellow button and the panel graphic take the room.
- **The display CTA is a placed asset, not a scaled one.** 181×43 on both 300×600 and 970×250. That is why a pill that has been "scaled with the canvas" reads wrong immediately.
- **The OOH pill is proportional**: 7.5% of the short side on portrait, 12.5% on wide, always under the message, always centred in the panel column.
- **Everything in the panel is a centred stack**: message, CTA, lockup, in that order, with the band on the panel's outer edge (seam or top).
- **The copy block sits in the upper part of the photo zone**, block centre 36–45%, with the subject of the photo (wave, crack, car) below it. The scrim exists so this works over sky.

## Colours and type

| Token | Value | Source |
|---|---|---|
| Panel, OOH | `#005b9f` | InDesign rect |
| Panel, display | `#0060ac` | GWD panel graphic |
| Scrim | `#0c253b` gradient | InDesign |
| Message yellow | `#ffeb3d` | InDesign |
| Display CTA yellow | `#fdf10e` | statics |
| Pill label ink | `#111827` | InDesign |
| Headline | DS-Digital, white | InDesign / glyph PNGs |
| Everything else | National 2 Bold, white in the photo zone, yellow message, ink on the pill | InDesign |

## Shipped copy — the only copy allowed

| Phase | Kicker / sub-line | Headline | Message | CTA |
|---|---|---|---|---|
| 1 — pre daylight-saving weekend (V1–V3) | IT'S TIME TO TALK (above) | ST:OR:MS / QU:AK:ES / TSU:NA:MI | Make a plan this daylight saving weekend. | LEARN MORE |
| 2 — the weekend, countdown (V4 48H, V5 36H, V6 24H, V7 12H) | TIME'S RUNNING OUT TO MAKE A PLAN (above) | HH:MM:SS in the clock face | Make a plan this daylight saving weekend. | LEARN MORE |
| 3 — after (V8–V10) and all OOH | CAN STRIKE SUDDENLY (below) | ST:OR:MS / QU:AK:ES / TSU:NA:MI | Make a plan today. | LEARN MORE (display) / Auckland emergency search pill (OOH) |

## Never

- Re-set or respell the clock-face headline. The colons are the device.
- Copy over the photo without the scrim.
- Scale the display pill with the canvas; it is a fixed 181×43 asset.
- Band under the lockup or the logo tile.
- Panel graphic cropped, or floating inside a darker frame.
- Car cut-out behind the headline.
- Photo letterboxed on a colour field, or stretched.
- Any element that is not in the delivered layers: no new shapes, patterns or copy.

## Audit findings

1. **OOH and display agree on structure and differ on three numbers**: photo share on wide (50% OOH vs 69% on the 970×250 display), the CTA (proportional pill vs fixed button), and the band's size (5.9% vs inside the panel graphic). The schema carries both.
2. **The 970×250 working files and the finals agree on the glyph headline position (top at 7% of height).** An earlier import read 31% for the finals; that was the importer bug in finding 3, not the artwork.
3. **The DV360 final HTML5 zips used to import with the panel graphic at 94% of height.** Cause: Google Web Designer writes every animation twice (`@keyframes` and `@-webkit-keyframes`) and writes zero offsets without a unit (`translate3d(0, -223px, 0)`); the importer let the prefixed copy erase the resting transform and could not read the unitless zero. Fixed 10 Sep 2026 — the finals now import with the panel at 57% (300×600) and the panel column at 69% (970×250), matching the shipped statics. Working files and finals both build correctly.
4. **970×250 glyph runs were not recognised as a headline** by the importer because each glyph is 38% of the canvas height, above the 25% cap written for tall formats. Fixed in the same change as this spec: the cap is now 60% of the short side.
5. **No strip, square or landscape piece was shipped.** Those classes in the schema are interpolated from the brand rules and marked as such; mark one Right when it exists and the studio will use it as the reference.
6. The production sheet lists five wide OOH sizes (1440×480, 1184×400, 768×256, 1824×432, 2688×672) and four portrait ones (384×576, 2160×3840, 432×768, 704×1408, 384×768) as "resize of" the JCDecaux masters. All resolve to the two measured classes.

## Reference pieces

- InDesign: `26-PRO-0461 - AEM Get Ready burst 2 collateral_Digital Large Format Billboard - JC DECEAUX_384px W x 592px H` and `_960px W x 256px H`, standard and SLIM.
- Working files: `HTML5s/WORKING FILES/{STORMS,QUAKES,TSUNAMI}/{300x600px,970x250px}`.
- DV360 statics V8–V10 (Phase 3) at both sizes are the cleanest display references.
