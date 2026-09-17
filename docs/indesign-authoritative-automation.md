# Authoritative InDesign automation

This update is based on GitHub commit `a3ae5ddae6eda9f56ce3febbb47f68a85127c841`.

## Why the previous automation failed

The adaptation route could run several competing systems over one job: inferred geometry, approved-example scaling, key-visual composition, panel recipes, generic scaling and AI correction. A later system could replace the measured InDesign geometry. That caused decoration fragments, overlapping layers and incorrect same-size copies.

## New source-of-truth workflow

1. Prepare two to four approved InDesign masters: portrait, landscape and, when required, slim portrait and slim landscape.
2. Put major components on visible `art:*` layers.
3. Run `tools/indesign/AC-InDesign-Bridge.idjs` from the InDesign Scripts panel.
4. Upload the generated `*-AC-Masters.zip` in Artwork WIP.
5. Generate sizes from any master in that imported family.

The bridge package contains an explicit manifest with exact frame geometry, semantic role, block membership, anchors, text styling and layer assets. When the app recognises this manifest it uses the authoritative adapter only.

## Safety rules

- An exact-size target is a byte-for-byte configuration clone.
- A different size uses the closest matching master family.
- Every artwork block scales uniformly. Images and logos are never stretched.
- The complete composition is fitted before block anchors are applied, preventing blocks from piling up on narrow targets.
- Generic recipes, subject detection, panel splitting, feedback-based movement and AI correction cannot modify bridge artwork.
- AI review can report issues, but it cannot reposition authoritative elements.
- Slim targets stop when their matching slim master is absent.
- Normal deterministic checks still reject overflow, collisions and missing mandatory elements.

Existing IDML, PDF, PSD, image and Google Web Designer imports remain on their existing paths.

## Verification completed

- API TypeScript check
- Frontend TypeScript check
- Full Vercel production build
- Exact-size clone test
- 300 x 250 containment test
- Slim-master selection and missing-master stop test
- Bridge-manifest detection and import test

