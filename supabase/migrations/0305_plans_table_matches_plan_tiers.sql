-- public.plans matches src/lib/plan-tiers.ts. Owner confirmed those prices on
-- 2026-09-24 (basic $10 / pro $25 / business $65 a month).
--
-- Before: free $0/$0 and pro $12/$120 only; no basic or business row, so 5
-- stores sat on a tier the catalogue had never heard of. Nothing in src/ reads
-- this table (guarded by plan-price-ssot.test.ts) and no function or foreign
-- key references it, so this changes no screen and no gate; it stops the
-- database contradicting the site.
--
-- price_yearly is the STANDARD annual price (monthly x 12). The launch promo
-- (75 / 150 / 300 until PROMO_END) is time-bound and lives only in plan-tiers,
-- which switches it off by itself; a table column would need someone to
-- remember to change it back.
insert into public.plans (slug, name_ar, name_en, price_monthly, price_yearly, is_active, sort_order)
values
  ('basic',    'أساسية',  'Basic',    10, 120, true, 1),
  ('pro',      'احترافية', 'Pro',      25, 300, true, 2),
  ('business', 'أعمال',   'Business', 65, 780, true, 3)
on conflict (slug) do update
  set name_ar = excluded.name_ar,
      name_en = excluded.name_en,
      price_monthly = excluded.price_monthly,
      price_yearly = excluded.price_yearly,
      is_active = true,
      sort_order = excluded.sort_order,
      updated_at = now();

-- Every store_plan value must have a row.
do $$
declare v_missing text;
begin
  select string_agg(e.enumlabel, ', ') into v_missing
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'store_plan'
    and not exists (select 1 from public.plans p where p.slug = e.enumlabel);
  if v_missing is not null then
    raise exception 'store_plan values with no plans row: %', v_missing;
  end if;
end $$;
