# Master-relative geometry layout

## What changed

The campaign builder now learns free-form artwork as well as conventional photo-and-panel layouts. A campaign can use a portrait key visual and a landscape key visual as its source geometry. The engine measures each semantic layer, then interpolates those relationships for sizes between the two examples.

It does not redraw or flatten the artwork. Layer order, editable text, linked images, focal data and imported HTML animation tracks remain in the output configuration.

## Accuracy rules

1. The supplied key visuals are the evidence. Generic format recipes only run when measured geometry is unavailable.
2. Raster image layers use one uniform scale. Logos, patterns, lens shapes and cut-outs are never stretched on one axis.
3. Artwork touching an edge in both masters remains edge-anchored. Full-bleed backgrounds cover the canvas without distorting their pixels.
4. Live copy receives an interpolated text box and font size. Longer replacement copy is reduced only until it fits that measured box.
5. Existing mandatory-element, collision, minimum-size, margin, balance and contrast checks still run after adaptation.
6. A target outside the aspect-ratio range supplied by the portrait and landscape masters is flagged for review.
7. Existing version 1 layout profiles remain valid and continue through the original panel engine.

## Recommended production workflow

1. In InDesign, prepare one approved portrait key visual and one approved landscape key visual for each creative variant.
2. Package the files so fonts and links are included, then zip each package. IDML or a layered PDF can also be used, but a package retains the richest structure.
3. Open **Build A Campaign** and upload both examples in step 1.
4. Upload the collateral brief in step 2.
5. Select **Match sizes to examples**. The review card should show **Master-relative geometry** and list the measured shapes.
6. Build the selected sizes. Review any item marked **Rejected** or any size outside the supplied portrait-to-landscape range.
7. In Work in progress, adjust only genuine exceptions. Approved pieces can become additional exemplars for later builds.
8. Export static files, print/OOH files or HTML5 from the approved artwork.

## HTML5 use

HTML output is exported from an approved free-form piece. Text remains real HTML text, so headline, body and CTA copy can be changed through the platform or dynamic URL/feed values. Image and glyph motion imported from an HTML key visual is retained. When the source artwork has no captured motion, the HTML exporter can apply the platform's animation presets.

An HTML zip contains the banner page and its optimized assets. Open `index.html` to preview it locally. For ad serving, upload the complete zip, not only the HTML file, and set the click URL and loop/duration options in the export screen.

## Validation completed

- API TypeScript check passes.
- Frontend TypeScript check passes.
- Vercel API bundle builds successfully.
- A square interpolation smoke test confirms proportional photo and logo layers, an in-bounds live headline, and the `geometry-profile` adaptation method.

The repository-wide library typecheck still reports three duplicate generated API exports and missing React typings in an unrelated integration package. Those errors were already present at the downloaded GitHub revision and do not affect the API or frontend checks above.
