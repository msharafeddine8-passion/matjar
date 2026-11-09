-- 0342: a display-only store can show its prices in Lebanese lira.
--
-- Owner request, 2026-11-09: «أفران المير» prices its menu in lira (ربطة خبز
-- 80,000 ل.ل.). Matjar stores every price in USD, so the bakery's menu read
-- "$0.89". The amount stays in USD (one money model, one rate in app_settings);
-- this flag only changes how a SHOWCASE store prints it. A full store keeps USD,
-- because its cart, checkout and invoices settle in USD and a lira card above a
-- dollar total would be two prices for one thing.
--
-- Read through src/lib/data/store-listing.ts on its own (fail-soft), like the
-- other columns added since 0314's column-level grants.

alter table public.stores
  add column if not exists prices_in_lbp boolean not null default false;

grant select (prices_in_lbp) on public.stores to anon, authenticated;
