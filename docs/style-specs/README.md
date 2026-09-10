# Style specs — what "right" looks like, one file per visual style

A style spec is the record the rebuild engine and the reviewer models judge against. One file per
visual style the studio ships (Get Ready, AC brand layouts, …). Designers correct the tables;
engineers turn the numbers into `lib/recipes.ts`.

Every spec has the same sections, so the two can be compared and a new style can be added by
copying one:

| Section | What it records |
|---|---|
| Recognise it by | The two or three things that identify the style at a glance. |
| Axis per shape | stack / columns / one row for tall, wide and strip canvases. |
| Zone shares | Photo, band, panel (or field) as a share of the canvas, with tolerance. |
| Parts | One row per part: headline, sub-line, message, CTA, band, lockup/logo, photo — size, position, floor, and what is dropped first when space runs out. |
| Never | Faults that always send a piece back. |
| Tolerances | How far a number may drift before it is a fault. |
| Reference pieces | Signed-off files the numbers were measured from, and the working file. |

## The error record — how a piece is wrong

Every Wrong verdict in the app now carries these fields (the form on the Wrong button):

| Field | Values |
|---|---|
| Which part | whole piece, photo, headline, sub-line, message, search pill / button, pattern band, panel, logo lockup, logo tile, copy |
| What is wrong | too big, too small, wrong position, cut off, missing, illegible, wrong style for this campaign, off-brand colour or font, wrong crop, something else |
| Expected | a number or a short rule ("pill about 32px", "lockup at the bottom of the panel") |
| Severity | send back, fix next time |
| Note | anything the fields do not capture |

The engine attaches the last few of these to every new piece of the same shape (adaptNotes), and
a person turns repeated ones into a change to the style spec and the recipe.

## Specs

- `get-ready-burst-2.md` — AEM Get Ready Burst 2 (26-PRO-0461): full audit of the delivered folder, 2026-09-10. Machine form in `artifacts/api-server/src/lib/styleSpecs/getReadyBurst2.ts` — the layered adapter, the recomposer and Claude's check read it.
- `get-ready.md` — earlier draft of the same style (2026-09-08), superseded by the above.
- `brand-layout.md` — AC Brand Digital layouts (house style).
