-- 0344 — Single-page stores.
-- An owner can open a store as ONE simple page — a digital menu, a landing
-- page, or the page of a single book, product or course — instead of a full
-- storefront. The storefront then shows only the cover, name, description, the
-- items and the contact buttons (src/lib/page-kind.ts). Null = a full store.
alter table public.stores
  add column if not exists page_kind text
  constraint stores_page_kind_chk
  check (page_kind is null or page_kind in ('menu', 'landing', 'book', 'product', 'course'));

-- 0314 made stores column-granted; a new column is invisible until granted.
grant select (page_kind) on public.stores to anon, authenticated;
