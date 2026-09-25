# F3 — Google free-listings feed (Pro + Business)

Branch `feat/zero-subscription-features` (base 48cdda3). Nothing committed, pushed or deployed. **Migration 0308 is written, not applied.** No production write of any kind was made; the only database access was read-only `SELECT`s (schema, policies, triggers, public product rows) and one anon-key read of public products to build the sample below.

## Result in one paragraph

A per-store RSS 2.0 feed (`xmlns:g`) at `/feeds/{slug}/google.xml` (store id accepted in place of a slug), built from a pure, tested module (`src/lib/google-feed.ts`). It is forced-static with a one-hour revalidate, so crawlers never hit the database per request. It answers only when the store's effective plan is Pro/Business, the owner switched it on, the store is active and both policies are written. Otherwise it returns 404. There is an owner page at `/merchant/{storeId}/google-feed` with the pre-flight checklist, both policy editors, the on/off switch, the copyable URL and the Google and Meta guides. A public policies page is at `/store/{id}/policies`. Product JSON-LD now uses `products.brand` before falling back to the store name. **Today no production store qualifies**: none has a return policy or a shipping policy, and the shipping column does not exist until 0308 is applied.

## ⚠ The finding the owner must decide on first

Google Merchant Center **requires the website that product links open on to be verified and claimed** by the account that submits the products. Items that link to an unclaimed domain are disapproved. Every link in this feed opens on `matjarlb.com`, and a merchant cannot claim that domain from their own account. As specified ("the merchant connects the feed in their OWN Merchant Center account"), the Google half therefore cannot complete for a merchant alone. The guide says this plainly (step 3) and tells the merchant to contact Matjar support. It does not promise approval.

Zero-cost ways to close the gap, for the owner to choose between:
1. **Matjar opens one Merchant Center multi-client (advanced) account**, which is free, and claims `matjarlb.com` once. Each store that asks becomes a sub-account whose feed is this URL. This is the standard marketplace setup.
2. Matjar lists all opted-in stores itself as a single marketplace account.

I could not confirm from inside this session whether Lebanon is a supported target country for free listings. The guide tells the merchant that Merchant Center shows which countries they can target, and that the same URL still works as a Meta catalog if Lebanon is not offered. **Meta Commerce Manager accepts the feed as a scheduled data feed without a domain claim**, so that half works as built.

## Feed spec

| Feed attribute | Source column | Fallback / rule |
|---|---|---|
| `g:id` | `products.id` (uuid, 36 chars) | — |
| `g:title` | `products.name` | whitespace collapsed; cut at a word boundary to ≤150 chars (Google's limit); CDATA |
| `g:description` | `products.description` | **required**: no description means no item (flagged in the checklist); ≤5000 chars; CDATA |
| `g:link` | `https://matjarlb.com/ar/product/<id>` | `SITE_URL` (env `NEXT_PUBLIC_SITE_URL`, default matjarlb.com) |
| `g:image_link` | `products.image_url` | **required** and must be `https://`, otherwise no item (flagged) |
| `g:additional_image_link` | `products.gallery[]` (https strings) | main image deduplicated; at most 10 |
| `g:price` | `products.price` | `"12.00 USD"`: dot decimal, 2 places, no grouping. **required > 0**, otherwise no item (flagged) |
| `g:sale_price` | a flash price running now (`flash_price` inside `[flash_start, flash_end)`), else `discount_price` | emitted only when lower than `price`; same priority as `lib/pricing.ts effectivePrice`, so it matches the landing page |
| `g:sale_price_effective_date` | `flash_start/flash_end` (ISO 8601 interval) | only for a flash price |
| `g:availability` | `products.stock` | `null` (stock not tracked, which is every product in production) → `in_stock`; `≤ 0` → `out_of_stock`. `is_available=false` rows are excluded entirely |
| `g:condition` | `products.attributes.condition` (retail/automotive attribute) | `used` / `refurbished` when recorded, else `new`. No product records a condition today |
| `g:brand` | `products.brand` | store name. 1 product in production has a brand (on a free store) |
| `g:gtin` | `products.sku`, only when it is a checksum-valid GTIN-8/12/13/14 | omitted. There is no barcode column; 0 products have a SKU. **`g:mpn` is never sent**, because a shop's own SKU is not a manufacturer part number |
| currency | none: there is no currency column on `products` or `stores` | always **USD**. Every price on Matjar is stored in dollars; LBP is only a display conversion (`formatLbp`). "LBP stores emit LBP" is not possible because no store stores LBP. `FEED_CURRENCY` is the one constant to parametrise if that changes |

**Included rows:** `status='active'`, `deleted_at is null`, `is_available`, `hidden_by_plan=false` (the same filters as the public RLS and storefront), and a purchasable physical good. That means `item_kind='product'` and `resolveOffering(...)` gives `variant='physicalProduct'` with `addableToCart`, **and** the storefront takes orders (`resolveStoreExperience(...).canOrderProducts`). That last check excludes automotive: the offering resolver would let a car reach a cart, but the store page never renders a basket there. Services, restaurant dishes (the `food` sector, including the butcher "Let's meat"), digital items, real estate and cars are never listed.

**Store gate (`feedServes`)**: active and not deleted; `google_feed_enabled`; `hasPlan(effectivePlan(plan, trial_ends_at), 'pro')`; non-blank `return_policy` and `shipping_policy`. Anything else returns a plain 404.

**Cost**: `dynamic = 'force-static'` and `revalidate = 3600`. There is no searchParams/cookies/headers access. `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`, `Content-Type: application/xml; charset=utf-8`, `X-Robots-Tag: noindex`. Reads use the cookie-less **anon** client, never a service role. Turning the switch or saving a policy calls an owner-checked server action that `revalidatePath`s both feed URLs and busts `store:<id>`. `src/proxy.ts` already skipped `/feeds/...` through its dot rule; `feeds/` is now also named explicitly in the matcher, the same way `.well-known` is.

## Which production stores would qualify today (read-only, 2026-09-25)

None. Every store fails at least the two policy checks (0 stores have a return policy, and `shipping_policy` does not exist yet). If both policies were written today:

| Store (slug) | Plan (effective) | Visible products | Would be listed | Blocked by data gaps |
|---|---|---|---|---|
| misk | business | 11 | **3** | 8 (missing photo and/or description) |
| albarake (ملحمة البركة) | business | 10 | 0 | 10 |
| kheirwbarake | pro | 4 | 0 | 4 |
| nazih-home | pro | 1 | 0 | 1 |
| giggles-care-lebanon | pro | 1 | 0 | 1 |
| passion-glow | business | 2 | 0 | 1 (the other is a service) |
| let-s-meat | pro | 3 | 0 | 0: `food` sector, so its items are dishes |
| two healthcare stores (no slug) | pro | 3 each | 0 | 0: all services |
| qabass, mehras-chtoura | business / pro | 0 | 0 | — |
| one store on an active trial (no slug) | free→pro | 0 | 0 | — |
| aanab-perfumes, sleepy-care | free | 3 each | — | plan (upgrade prompt shown) |

Realistically **misk is the only candidate**, with 3 products, once it writes both policies.

## Sample: 2 real items (misk, production, generated read-only through the anon key)

The sample was generated with `toFeedItem` and `buildGoogleFeedXml` from `src/lib/google-feed.ts`. It is well-formed XML: .NET `[xml]` parsed it and found 2 `<item>`s. "ريوت" is the merchant's own typo, left as written.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title><![CDATA[misk]]></title>
    <link>https://matjarlb.com/ar/store/c028af40-1d75-485e-8855-5ad6a1eefff6</link>
    <description><![CDATA[misk — Matjar]]></description>
    <item>
      <g:id>10767593-c754-488a-8ea0-96ed73f2a576</g:id>
      <g:title><![CDATA[صابون زبدة الشيا]]></g:title>
      <g:description><![CDATA[ريوت طبيعية]]></g:description>
      <g:link>https://matjarlb.com/ar/product/10767593-c754-488a-8ea0-96ed73f2a576</g:link>
      <g:image_link>https://wesihatopiznatsyfxer.supabase.co/storage/v1/object/public/store-assets/c028af40-1d75-485e-8855-5ad6a1eefff6/f723c2cf-d09f-4b12-a07f-81d0efee97d9.jpeg</g:image_link>
      <g:additional_image_link>https://wesihatopiznatsyfxer.supabase.co/storage/v1/object/public/store-assets/c028af40-1d75-485e-8855-5ad6a1eefff6/ddd16da2-33b8-4f57-87af-223b552566e0.jpeg</g:additional_image_link>
      <g:availability>in_stock</g:availability>
      <g:price>2.99 USD</g:price>
      <g:condition>new</g:condition>
      <g:brand><![CDATA[misk]]></g:brand>
    </item>
    <item>
      <g:id>1c3457be-9d0d-4610-8d74-9fd3365ab2cf</g:id>
      <g:title><![CDATA[صابون الكركم]]></g:title>
      <g:description><![CDATA[زيوت طبيعية]]></g:description>
      <g:link>https://matjarlb.com/ar/product/1c3457be-9d0d-4610-8d74-9fd3365ab2cf</g:link>
      <g:image_link>https://wesihatopiznatsyfxer.supabase.co/storage/v1/object/public/store-assets/c028af40-1d75-485e-8855-5ad6a1eefff6/dd4dd719-0234-4b3b-8214-4345fa0e29e5.jpeg</g:image_link>
      <g:additional_image_link>https://wesihatopiznatsyfxer.supabase.co/storage/v1/object/public/store-assets/c028af40-1d75-485e-8855-5ad6a1eefff6/5fbe2d8d-063c-4428-b8fc-bb5f13fcc9f9.jpeg</g:additional_image_link>
      <g:availability>in_stock</g:availability>
      <g:price>2.99 USD</g:price>
      <g:condition>new</g:condition>
      <g:brand><![CDATA[misk]]></g:brand>
    </item>
  </channel>
</rss>
```

## Migration 0308 (written, NOT applied)

`supabase/migrations/0308_google_feed.sql`:
- `stores.shipping_policy text`, `stores.google_feed_enabled boolean not null default false`, `stores.google_feed_enabled_at timestamptz`, with column comments.
- **Authorization is unchanged.** The owner writes these through the existing PostgREST UPDATE under `stores_update` (owner or an admin with the `stores` permission; staff cannot). anon and authenticated hold table-level SELECT/UPDATE on `stores`, so no column grant is needed.
- Trigger `stores_guard_google_feed`, running `guard_google_feed()` (SECURITY INVOKER, `search_path=''`, EXECUTE revoked from public/anon/authenticated):
  - A browser may switch the feed **on** only with both policies non-blank and a plan of pro/business or an active trial. The check reads **OLD.plan and OLD.trial_ends_at**. `guard_store_platform_columns` runs after it alphabetically and resets `plan`, so reading NEW would let an owner pass by claiming `plan='pro'` in the same update.
  - A browser INSERT can never create a store with the feed already on.
  - `google_feed_enabled_at` belongs to the trigger: set to `now()` when switched on, kept while on, `null` when off.
  - Trusted paths and super admins skip the preconditions, the same escape hatch as `guard_store_platform_columns`.
  - Errors raised: `google_feed_requires_policies` and `google_feed_requires_plan`. The dashboard maps both to Arabic and English messages.
- Verification script (not run): `supabase/tests/0308_google_feed.test.sql`. It runs in `begin … rollback` against an active pro/business store and writes to temp table `r`, selected once. It has 10 checks: schema, blocked without policies, owner writes policies, switch-on with a forged `enabled_at` ignored, anon reads, switch-off clears, a free store refused even when claiming `plan='pro'`, a trial is allowed, a non-owner touches 0 rows, and invoker plus pinned search_path.
- **Before 0308 is applied**, nothing crashes:
  - The feed route's store SELECT fails, so it returns 404, which is the correct answer.
  - The dashboard reads the 0308 columns in a separate query. On failure it shows a "being set up" notice and disables the switch and the policy form.
  - The policies page reads `shipping_policy` separately and treats a missing column as "not written".
  - `store-view.ts` was deliberately **not** changed to select `shipping_policy`, because an unknown column blanks the whole storefront.

## Files changed (mine)

- `src/lib/google-feed.ts`: **new**. Pure mapping, escaping, exclusion, gating and checklist.
- `src/lib/__tests__/google-feed.test.ts`: **new**. 34 tests.
- `src/app/feeds/[slug]/google.xml/route.ts`: **new**. The feed route (force-static, 1 h, anon client).
- `src/app/[lang]/(dashboard)/merchant/[storeId]/google-feed/page.tsx`: **new**. Owner page: checklist, product gaps with fix links, guide, Meta note, ProGate below Pro.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/google-feed/google-feed-panel.tsx`: **new**. Client component with status, copy URL, switch and both policy editors.
- `src/app/[lang]/(dashboard)/merchant/[storeId]/google-feed/actions.ts`: **new**. Owner-checked cache bust for the feed and policies page.
- `src/app/[lang]/(site)/store/[id]/policies/page.tsx`: **new**. Public policies page (cached, tag `store:<id>`, 404 when neither policy exists, no `loading.tsx`).
- `supabase/migrations/0308_google_feed.sql`: **new**. Not applied.
- `supabase/tests/0308_google_feed.test.sql`: **new**. Not run.
- `src/lib/feature-availability.ts`: added the `googleFeed` FeatureId (live, floor pro), the `FeatureEntry.copy` override, and the `OwnCopyFeatureId` / `PricedFeatureId` types; `PRICING_MATRIX` and `PLAN_HIGHLIGHTS` are now typed `PricedFeatureId`. The ledger agent reused this mechanism for `debtLedger`.
- `src/lib/__tests__/feature-availability.test.ts`: the `pricing.features` label check now skips features that carry their own `copy`. The ssot test still resolves their paths in both dictionaries.
- `src/lib/jsonld.ts`: `brand` parameter; Product brand = `products.brand`, falling back to the store name (the only gap found).
- `src/lib/__tests__/jsonld.test.ts`: 3 brand tests.
- `src/app/[lang]/(site)/product/[id]/page.tsx`: passes `brand: product.brand` to the JSON-LD (one line).
- `src/components/store/store-fulfillment.tsx`: optional `policiesHref` link ("full return and shipping policies"), shown only when a return policy exists.
- `src/app/[lang]/(site)/store/[id]/page.tsx`: passes `policiesHref` for real stores (one line).
- `src/app/[lang]/(dashboard)/merchant/[storeId]/settings/page.tsx`: a link card to the Google feed page.
- `src/proxy.ts`: `feeds/` named in the matcher exclusion, with a comment.
- `src/i18n/dictionaries/ar.json` and `en.json`: one `googleFeed` namespace each (84 lines), inserted textually before `  "features": {`, CRLF preserved, 0 bare LF, validated with JSON.parse. Lebanese Arabic, Western digits.

## JSON-LD check (item 4)

The product page emits `offeringJsonLd`. For a physical good it is a Product with an Offer: `price` = `effectivePrice` (flash, then discount, then base, which is what the page charges), `priceCurrency` USD (the only currency), availability InStock/OutOfStock from `soldOut`, `image` = first image, and brand. The one gap was the brand, which was always the store name even when `products.brand` was set; that is fixed. Confirmed on the dev server by curling `/ar/product/10767593-…`: `"price":2.99,"priceCurrency":"USD","availability":"https://schema.org/InStock","image":"https://…jpeg","brand":{"@type":"Brand","name":"misk"}`. Services and dishes still carry no brand or availability (tested).

## Not browser-verified / not done

- **The dashboard page was not seen rendered.** It needs an owner login, and I do not enter credentials. The dev server shows it compiles and redirects an anonymous visitor (307). RTL layout, the copy button and the switch are unverified visually.
- **The feed's positive (200) path has not run end to end**, because 0308 is not applied. On the dev server `/feeds/misk/google.xml`, `/feeds/<uuid>/google.xml` and a malformed slug all return `404 text/plain` with **no locale redirect**. The 200 body is covered by the unit tests and the real-data sample above.
- `/ar/store/<misk>/policies` returns 404 (no policies yet, as designed). The store page still returns 200. No server errors were logged.
- ISR behaviour of a force-static dynamic route under `next start` on Hostinger was not exercised (no `next build`, per instructions).
- **Not in the sidebar.** The page is reachable from Settings only. Adding a sidebar entry means a new `OsModuleKey` in `sectors.ts`, which the ledger agent is editing now.
- **Not on /pricing.** `googleFeed` has no `pricing.features` label (one-namespace dictionary rule), so the type system keeps it off the matrix. To advertise it, add `pricing.features.googleFeed` and put it in `PRICING_MATRIX` and `PLAN_HIGHLIGHTS.pro`.
- Feed titles are Arabic (`name`) and links go to `/ar/`. There is no English feed variant; `name_en` exists if one is wanted.
- Products with variants are listed at the base price and availability. Variant-level items (`item_group_id`) are not emitted.
- A flash price that ends inside the feed's cache hour can differ from the page for up to one hour, until the next rebuild.

## Gates (verbatim)

`npx tsc --noEmit`:
```
src/app/[lang]/(dashboard)/merchant/[storeId]/ledger/page.tsx(10,28): error TS2307: Cannot find module '@/components/ledger/ledger-home' or its corresponding type declarations.
```
That is the only error, and it is in the ledger agent's in-progress files (a component they have not written yet). There are none in F3 files. Earlier in the session, before their files existed, the run was clean.

`npx vitest run`:
```
 Test Files  54 passed (54)
      Tests  975 passed (975)
```

`npx eslint <the 16 files above>`: no output, exit 0 (includes `matjar/no-raw-directional-icon`).

`npm run check:migrations`:
```
PASS — no NEW violation. Every live SECURITY DEFINER function outside the baseline says who may execute it and pins search_path = ''.
```
