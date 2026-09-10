# Connecting Meta Ads results to the Performance page

The studio reads ad results from Meta's Marketing API (read-only, no posting) and shows
them on **Performance → Meta Ads results**: impressions, reach, link clicks, CTR, spend and
CPM for the last 7 / 30 / 90 days, per day and per ad, with each ad matched back to the
studio creative it was exported from. A nightly job (`/api/cron/meta-sync`, 04:30 NZ time)
pulls the last 30 days; admins can also press **Sync now**.

Until the two environment variables below are set the section shows "Not connected" and
the nightly job is a no-op.

## What to ask the council's Business Manager admin for

1. **A system user** in the council's Meta Business Manager (Business settings → Users →
   System users → Add). Name it e.g. `brand-studio-reporting`, role *Employee*.
2. **Asset access**: assign the system user to the ad account(s) the studio's creative runs in,
   with the *View performance* (Analyst) permission only.
3. **A permanent token** for that system user (System user → Generate token) with the
   `ads_read` permission (add `read_insights` if the app prompts for it). Tokens generated
   this way don't expire. Ask them to send it through a password manager or a one-time
   secret link, never email.
4. **The ad account ID** — visible in Ads Manager's account dropdown, e.g. `act_1234567890`.

If the council's Business Manager has no Meta app yet, the admin can create one under
Business settings → Apps (type *Business*, no review needed for a system-user token used
only on the business's own ad accounts).

## Setting it up

Add to the Vercel project (Production) and redeploy, or to `.env.local` locally:

```
META_ACCESS_TOKEN=<system user token>
META_AD_ACCOUNT_ID=act_1234567890
```

Optional: `META_API_VERSION` (default `v21.0`).

Then open Performance and press **Sync now** (admins). The first pull covers the last 30 days;
the nightly job keeps it current. To backfill further, call
`POST /api/performance/meta/sync` with `{"days": 90}` (max 365).

## How ads are matched to studio creative

The Meta tracking sheet (Templates → Export → *Meta tracking sheet*) names every piece
`campaign_variant_format_WxH`, and the traffic team uses that as the Ads Manager ad name
(and `utm_content`). The Performance page matches, in order:

1. ad name equals a template name (slugged);
2. ad name starts with the template's campaign slug and its `WxH` matches the canvas;
3. ad name or Meta campaign name starts with a brief's campaign name.

Anything else shows as *Unmatched* but is still counted in the totals.

## Storage

Rows land in `meta_ad_insights` (created on first use), one per ad per day, upserted so
re-runs are safe. Nothing is ever written back to Meta.
