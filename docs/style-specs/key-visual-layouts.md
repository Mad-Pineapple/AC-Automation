# Key-visual layouts — rules, styles and schema

How the studio lays a campaign's key visual out at a size the designers never
drew. Written from five real campaigns (Get Ready OOH, Get Ready Display,
Flood Viewer, AC Brand digital layouts, Auckland Heritage Festival 2026) and
the AC Brand Guidelines (June 2025): pp.15–16 digital grid and examples,
pp.28–31 the anther, p.36 full-bleed photography with an anther.

STATUS: draft, local only — not pushed. Correct anything that is wrong; the
numbers here are the ones the code uses.

---

## 1. The rules (K-rules)

Every engine obeys these. They are ordered: a lower rule never breaks a higher one.

**K1 — Imported artwork is never modified.** A master is reproduced as it was
supplied. The rules below apply to generated sizes only.

**K2 — One picture.** Where a subject appears twice in a master — inside an
anther and in the photograph behind it, or as a cut-out layer over its own
photograph — the two are ONE picture. They move and scale together.
- Anther key visual: the background photograph is locked to the anther's
  transform; if it no longer covers the artwork it is enlarged about the
  circle's centre, the picture inside the anther staying as it is.
- Layered display master: the cut-out stays registered on the photograph at
  the photograph's scale. If the subject is wider than the window, or the
  copy now sits over it, the cut-out LAYER leaves and the photograph's own
  subject shows. It is never moved to sit beside its twin.

**K3 — The anther is whole.** Never cropped, never covered in its core
(the inner 55% of the circle's radius). A badge may ride its rim. Its stem
runs off an edge of the artwork. It is as large as its zone's page margins
allow. (Guidelines pp.28–31; `lib/anther.ts`.)

**K4 — Things leave in a fixed order, and air leaves before copy does.**
Before any part is left out, gaps tighten and the picture gives room. Then:

| Order | Part | Leaves when |
|---|---|---|
| 1 | Picture credit | artwork under 500px tall or 260px wide, or no free edge |
| 2 | Strapline ("Tāmaki Turuki…") | no legible room (9px) beside the logo |
| 3 | Pattern | strips |
| 4 | Badge | under 44px across |
| 5 | Dates / sub-line | cannot be set at 9px on one line |
| 6 | Message | shallow panel (under 200px) that cannot hold message + button + logo; or a message that is a PICTURE of one line and would be under 9px tall |
| 7 | Event copy | strip with under 120px of free run |
| 8 | Anther / cut-out layer | strip under 400px wide (circle would be under 48px) — the photograph stays |
| never | Title / heading, call to action, logo | — |

Every part left out is recorded (`droppedParts`, with the reason in plain
words) and the piece is marked for review.

**K5 — Fill the space.** Type and objects are sized for the space they are
IN, not scaled from the master's pixel sizes.
- A panel column using under two thirds of its zone grows (every part by the
  same factor) to about 72%, stopping at the width caps (message 90%, button
  85%, logo lockup 70% of the column — 96% on columns under 200px).
- Where a column holds only a message and a button, the message may grow
  until two lines span the column, never past 62% of the heading's size.
- On a narrow tall size the anther is bound by WIDTH; the spare height is
  shared between the gaps (copy moves up half of it, the button a third)
  instead of leaving one hole.
- Online sizes (400px wide or less) set copy larger against the width than a
  poster does (8.8% vs 6.8% of width for a stacked key visual's event copy).

**K6 — The pill formula.** Pill height = master's pill ÷ heading × this
size's heading; floor 24px (18px label); label's cap height centred; icon
0.74 × pill, concentric; one line always. (`lib/ctaPlan.ts`, `lib/pillRule.ts`.)
An artwork pill (a web-address pill) scales as one object and is never reshaped.

**K6a — The master's call to action is the campaign's.** Ruling, 20 Sep 2026:
Storms' "Auckland emergency" search pill stays on EVERY size, online sizes
included. The campaign's online button (LEARN MORE) replaces it only when a
build asks for it (`onlineButton: true` on the adapt request). The measured
online look (photo share, band, no scrim) still applies to online sizes.

**K7 — Reading order never changes.** Title/heading → event copy or message
→ call to action → logo, top-to-bottom on tall sizes, left-to-right on wide ones.

**K8 — Legibility floors.** Live copy 9px (dates, strapline) / 11px (event
copy, message) / logo lockup 16px tall / contrast 4.5:1 for small type, 3:1
for large — or no worse than the master. Shades behind copy are held at full
strength up to the top of the copy they serve.

**K9 — Tracking scales with type.** A master's letter-spacing is carried as a
share of the type size (`letterSpacingEm`), never as fixed pixels.

**K10 — Sense breaks.** Copy in a narrow column breaks where the sentence
does — after a full stop, comma or dash — never mid-phrase ("Body copy here.
Body / copy, body copy." is wrong). Every grouping of the sense units is
tried; the designer's own breaks win unless another grouping sets the copy at
least 15% larger.

**K11 — A pattern band runs edge to edge.** Where a master's band picture is a
motif shorter than its panel, the motif repeats from the zone's leading edge
and the last repeat runs off the far edge.

**K12 — A stack breathes evenly.** A panel column is spaced with equal air
above, between and below its parts. Measured anchor positions are used only
while every gap is at least 40% of its smaller neighbour and the last part is
clear of the edge.

**K15 — The handle meets the edge.** An anther's stem ends in a straight cut —
the master's own artwork edge. That cut side sits on or past the same edge at
every size, so the handle never stops short; the circle keeps the distance
from that edge the designer gave it. Pictures reduced by more than 40% are
resampled properly first, so rims and keylines stay clean.

**K13 — Parts are sized by their picture, not their box.** A layered master's
part drawn "contain" in a wider box is measured by the rectangle the picture
really fills (in memory; the master is not rewritten).

**K14 — One square design, at every pixel size.** A 1080×1080, a 600×600 and
a 300×250 are the same design. The heading runs as wide as it does on the
campaign's other versions (the master's share of the photo's width, 84–90%),
not to a height cap — and where that enlarges it, it grows UPWARD so its foot
stays clear of the picture's subject. An anther square's body copy is set
against its column (a tenth of its width). A heading already bound by its
width (Flood's) is left exactly where it is. Two differences between squares
remain on purpose: social squares omit the logo (guidelines p.16), and a
300×250's 100px panel has no room for the message (K4).

---

## 2. The styles

A *style* is how a campaign is built. The engine recognises the style from the
master's structure, not from its name, so a new campaign in a known style
works without new code.

### S1 — Photo over panel (Get Ready OOH, Flood Viewer)
Photograph with the heading on it; pattern band; colour panel carrying
message, pill and logo. Engine: `recompose`.
| Shape | Layout |
|---|---|
| tall / tower | photo on top · band · panel below (tower: tile bottom-centre) |
| square | photo on top · band · panel (social squares omit the logo per p.16) |
| landscape / wide | photo left · panel right, band across the panel's top |
| strip | photo · heading on it · message + button · full-height logo tile |
Online sizes keep the master's own pill (K6a) and wear the measured online look (no scrim).

### S2 — Layered display master (Get Ready Display)
An HTML5 banner's layers: photo, scrim, heading and sub-line as pictures,
cut-out subject, panel parts (band, message, button, lockup). Engine:
`layered`. Same zones as S1. Rules K2 (cut-out registered), K4 row 6 (picture
message leaves where unreadable), K5 (column fills its panel).

### S3 — Anther on a colour ground (AC Brand digital layouts)
Heading on the ground colour, anther holding the picture, body copy, search
pill, pattern + pōhutukawa tile along the bottom. Engine: `recompose`
(anther layout).
| Shape | Layout |
|---|---|
| tall / tower | heading · anther (margin to margin, up to 46% of height, yielding so the panel keeps 26%) · copy + pill · pattern + tile |
| square | heading across the top · anther left (61% / 53% on MREC) · copy + pill right, copy on sense breaks (K10) |
| landscape / wide | anther left, zone as wide as the artwork is tall · heading, copy, pill right |
| strip | anther · heading · pill · tile |

### S4 — Full-bleed key visual with an anther (Heritage Festival; guidelines p.36)
Graded photograph full-bleed; anther frames the subject with a clean copy of
the same picture; title lock-up (artwork); event copy (live); web-address
pill; badge on the anther's shoulder; pattern, strapline, logo, credit.
Engine: `key-visual:anther` (`lib/kvAnther.ts`).
| Kind | When | Layout |
|---|---|---|
| tall | W/H < 0.9 (tower under 220px wide) | title · anther · event copy · pill · strapline + logo row |
| square | 0.9 – 1.15 | title across the top, right-aligned clear of the badge (66% of width) · anther left under it (up to 60%) · copy + pill right · strapline bottom-left · logo bottom-right |
| column | 1.15 – 2.5 | anther left (52% of width, at most the height) · title, copy, pill in the right column · strapline + logo along the bottom |
| banner | ≥ 2.5 and over 120px tall | anther · title over event copy · pill over logo (shared right edge) |
| strip | ≥ 2.5 and 120px or less | anther · title · event copy · pill · logo; under 400px wide: title · pill · logo on the shaded photograph |
Shades: top shade under the title, side or bottom shade under the copy, in
the master's own shade colour.

### S5 — Photo-led key visual, no anther
Full-bleed photograph, copy set on it, no panel. Engine: `key-visual`.

---

## 3. The schema

What a master has to carry for the rules to work. All fields are on freeform
elements (`lib/freeform.ts`); none changes how a master renders.

| Field | On | Meaning |
|---|---|---|
| `slot` | any | the part's job: `photo`, `cutout`, `scrim`, `panel`, `band`, `headline`, `kicker`, `subheadline`, `message`, `cta`, `ctaLabel`, `ctaIcon`, `lockup`, `logo`, `other` |
| `layoutBlock` | any | a named block the style's composer looks for: `title`, `badge`, `credit`, `strapline` |
| `shape` | image | `{ kind: "anther" \| "shape", cx, cy, r, stemX?, stemY?, aspect? }` — circle centre/radius and stem tip as shares of the image; found automatically, stored so K3 can be enforced |
| `letterSpacing` | text | px at the master's size; carried as em when re-set (K9) |
| `baselineFit: "cap"` | text | one-line copy boxed to its cap height, so "centred" means optically centred |
| `panelPart` | image | a piece cut from a baked panel graphic (S2) |
| `droppedParts[]` | config | `{ slot, reason, byRule }` for every part left out (K4) |
| `needsReview`, `rejected[]`, `adaptNotes[]` | config | what a person should look at, and why, in plain words |
| `adaptMethod` | config | which engine built it (`key-visual:anther`, `layered`, `recomposed:<class>`, `scaled`, …) |

### InDesign layer names the importer understands
Use these with the **AC InDesign Bridge** script — see tools/indesign/README.md.
Name the LAYER (not the object); one job per layer. Case does not matter, and
an `Art:` prefix is ignored ("Art: Headline" = "Headline").

| Layer name | Becomes | Notes |
|---|---|---|
| `Background` / `Photo` / `Hero` / `Key visual` | the photograph | full-bleed picture |
| `Anther` | the shaped picture | the anther holding its photo — keep it whole, one object |
| `Title` (or `Title lockup`) | campaign title lock-up | artwork, e.g. AUCKLAND HERITAGE FESTIVAL |
| `Headline` | heading | live type |
| `Subheadline` / `Dates` | sub-line or dates | live type |
| `Body` / `Message` | message / event copy | live type |
| `CTA` / `Button` / `Search` | call to action | pill + label + icon together on this layer |
| `Badge` (or `Roundel`) | badge on the anther's shoulder | |
| `Strapline` / `Tagline` | strapline | "Tāmaki Turuki. Altogether Auckland." |
| `Pattern` / `Band` | pattern | |
| `Logo` / `Lockup` | logo | |
| `Credit` / `Photo credit` | picture credit | |
| `Legal` / `Terms` | small print | |

Anything on a layer with another name still imports; it is just not given a job.

### Importing a key visual so it lays out well
1. Supply the InDesign package (or layered export) so each part arrives as its
   own layer: title lock-up, badge, pill, logo, pattern, anther picture,
   background photograph, live copy. A flattened PDF cannot be re-laid.
2. Tag the blocks: `title`, `badge`, `credit`, `strapline`; slots for the rest.
3. The anther is detected from the picture's outline; check the circle the
   studio draws before approving.
4. Build the six check sizes (tall, square, landscape, MREC, tower, strip) and
   look at them before rolling out the full list.

---

## 3a. The workflow: check set first, then everything else
1. Name the layers as above, run the **AC InDesign Bridge** script (tools/indesign), and upload the ZIP it makes to Artwork WIP. (Tested 20 Sep 2026: the bridge reproduces blends, fades, polygon frames and vector lock-ups exactly; the plain Package/IDML route does not.)
2. Open it → **Adapt to other sizes** → **Select the check set**: 1080×1920 (tall),
   1080×1080 (square), 1920×1080 (landscape), 300×250 (HTML — check the animation in
   *HTML banner preview*), 160×600 (thin tall), 728×90 (thin wide).
3. Edit what needs it and mark each piece Right (or Wrong, with the fault).
4. Approved pieces lead: every other size of that shape is scaled from, or
   rebuilt with the measured proportions of, the approved piece — so the rest
   of the media plan inherits the fixes instead of repeating the faults.

## 4. Known limits (honest list)
- A message or heading that is a PICTURE of type cannot be re-wrapped. On
  towers it leaves (K4). Supply live type, or a two-line picture for towers.
- A web-address pill is long: under 160px wide its label falls below 9px. The
  studio flags it; the fix is a shorter label ("Find out more") for towers.
- The Flood master's own 300×250 has a message box wider than the artwork;
  it is reproduced as supplied (K1).
- Get Ready Display's imported 300×250 master (985) was captured with its
  cut-out mid-animation, so the master itself shows two cars. Re-import from
  the end frame.
