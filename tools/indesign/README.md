# InDesign bridge

`AC-InDesign-Bridge.idjs` is the supported route from approved InDesign key visuals into AC Automation.

## Install

1. In InDesign choose **Window > Utilities > Scripts**.
2. In the Scripts panel, right-click **User** and choose **Reveal in Finder**.
3. Copy `AC-InDesign-Bridge.idjs` into the revealed Scripts Panel folder.
4. Return to InDesign. The script appears immediately under **User**.

## Prepare the masters

Open two to four approved key visuals and close unrelated InDesign documents. The script exports every page in every open document, so use one approved page per open document unless the pages are intentional variants.

Visible top-level artwork must be on these layers:

- `art:background`
- `art:hero`
- `art:headline`
- `art:subheadline`
- `art:body`
- `art:cta`
- `art:logo`
- `art:decoration`
- `art:legal`

Objects on any other layer are skipped and listed in `export-report.txt`.

## Export and upload

1. Double-click `AC-InDesign-Bridge.idjs` in the Scripts panel.
2. Choose an output folder.
3. Wait for the completion message.
4. Upload the generated `*-AC-Masters.zip` in **Artwork WIP > Upload artwork**.

The ZIP contains an `ac-master.json` contract plus transparent artwork layers. The app treats the package as authoritative, creates one WIP master per page, learns a profile from the family, and bypasses inferred layout recipes.

Rasterised artwork layers are exported from InDesign at 300 dpi. Live text remains live in the manifest. Final print PDFs still need the required document bleed and crop-mark export settings.

## Master families

Family is inferred from page shape:

| Family | Shape |
|---|---|
| Slim portrait | width ÷ height at or below 0.55 |
| Portrait | above 0.55 and below 0.82 |
| Landscape | 0.82 up to 2.75 |
| Slim landscape | 2.75 and above |

Extreme targets stop if the corresponding slim master is missing. Exact-size targets are cloned without adaptation.

## Key-visual layer names (added 20 Sep 2026)

Besides the `art:` names above (the `art:` prefix is optional), the bridge now
understands the layers a campaign key visual uses. Name the LAYER, one job per layer:

| Layer | What goes on it |
|---|---|
| `Background` | the photograph, GROUPED with its tint so InDesign renders the blend into one picture |
| `Shade` (or `Tint`, `Fade`) | fades/shades over the photograph, left separate |
| `Anther` | the anther holding its picture — one object |
| `Title` | the campaign title lock-up (artwork) |
| `Headline` | event name — live type |
| `Dates` | dates — live type (dates set smaller in the Headline frame are split off automatically) |
| `Body` | message copy — live type |
| `CTA` | the pill and its label together |
| `Badge` | roundel on the anther's shoulder (its type stays in the picture) |
| `Strapline` | "Tāmaki Turuki. Altogether Auckland." — live type |
| `Pattern` | pattern |
| `Logo` | logo or lock-up |
| `Credit` | picture credit (rotated type is exported as a picture) |

What the bridge does with them: every layer is rendered by InDesign itself to a
transparent PNG (so blends, fades, polygon frames and vector art are exact),
copy the app re-sets stays live, and type inside scaled groups is exported at
the size it really appears. Large pages export at a resolution that keeps the
longest side near 4000px.

Tested 20 Sep 2026 on the Auckland Heritage Festival file: named layers →
bridge package → WIP master → the six check sizes, all built by the
key-visual composer with nothing rejected. The plain "File ▸ Package" IDML
route was tested the same day and is NOT suitable for this kind of artwork
(vector lock-ups dropped, the anther's polygon frame missing, tints flattened).
