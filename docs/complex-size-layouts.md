# Treating complicated sizes — measured from shipped AC creative

Source: **AEM "Get Ready" Burst 2/3** production campaign (`~/Downloads/Large campaign example`)
— 3 phases, DV360 HTML5 banners (300×600, 970×250), digital OOH billboards (384×592,
960×256), plus the production schedule workbook. Every number below was measured off the
delivered files, not inferred.

This is the reference for formats that don't behave like a square: skyscrapers, super-wide
strips, tall OOH. Companion to `brand-guidelines-distilled.md` (which covers the brand system
itself).

## 1. The composition axis follows the canvas

The single most important rule, and the one a naive renderer gets wrong. The same campaign,
built for two opposite ratios, does **not** scale one layout — it rotates the split:

| Canvas | Ratio | Split | Image zone | Message zone |
|---|---|---|---|---|
| 384×592 OOH (portrait) | 0.65 | **horizontal** | top ~55% | bottom ~38% |
| 960×256 OOH (wide) | 3.75 | **vertical** | left ~50% | right ~50% |

- **Tall canvas → stack**: photo on top, message panel beneath.
- **Wide canvas → columns**: photo left, message panel right.
- The message zone is a **solid Ocean-blue panel**, never text floated over busy photography.
- A **kotahitanga pattern band** divides the two zones: full-width across the seam on the
  portrait, a shorter run along the top of the panel on the wide.

## 2. Photography is cover-cropped and panned, never fitted

Measured from the HTML5 packages:

| Canvas | Image natural size | Offset | Effect |
|---|---|---|---|
| 300×600 | 362×600 | x −57, y −111 | 21% wider than frame, panned to place the subject |
| 970×250 | 1030×250 | x −44, y 0 | 6% wider, panned horizontally |

Photos are always **larger than the frame and deliberately offset** so the subject sits where
the layout wants it. Never letterbox, never centre-crop blindly.

A **full-canvas gradient scrim** (`gradient.png`, 300×600 over a 300×600 frame) sits between
photo and type. Type legibility is a layer, not a text-shadow afterthought.

## 3. The CTA pill is a fixed size, not a proportional one

The most counter-intuitive finding, and the one that most improves small formats:

| Canvas | CTA pixel size | As % of width | Position |
|---|---|---|---|
| 300×600 | **181×43** | 60% | centred horizontally, y ≈ 77% |
| 970×250 | **181×43** | 19% | x ≈ 75%, vertically centred |

**Identical pixel dimensions in both** (confirmed again 2026-09-02 from the rendered DOM: 181×43 on every banner in the working files). The CTA has a legibility floor — it stops scaling down
once it hits roughly 181×43 at these canvas scales (≈ 43px tall). It is placed, not stretched:

- **Tall formats**: centred horizontally, low (≈ ¾ down).
- **Wide formats**: right-hand side, vertically centred inside the message zone.

## 4. Headlines get a defined band, and it's bigger than proportion suggests

| Canvas | Headline glyph height | As % of short axis | Band position |
|---|---|---|---|
| 300×600 | 57px | **19%** | y 19%–29% (Storms, with cut-out) / 24%–34% (Quakes, none) |
| 970×250 | 96px | **38%** | y 7%–46%, x 10%–58% |

> **Measure rendered geometry, not CSS.** GWD authors the glyph group at 2× inside a container
> that settles at `scale3d(0.5, …)`. The 300×600 letters are 120×189 in the stylesheet but
> **36×57 on screen**; an earlier version of this table carried the 2× figure. The importer
> (`lib/gwdImport.ts`) now resolves container transforms, so imported element boxes are the
> rendered ones.

A single-line display headline occupies roughly **a fifth of the short axis on the tall format
and a third on the wide one**. Scaling type by a small fraction of the canvas (the obvious
approach) still produces headlines well under this and reads as timid.

**Headline position depends on whether a cut-out fills the lower photo zone** (measured as the
centre of the headline + strapline block, as a fraction of the photo zone height):

| Canvas | With cut-out (Storms) | No cut-out (Quakes) |
|---|---|---|
| 300×600 | 47% | 56% |
| 970×250 | 36% | 49% |

Without a foreground object the designers drop the headline onto the subject so the photo
never reads as empty sky above an unused wave. `lib/recipes.ts` carries both values
(`headlineCentreFrac` / `headlineCentreFracBare`).

Letterforms sit on a **monospaced grid** — on the 300×600 the advance is ~44px with glyphs at
x = 11, 55, 113, 156, 198.

## 5. Depth: a cut-out element over the photo

Both formats layer a **cut-out foreground object** (the flooded car) over the background photo:

- 300×600: 240×142 at (3, 208) — 80% of width, lower-middle
- 970×250: 354×82 at (114, 168) — 36% of width, bottom-left

This is the guidelines' three-plane thinking (background / mid-ground subject / foreground)
applied to a banner, and it's what stops the composition reading as "photo with text on it".

## 6. One master, many versions

The campaign ships **3 phases × 3 hazards × 4 countdown states** from one layout:

- Phases: Pre / During / Post daylight-saving weekend
- Hazards: Storms, Quakes, Tsunami (image + headline word swap only)
- Countdown: 48H / 36H / 24H / 12H (same layout, different digits)

The layout is the constant; imagery, one headline word, and a numeric state are the variables.
This is the model for our variants feature — vary content within a fixed composition, don't
regenerate the composition.

## 7. Ad-serving conventions observed

- Built in **Google Web Designer** (`environment: gwd-dv360`), exported per size.
- **No `ad.size` meta and no `clickTag`** — the DV360 environment handles the exit
  (`gwd.actions.gwdDv360.exit`). Our generic ad tags still need both, since we target any ad
  server; this is a difference to be aware of, not to copy.
- Package weight ≈ **252KB** per banner — above the classic 150KB display cap, acceptable on
  DV360 with polite loading.
- Countdown banners compose digits from **individual PNG glyphs** rather than webfonts, which
  is how they get a licensed display face into an ad-server-safe package with no external
  font requests.

## 8. Checklist for any awkward canvas

1. Ratio ≥ 2 (wide) → split **left/right**. Ratio ≤ 0.7 (tall) → split **top/bottom**.
2. Give the message a **solid brand-colour panel**; don't float copy over busy photography.
3. Divide the zones with a **kotahitanga pattern band**.
4. Cover-crop the photo **oversized and offset** to place the subject; add a gradient scrim.
5. Headline band ≈ **⅓ of the short axis** for a single display line.
6. CTA pill at its **legibility floor (~43px tall)** — centred-low on tall, right-centred on wide.
7. Drop body copy entirely when the message zone can't hold it — the real banners carry
   headline + CTA + logo only.
