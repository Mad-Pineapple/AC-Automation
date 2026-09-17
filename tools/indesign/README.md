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
