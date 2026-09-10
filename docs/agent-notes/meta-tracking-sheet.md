---
name: Meta tracking sheet and file-name convention
description: What "tagging for Meta" means in this app, where the sheet comes from, and how it lines up with the HTML5 banner UTMs.
---

Meta takes no tags inside creative; tracking is the destination URL's parameters plus the
Pixel on the council site. The app therefore hands over consistency, not embedded code:

- `lib/trackingSheet.ts` builds one row per piece of a family: ad/file name
  `campaign_variant_format_WxH` (slugged; a suffix that merely names the format is not a
  variant), the Meta placement the ratio fits, and URL parameters on the same scheme as the
  HTML5 banners (`lib/htmlExport.ts`): `utm_source=meta`, `utm_medium=paid_social`,
  `utm_campaign=<campaign slug>`, `utm_content=<ad name>`, `utm_term=<WxH>`. A column with
  Ads Manager's dynamic form (`{{campaign.name}}`, `{{ad.name}}`, `{{placement}}`) lets the
  traffic team paste one string per campaign.
- `GET /templates/:id/tracking-sheet.csv?campaign=&clickUrl=&ids=` (Export menu → "Meta
  tracking sheet (CSV)"; prompts for campaign and destination).
- `POST /templates/:id/export-family.zip` now names files by the convention and includes
  `meta-tracking-sheet.csv`; family = `sourceTemplateId` link first, then the old
  `Adapted from "…"` prefix (`loadFamily` in `routes/exports.ts`).

Google-side tagging (ad.size meta, clickTag, UTMs, viewability beacons to `/track`, Floodlight
pixel URLs, VAST) is unchanged — see the 2026-08 "Google-ecosystem tagging" commit.
