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

## The anther layout (how sizes are composed)

Used when the master houses its picture in an anther and sets the heading on
the colour ground (the council's standard brand layout). Built to guidelines
pp. 15–16 and 28–31, not to a campaign recipe:

- **Tall and tower sizes:** heading across the top ("clear space to run
  headline copy above the shape"), anther centred, circle margin to margin
  (margin = half the tile) up to 46% of the height, then the body copy and the
  pill, then the bottom row.
- **Square sizes:** heading across the top; anther lower-left in 60% of the
  width; body copy and pill beside it, lined up with the circle's centre.
- **Landscape and wide sizes:** anther on the left in a zone about as wide as
  the canvas is tall; heading, body copy and pill in the column beside it.
- **Strips:** anther whole at the left, heading and pill in the panel, tile
  full height at the right.
- **Bottom row:** kotahitanga pattern to the left of the pōhutukawa tile at
  the tile's height (never under it); on towers the tile sits bottom-centre
  at half the width with the pattern above it. Social squares carry no tile.
- **Copy:** the designer's own line breaks in the body copy are kept when
  they fit; heading, body and pill keep the master's proportions to each
  other (pill = master pill ÷ heading × the heading as built; label cap
  height centred).
