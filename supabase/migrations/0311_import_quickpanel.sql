-- 0311 — Spreadsheet import on every plan, with a name fallback for rows
-- that carry no product code.
--
-- WHAT CHANGES (one function replaced, one added; no table, no policy):
--
--   1. import_products() — the whole body is restated (not patched) so the
--      file says exactly what runs. Compared with the live definition
--      (0214 + 0222):
--        * NO PLAN GATE. The spreadsheet import is free on every plan
--          (FEATURES.excelImport in src/lib/feature-availability.ts). The
--          product CAP is unchanged and still enforced here, once, with real
--          numbers (store_product_limit, 0214: free 3 · basic 30 · pro 200 ·
--          business unlimited) — importing is free, a bigger catalogue is not.
--        * PERMISSION: staff_can(store, 'products') instead of
--          can_manage_store(store). can_manage_store let ANY staff member —
--          one with only the bookings permission — bulk-write the catalogue
--          through this definer function, although products' own RLS refuses
--          them a single insert. The owner still always passes (staff_can
--          returns true for the owner), and so does every staff member with
--          `products`, exactly the people the product form lets in.
--        * NAME FALLBACK. A row with no code (sku) now updates the product with
--          the SAME name (trimmed, case-insensitive) when exactly one product
--          of the store has it. Two products sharing the name is ambiguous and
--          the row is refused ('name_ambiguous') — the whole file is, as with
--          every other row error, before anything is written. Before this a
--          code-less re-upload duplicated every row.
--        * The result reports how many rows were matched by name
--          ('matched_by_name'), so the screen can say so.
--        Everything else — two passes, all-or-nothing, blank cells leave a
--        field alone, cost stays NULL when absent (0222) — is unchanged.
--
--   2. import_rules() — a constant the app asks before offering the import:
--      "is 0311 in?". Before this migration the call fails, and the app then
--      keeps the old rules (products on Pro only, no name fallback) rather than
--      promising what the database would refuse. Invoker, no table access.
--
-- NOTHING ELSE: customers and opening balances are imported by the app under
-- the caller's own RLS (store_customers, staff_can 'customers') and through
-- record_customer_transaction (0307). The quick-action panel only reads, under
-- RLS, through queries and functions that already exist.
--
-- SAFE AGAINST THE DEPLOYED CODE: the only caller of import_products is the
-- import screen, which already handles every result shape here; the new key
-- in the result is extra. Idempotent: create or replace + explicit grants.

-- ---------------------------------------------------------------------------
-- 1. import_products
-- ---------------------------------------------------------------------------
create or replace function public.import_products(
  p_store_id uuid,
  p_rows jsonb,
  p_filename text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row jsonb;
  v_idx int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_name text; v_sku text; v_section text;
  v_price numeric;
  v_will_add int := 0;
  v_limit int; v_existing int;
  v_new int := 0; v_upd int := 0; v_by_name int := 0;
  v_matches int;
  v_section_id uuid; v_pid uuid; v_import_id uuid;
begin
  if p_store_id is null or not public.staff_can(p_store_id, 'products') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows must be a json array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'too many rows' using errcode = '22023';
  end if;

  -- ---- pass 1: validate, and measure what will be NEW ----
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_name := nullif(btrim(coalesce(v_row->>'name', '')), '');
    v_sku  := nullif(btrim(coalesce(v_row->>'sku', '')), '');
    v_price := public.parse_numeric_cell(v_row->>'price');

    if v_name is null then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'code', 'name_required');
      continue;
    end if;
    if v_price is null or v_price < 0 then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'code', 'price_invalid');
      continue;
    end if;
    if btrim(coalesce(v_row->>'cost', '')) <> ''
       and public.parse_numeric_cell(v_row->>'cost') is null then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'code', 'cost_invalid');
      continue;
    end if;
    if btrim(coalesce(v_row->>'discount_price', '')) <> ''
       and public.parse_numeric_cell(v_row->>'discount_price') is null then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'code', 'discount_invalid');
      continue;
    end if;
    if btrim(coalesce(v_row->>'stock', '')) <> ''
       and public.parse_numeric_cell(v_row->>'stock') is null then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'code', 'stock_invalid');
      continue;
    end if;

    if v_sku is not null then
      if not exists (
           select 1 from public.products
           where store_id = p_store_id and lower(sku) = lower(v_sku)
             and deleted_at is null) then
        v_will_add := v_will_add + 1;
      end if;
    else
      select count(*) into v_matches from public.products
       where store_id = p_store_id and deleted_at is null
         and lower(btrim(name)) = lower(v_name);
      if v_matches > 1 then
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'code', 'name_ambiguous');
        continue;
      elsif v_matches = 0 then
        v_will_add := v_will_add + 1;
      end if;
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'code', 'rows_invalid',
      'errors', v_errors, 'created', 0, 'updated', 0);
  end if;

  -- ---- the cap, once, with real numbers ----
  v_limit := public.store_product_limit(p_store_id);
  select count(*) into v_existing from public.products
   where store_id = p_store_id and deleted_at is null;

  if v_existing + v_will_add > v_limit then
    return jsonb_build_object('ok', false, 'code', 'plan_limit',
      'existing', v_existing, 'adding', v_will_add, 'limit', v_limit,
      'created', 0, 'updated', 0);
  end if;

  -- ---- pass 2: write ----
  v_idx := 0;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    v_name := btrim(v_row->>'name');
    v_sku  := nullif(btrim(coalesce(v_row->>'sku', '')), '');
    v_price := public.parse_numeric_cell(v_row->>'price');
    v_section := nullif(btrim(coalesce(v_row->>'section', '')), '');

    v_section_id := null;
    if v_section is not null then
      select id into v_section_id from public.store_sections
       where store_id = p_store_id and lower(name) = lower(v_section)
       limit 1;
      if v_section_id is null then
        insert into public.store_sections (store_id, name)
        values (p_store_id, v_section)
        returning id into v_section_id;
      end if;
    end if;

    v_pid := null;
    if v_sku is not null then
      select id into v_pid from public.products
       where store_id = p_store_id and lower(sku) = lower(v_sku)
         and deleted_at is null
       limit 1;
    else
      -- Exactly one product with this name (pass 1 refused two or more). A
      -- product created earlier in THIS file counts too, so a code-less name
      -- repeated in one file updates the row it just created instead of
      -- creating a twin.
      select id into v_pid from public.products
       where store_id = p_store_id and deleted_at is null
         and lower(btrim(name)) = lower(v_name)
       order by created_at
       limit 1;
      if v_pid is not null then
        v_by_name := v_by_name + 1;
      end if;
    end if;

    if v_pid is null then
      insert into public.products (
        store_id, sku, name, name_en, description, description_en,
        price, discount_price, cost, stock, brand, image_url, section_id
      ) values (
        p_store_id, v_sku, v_name,
        nullif(btrim(coalesce(v_row->>'name_en', '')), ''),
        nullif(btrim(coalesce(v_row->>'description', '')), ''),
        nullif(btrim(coalesce(v_row->>'description_en', '')), ''),
        v_price,
        public.parse_numeric_cell(v_row->>'discount_price'),
        public.parse_numeric_cell(v_row->>'cost'),
        public.parse_numeric_cell(v_row->>'stock')::integer,
        nullif(btrim(coalesce(v_row->>'brand', '')), ''),
        nullif(btrim(coalesce(v_row->>'image_url', '')), ''),
        v_section_id
      );
      v_new := v_new + 1;
    else
      -- A blank cell means "leave it alone", not "erase it".
      update public.products set
        name           = v_name,
        name_en        = coalesce(nullif(btrim(coalesce(v_row->>'name_en', '')), ''), name_en),
        description    = coalesce(nullif(btrim(coalesce(v_row->>'description', '')), ''), description),
        description_en = coalesce(nullif(btrim(coalesce(v_row->>'description_en', '')), ''), description_en),
        price          = v_price,
        discount_price = coalesce(public.parse_numeric_cell(v_row->>'discount_price'), discount_price),
        cost           = coalesce(public.parse_numeric_cell(v_row->>'cost'), cost),
        stock          = coalesce(public.parse_numeric_cell(v_row->>'stock')::integer, stock),
        brand          = coalesce(nullif(btrim(coalesce(v_row->>'brand', '')), ''), brand),
        image_url      = coalesce(nullif(btrim(coalesce(v_row->>'image_url', '')), ''), image_url),
        section_id     = coalesce(v_section_id, section_id),
        updated_at     = now()
      where id = v_pid;
      v_upd := v_upd + 1;
    end if;
  end loop;

  insert into public.product_imports
    (store_id, filename, rows_total, created_count, updated_count, created_by)
  values (p_store_id, p_filename, v_idx, v_new, v_upd, auth.uid())
  returning id into v_import_id;

  return jsonb_build_object('ok', true, 'import_id', v_import_id,
    'rows', v_idx, 'created', v_new, 'updated', v_upd,
    'matched_by_name', v_by_name);
end
$function$;

comment on function public.import_products(uuid, jsonb, text) is
  'Bulk product import, every plan (0311). Staff need the products permission. Validates every row before writing any, then imports in one transaction. A row with a code updates the product with that code; a row without one updates the single product with the same name (refused when two share it); the rest are created and counted against the plan''s product cap.';

revoke all on function public.import_products(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.import_products(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. import_rules — "is 0311 in?"
-- ---------------------------------------------------------------------------
create or replace function public.import_rules()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object('version', 2, 'all_tiers', true, 'name_match', true);
$function$;

comment on function public.import_rules() is
  'Constant: which import rules the database enforces (0311). The app asks before offering the import, so it never promises what an older database would refuse.';

revoke all on function public.import_rules() from public, anon, authenticated;
grant execute on function public.import_rules() to authenticated;
