-- ============================================================================
-- 0311_import_quickpanel.test.sql — rolled-back verification of migration 0311
-- ============================================================================
-- WHAT IT IS
--   The test migration 0311 must pass BEFORE it is applied to production. One
--   transaction:
--
--     begin;
--       <the full text of supabase/migrations/0311_import_quickpanel.sql, verbatim>
--       <fixtures: two stores (A on the FREE plan with an expired trial, so its
--        cap really is 3; B on Pro), two owners, two staff of A, products>
--       <every assertion, acting as owner A, a staff member WITH the products
--        permission, a staff member WITHOUT it (customers + bookings), store
--        B's owner, and anon>
--       select * from r;          -- ONE result set: every check, ok or not
--     rollback;
--
--   Nothing survives the rollback: not the migration, not the fixtures, not
--   the products the imports create. It is written to be run against
--   production by the owner (Supabase MCP execute_sql, the SQL editor, or
--   supabase db execute). It has NOT been run yet; see
--   audit/zero-sub/F6-import-quickpanel.md.
--
--   The migration section is a verbatim copy of the migration file. If 0311 is
--   edited, paste the new text between the two MIGRATION markers so the test
--   exercises what will actually be applied. Every statement in 0311 is
--   idempotent, so after the apply this doubles as a regression test.
--
-- HOW TO READ IT
--   One row per check: ok true/false and got, the value or error actually
--   observed. The last row, ALL CHECKS, says how many failed.
--
-- RULE THIS FOLLOWS (supabase-verify): seed first as postgres, then act AS the
-- role; every refusal is paired with a positive control from an actor who must
-- succeed; each expected refusal runs in its own exception block so one
-- refusal cannot poison the checks after it.
-- ============================================================================

begin;

-- ======================== MIGRATION 0311 (verbatim) =========================
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

-- ====================== END MIGRATION 0311 (verbatim) =======================

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner_a        uuid := gen_random_uuid();
  v_owner_b        uuid := gen_random_uuid();
  v_staff_products uuid := gen_random_uuid();   -- store A staff: products = true
  v_staff_other    uuid := gen_random_uuid();   -- store A staff: customers + bookings, NOT products
  v_store_a        uuid;
  v_store_b        uuid;
  v_mug            uuid;
  v_pen            uuid;
  v_res            jsonb;
  v_n              int;
  v_num            numeric;
  v_txt            text;
  res              jsonb := '[]'::jsonb;
begin
  -- ==========================================================================
  -- FIXTURES (as postgres, which bypasses RLS)
  -- ==========================================================================
  insert into auth.users (id) values (v_owner_a), (v_owner_b), (v_staff_products), (v_staff_other);
  insert into public.profiles (id, full_name) values
    (v_owner_a, '0311 Owner A'), (v_owner_b, '0311 Owner B'),
    (v_staff_products, '0311 Staff products'), (v_staff_other, '0311 Staff other')
  on conflict (id) do nothing;

  -- Store A: FREE, with a trial that already ended — so the cap in force is
  -- the free one (3), and "import works on the free plan" is really tested.
  -- (grant_store_trial only fills trial_ends_at when it is null.)
  insert into public.stores (owner_id, name, status, plan, trial_ends_at)
    values (v_owner_a, '0311 Import Store A', 'active', 'free', now() - interval '1 day')
    returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_b, '0311 Import Store B', 'active', 'pro')
    returning id into v_store_b;

  insert into public.store_staff (store_id, user_id, role, permissions) values
    (v_store_a, v_staff_products, 'staff',
     '{"orders":false,"products":true,"bookings":false,"customers":false}'::jsonb),
    (v_store_a, v_staff_other, 'staff',
     '{"orders":true,"products":false,"bookings":true,"customers":true}'::jsonb);

  insert into public.products (store_id, name, price, description)
    values (v_store_a, 'Mug', 5, 'a mug') returning id into v_mug;              -- no code
  insert into public.products (store_id, sku, name, price, description)
    values (v_store_a, 'PEN-1', 'Pen', 1, 'keep me') returning id into v_pen;
  insert into public.products (store_id, name, price) values
    (v_store_b, 'Cup', 3), (v_store_b, 'cup ', 4), (v_store_b, 'Bowl', 6);    -- two share "cup"

  -- ==========================================================================
  -- CATALOG
  -- ==========================================================================
  res := res || jsonb_build_array(jsonb_build_object('check', 'import_products is SECURITY DEFINER with search_path pinned to empty',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.import_products(uuid,jsonb,text)'::regprocedure
                  and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=""', 'search_path=''''')),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'anon may NOT execute import_products; authenticated may',
    'ok', not has_function_privilege('anon', 'public.import_products(uuid,jsonb,text)', 'execute')
      and has_function_privilege('authenticated', 'public.import_products(uuid,jsonb,text)', 'execute'),
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'import_rules: invoker; anon may NOT execute it, authenticated may',
    'ok', exists (select 1 from pg_proc p where p.oid = 'public.import_rules()'::regprocedure and not p.prosecdef)
      and not has_function_privilege('anon', 'public.import_rules()', 'execute')
      and has_function_privilege('authenticated', 'public.import_rules()', 'execute'),
    'got', 'checked'));
  select pg_get_functiondef('public.import_products(uuid,jsonb,text)'::regprocedure) into v_txt;
  res := res || jsonb_build_array(jsonb_build_object('check', 'the Pro plan gate is gone from import_products (the product cap is not)',
    'ok', v_txt not ilike '%store_has_plan%' and v_txt ilike '%store_product_limit%',
    'got', 'checked'));
  res := res || jsonb_build_array(jsonb_build_object('check', 'fixture: store A is effectively FREE with a cap of 3',
    'ok', public.store_effective_plan(v_store_a) = 'free' and public.store_product_limit(v_store_a) = 3,
    'got', public.store_effective_plan(v_store_a) || ' / ' || public.store_product_limit(v_store_a)::text));

  -- ==========================================================================
  -- OWNER A (free plan)
  -- ==========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    v_res := public.import_rules();
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A reads import_rules() = version 2, all tiers, name match',
      'ok', (v_res ->> 'version')::int = 2 and (v_res ->> 'all_tiers')::boolean and (v_res ->> 'name_match')::boolean,
      'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner A reads import_rules()', 'ok', false, 'got', sqlerrm));
  end;

  begin
    v_res := public.import_products(v_store_a, '[{"name":"  mug ","price":"7"}]'::jsonb, 'a.xlsx');
    select price into v_num from public.products where id = v_mug;
    res := res || jsonb_build_array(jsonb_build_object('check', 'FREE store imports; a row with no code updates the one product with that name',
      'ok', (v_res ->> 'ok')::boolean and (v_res ->> 'created')::int = 0 and (v_res ->> 'updated')::int = 1
        and (v_res ->> 'matched_by_name')::int = 1 and v_num = 7,
      'got', v_res::text || ' / price ' || coalesce(v_num::text, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'FREE store imports (name match)', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    v_res := public.import_products(v_store_a, '[{"sku":"pen-1","name":"Pen","price":"2","description":""}]'::jsonb, 'b.xlsx');
    select description, price into v_txt, v_num from public.products where id = v_pen;
    res := res || jsonb_build_array(jsonb_build_object('check', 'a code updates case-insensitively; a blank cell leaves the field alone',
      'ok', (v_res ->> 'updated')::int = 1 and (v_res ->> 'matched_by_name')::int = 0 and v_txt = 'keep me' and v_num = 2,
      'got', v_res::text || ' / ' || coalesce(v_txt, 'null')));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'code update', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    v_res := public.import_products(v_store_a,
      '[{"name":"Plate","price":"3"},{"name":"Bowl","price":"4"}]'::jsonb, 'c.xlsx');
    select count(*) into v_n from public.products where store_id = v_store_a and deleted_at is null;
    res := res || jsonb_build_array(jsonb_build_object('check', 'the FREE cap still holds: 2 existing + 2 new > 3 is refused with the real numbers, nothing written',
      'ok', v_res ->> 'code' = 'plan_limit' and (v_res ->> 'existing')::int = 2 and (v_res ->> 'adding')::int = 2
        and (v_res ->> 'limit')::int = 3 and v_n = 2,
      'got', v_res::text || ' / count ' || v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'free cap', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    v_res := public.import_products(v_store_a, '[{"name":"Plate","price":"3"}]'::jsonb, 'd.xlsx');
    select count(*) into v_n from public.products where store_id = v_store_a and deleted_at is null;
    select cost into v_num from public.products where store_id = v_store_a and name = 'Plate';
    res := res || jsonb_build_array(jsonb_build_object('check', 'FREE store creates a product within its cap; an absent cost stays NULL',
      'ok', (v_res ->> 'created')::int = 1 and v_n = 3 and v_num is null,
      'got', v_res::text || ' / count ' || v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'free create', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    v_res := public.import_products(v_store_a, '[{"name":"X","price":"abc"}]'::jsonb, 'e.xlsx');
    res := res || jsonb_build_array(jsonb_build_object('check', 'a bad price is reported per row, nothing written',
      'ok', v_res ->> 'code' = 'rows_invalid' and v_res -> 'errors' -> 0 ->> 'code' = 'price_invalid',
      'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'bad price', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    v_res := public.import_products(v_store_a, '{"name":"X"}'::jsonb, 'f.xlsx');
    res := res || jsonb_build_array(jsonb_build_object('check', 'rows that are not an array are refused', 'ok', false, 'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'rows that are not an array are refused', 'ok', sqlstate = '22023', 'got', sqlstate || ' ' || sqlerrm));
  end;

  select count(*) into v_n from public.product_imports
   where store_id = v_store_a and created_by = v_owner_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'each successful import is logged once, stamped with the caller (3)',
    'ok', v_n = 3, 'got', v_n::text));

  -- ==========================================================================
  -- STAFF of A WITH products
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_products, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    v_res := public.import_products(v_store_a, '[{"sku":"PEN-1","name":"Pen","price":"2.5"}]'::jsonb, 'g.xlsx');
    select price into v_num from public.products where id = v_pen;
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITH products imports into store A',
      'ok', (v_res ->> 'updated')::int = 1 and v_num = 2.5, 'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITH products imports into store A', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  -- STAFF of A WITHOUT products (customers + bookings + orders)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_other, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    v_res := public.import_products(v_store_a, '[{"sku":"PEN-1","name":"Pen","price":"99"}]'::jsonb, 'h.xlsx');
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT products cannot import (can_manage_store no longer enough)', 'ok', false, 'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'staff WITHOUT products cannot import (can_manage_store no longer enough)', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  -- OWNER B (Pro, another store)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    v_res := public.import_products(v_store_a, '[{"sku":"PEN-1","name":"Pen","price":"99"}]'::jsonb, 'i.xlsx');
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot import into store A', 'ok', false, 'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B cannot import into store A', 'ok', sqlstate = '42501', 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    v_res := public.import_products(v_store_b, '[{"name":"CUP","price":"1"}]'::jsonb, 'j.xlsx');
    select count(*) into v_n from public.products where store_id = v_store_b and price = 1;
    res := res || jsonb_build_array(jsonb_build_object('check', 'a name two products share is refused (name_ambiguous), nothing written',
      'ok', v_res ->> 'code' = 'rows_invalid' and v_res -> 'errors' -> 0 ->> 'code' = 'name_ambiguous' and v_n = 0,
      'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'name_ambiguous', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  begin
    v_res := public.import_products(v_store_b,
      '[{"name":"bowl","price":"9"},{"name":"Fork","price":"1"},{"name":"fork","price":"2"}]'::jsonb, 'k.xlsx');
    select count(*), max(price) into v_n, v_num from public.products where store_id = v_store_b and lower(name) = 'fork';
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B: name match updates Bowl; a code-less name twice in one file makes ONE product, not twins',
      'ok', (v_res ->> 'matched_by_name')::int = 2 and (v_res ->> 'created')::int = 1 and (v_res ->> 'updated')::int = 2
        and v_n = 1 and v_num = 2,
      'got', v_res::text || ' / forks ' || v_n::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'owner B name match', 'ok', false, 'got', sqlstate || ' ' || sqlerrm));
  end;

  select count(*) into v_n from public.product_imports where store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'owner B reads 0 of store A''s import log', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- ANON
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    v_res := public.import_products(v_store_a, '[{"name":"Anon","price":"1"}]'::jsonb, 'anon.xlsx');
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call import_products', 'ok', false, 'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call import_products', 'ok', true, 'got', sqlstate || ' ' || sqlerrm));
  end;
  begin
    v_res := public.import_rules();
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call import_rules', 'ok', false, 'got', v_res::text));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon cannot call import_rules', 'ok', true, 'got', sqlstate || ' ' || sqlerrm));
  end;

  -- ==========================================================================
  execute 'reset role';
  select count(*) into v_n from public.products where store_id = v_store_a and name = 'Anon';
  res := res || jsonb_build_array(jsonb_build_object('check', 'nothing anon sent reached store A', 'ok', v_n = 0, 'got', v_n::text));

  insert into r (n, check_name, ok, got)
  select x.i::int, x.e ->> 'check', coalesce((x.e ->> 'ok')::boolean, false), x.e ->> 'got'
  from jsonb_array_elements(res) with ordinality as x(e, i);
  insert into r (n, check_name, ok, got)
  select 999, 'ALL CHECKS', bool_and(ok), count(*) filter (where not ok)::text || ' failed of ' || count(*)::text
  from r;
end
$test$;

select n, check_name, ok, got from r order by n;

rollback;
