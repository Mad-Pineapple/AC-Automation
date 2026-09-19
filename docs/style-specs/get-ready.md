# Style spec — AEM Get Ready (photo + panel)

Draft for designer correction. Numbers were measured off the delivered Burst 2 files
(384×592 and 960×256 digital OOH; 300×600 and 970×250 DV360) and the InDesign masters. Change
any cell that is wrong; add rows for anything missing. Status: **draft, 2026-09-08**.

## Recognise it by

- Photograph with the hazard word set in the DS-Digital clock face, white, over the photo.
- Solid blue panel (`#005b9f` OOH / Ocean navy on some display) carrying "Make a plan today.", the search pill and the AEM + Council lockup.
- Kotahitanga pattern band on the seam between photo and panel.

## Axis per shape

| Shape class | Axis | Notes |
|---|---|---|
| Tall (portrait, tower) | stack: photo on top, band, panel below | |
| Wide, landscape | columns: photo left, panel right, band along the panel's top | |
| Strip (≤120px tall or ≥5:1) | one row: photo WITH the hazard word on it, blue panel with the message above the pill, full-height logo tile | Designer ruling 2026-09-19: the hazard word never sits on the blue panel |
| Square (1080 social) | stack | no logo at all on the social square |

## Zone shares

| Shape | Photo | Band | Panel | Tolerance |
|---|---|---|---|---|
| Portrait | 57% of height | 5.4% | rest | ±5% |
| Tower | 50% | 3% | rest | ±5% |
| Wide | 50% of width (DV360 970×250 uses 65%) | 15.5% of height, top of panel | rest | ±5% |
| Landscape | 58% of width | 12% | rest | ±5% |
| Square | 62% of height | 4.5% | rest | ±5% |

## Parts

| Part | Size | Position | Floor / never below | Dropped when |
|---|---|---|---|---|
| Headline (hazard word) | fits 80–86% of the photo zone width on one line; cap height ≈ ⅓ of the short axis on OOH | centred, block centre at 45% of the photo zone (tall), 42% (wide) | 12px | never |
| Sub-line ("CAN STRIKE SUDDENLY") | 30% of the headline size | directly under the headline | 10px | below 10px |
| Message ("Make a plan today.") | 25–30% of the headline size, yellow `#ffeb3d` | top of the panel stack | 13px | panel too short |
| Search pill | 32px tall on a 256px canvas (12.5% of short); width ≤ 60% of the panel; 43px on DV360 display | centred in the panel (tall); vertically centred right column (wide) | 24px | never |
| Lockup (AEM + Council) | 12% of short (portrait), 18.5% (wide); width ≤ 50–60% of panel | bottom of the panel with a margin on tall panels; last in the stack otherwise | — | replaced by the logo tile on strips |
| Logo tile (alone) | square, short ÷ 6, flush bottom-right | bottom-right | — | never on 1080 squares |
| Band | tiles of the kotahitanga strip, motif never shrunk below ~30px | seam (tall) / panel top (wide) | — | strips |
| Photo | cover-cropped 6–20% oversize, panned to the subject, gradient scrim under the headline | photo zone | — | never letterboxed |
| Cut-out (car) | 78% of the photo zone width (tall), 36% (wide) | lower part of the photo zone | — | small canvases |

## Never

- Headline baked into pixels and cut by the crop.
- Copy floating over busy photo without a scrim.
- Pattern running under the logo tile.
- Pill wider than the panel or dominating a short panel.
- Logo on a 1080 social square.
- Photo letterboxed on a colour field, or stretched.

## Tolerances

- Pill height ±4px. Zone shares ±5%. Headline block centre ±8% of the zone height.

## Reference pieces

- OOH 384×592 and 960×256, Phase 3 (Storms, Quakes, Tsunami) — signed off.
- DV360 300×600 and 970×250 statics — signed off (display variant: yellow LEARN MORE button, tighter crop).
- Working files: `26-PRO-0461 - AEM Get Ready burst 2` 384×592 and 960×256 InDesign packages.
