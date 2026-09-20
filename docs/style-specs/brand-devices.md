# Brand devices — schema rules

Rules that hold for EVERY campaign, whatever the artwork. Enforced in code
(`lib/anther.ts`), checked by the quality gate, and indexed with the brand
guidelines so reviewers see them on the piece.

## The anther is never cropped

Designer ruling (Rachel, 20 Sep 2026), built on AC Brand Guidelines June 2025
pp. 16 and 28–31.

1. The anther's circle sits wholly inside the artwork; nothing is laid over
   it (no panel, pattern band, tile, button or copy).
2. It is as big as the margins allow. Margin = half the pōhutukawa tile.
3. The stem runs off the artwork's edge — left, lower left at 45°, or bottom
   centre — with its straight lines showing. That is how the device is drawn,
   not a crop.
4. The stem is never covered by the pōhutukawa tile and never heads for the
   lower-right corner.
5. On narrow formats the margin may give way so the anther can hold its
   picture; the curve where the stem meets the circle stays visible.
6. The guidelines allow a cropped anther only "subject to design review". An
   automated build has no design review, so a size that cannot hold the whole
   anther is REJECTED for a designer, never built with it cropped.

How the app applies it: the anther is recognised from the image itself —
real transparency, or the artwork's own flat ground baked into the pixels
(then a cut-out copy is used for builds; the imported file is never changed).
It must really be a circle on a stem (≥95% of the circle solid, the circle
≥72% of the shape). `placeAnther` sizes and places it; `checkAnther` in the
gate rejects a cropped or covered anther from any engine. Where the anther is
whole but small in a wide zone the piece is flagged for review.
