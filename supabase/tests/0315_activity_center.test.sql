-- ============================================================================
-- 0315_activity_center.test.sql — rolled-back verification of migration 0315
-- ============================================================================
-- WHAT IT IS
--   One transaction:
--
--     begin;
--       <the full text of supabase/migrations/0315_activity_center.sql, verbatim>
--       <fixtures: two stores, two owners, one staff member with `orders`,
--        two customers, three leads (customer A's, customer B's, a guest's)>
--       <assertions acting as customer A, customer B, the staff member,
--        store B's owner and anon>
--       select * from r;          -- ONE result set: every check, ok or not
--     rollback;
--
--   Nothing survives the rollback. It has NOT been run yet — the activity
--   centre agent was told not to touch the production database. Run it
--   (Supabase MCP execute_sql or the SQL editor), read ALL CHECKS, and only
--   then apply the migration. Every statement in 0315 is idempotent, so after
--   the apply this doubles as a regression test.
--
-- RULE THIS FOLLOWS (supabase-verify): seed as postgres, read AS the role;
-- every "sees 0" is paired with a positive control from an actor who must see
-- that row; each expected refusal is in its own exception block.
-- ============================================================================

begin;

-- ======================== MIGRATION 0315 (verbatim) =========================
-- 0315 — a customer can read the inquiries they sent.
--
-- WHY. create_lead() (0190) writes a lead with customer_id = the signed-in
-- customer, and the customer screens read it back: the activity centre
-- (/activity, «طلباتي») lists it and /inquiries/[id] shows it with the shop's
-- phone and WhatsApp. But the only SELECT policy on public.leads is
-- leads_select_store (0190, re-scoped to staff_can(store_id, 'orders') in
-- 0198). No policy ever let the customer read their own row, so for every
-- customer who is not also staff of that store:
--   * the inquiries tab of the activity centre is always empty, and
--   * /inquiries/<their own lead id> is a 404.
-- Checked on production 2026-09-28: pg_policies on leads = leads_select_store
-- (SELECT) + leads_update_store (UPDATE), nothing else; 3 leads carry a
-- customer_id.
--
-- WHAT. One permissive SELECT policy for `authenticated`: a row whose
-- customer_id is the caller. Nothing else changes:
--   * no INSERT policy — leads are still written only by create_lead()
--     (security definer);
--   * no UPDATE/DELETE for the customer — leads_update_store stays staff-only;
--   * anon gets nothing (the policy is `to authenticated`, and a guest lead has
--     customer_id null, which never equals auth.uid());
--   * store staff keep exactly what leads_select_store gave them (policies are
--     OR-ed; this one adds rows only for the row's own customer).
--
-- COLUMNS. The customer can read every column of their own row, including
-- assigned_to (the uuid of the staff member handling it) and
-- last_contacted_at. Both describe the customer's own inquiry; assigned_to is
-- an opaque id, not a name or a contact. The app selects neither on the
-- customer side. A column-level revoke is not used because `authenticated` is
-- also the merchant's role and the merchant inbox reads assigned_to.
--
-- Idempotent: safe to re-run.

drop policy if exists leads_select_own on public.leads;
create policy leads_select_own on public.leads
  for select
  to authenticated
  using (customer_id = (select auth.uid()));

comment on policy leads_select_own on public.leads is
  'The customer who sent an inquiry can read it (activity centre, /inquiries/[id]). Read only; writes stay with create_lead() and store staff.';
-- ====================== END MIGRATION 0315 (verbatim) =======================

create temp table r (n int, check_name text, ok boolean, got text) on commit drop;

do $test$
declare
  v_owner_a  uuid := gen_random_uuid();
  v_owner_b  uuid := gen_random_uuid();
  v_staff    uuid := gen_random_uuid();   -- store A staff: orders = true
  v_cust_a   uuid := gen_random_uuid();
  v_cust_b   uuid := gen_random_uuid();
  v_store_a  uuid;
  v_store_b  uuid;
  v_lead_a   uuid;
  v_lead_b   uuid;
  v_lead_g   uuid;                        -- a guest's lead, customer_id null
  v_n        int;
  v_txt      text;
  res        jsonb := '[]'::jsonb;
begin
  -- ==========================================================================
  -- FIXTURES (as postgres, which bypasses RLS)
  -- ==========================================================================
  insert into auth.users (id) values (v_owner_a), (v_owner_b), (v_staff), (v_cust_a), (v_cust_b);
  insert into public.profiles (id, full_name) values
    (v_owner_a, '0315 Owner A'), (v_owner_b, '0315 Owner B'), (v_staff, '0315 Staff'),
    (v_cust_a, '0315 Customer A'), (v_cust_b, '0315 Customer B')
  on conflict (id) do nothing;

  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_a, '0315 Store A', 'active', 'free') returning id into v_store_a;
  insert into public.stores (owner_id, name, status, plan)
    values (v_owner_b, '0315 Store B', 'active', 'free') returning id into v_store_b;

  insert into public.store_staff (store_id, user_id, role, permissions) values
    (v_store_a, v_staff, 'staff',
     '{"orders":true,"products":false,"bookings":false,"customers":false}'::jsonb);

  insert into public.leads (store_id, customer_id, kind, name, phone, message)
    values (v_store_a, v_cust_a, 'viewing', '0315 A', '70000001', 'A asks')
    returning id into v_lead_a;
  insert into public.leads (store_id, customer_id, kind, name, phone, message)
    values (v_store_a, v_cust_b, 'contact', '0315 B', '70000002', 'B asks')
    returning id into v_lead_b;
  insert into public.leads (store_id, customer_id, kind, name, phone, message)
    values (v_store_a, null, 'contact', '0315 Guest', '70000003', 'guest asks')
    returning id into v_lead_g;

  -- ==========================================================================
  -- Policy shape
  -- ==========================================================================
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_select_own'
     and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}';
  res := res || jsonb_build_array(jsonb_build_object('check', 'leads_select_own exists: permissive SELECT to authenticated only', 'ok', v_n = 1, 'got', v_n::text));

  select string_agg(policyname || ':' || cmd, ',' order by policyname) into v_txt from pg_policies
   where schemaname = 'public' and tablename = 'leads';
  res := res || jsonb_build_array(jsonb_build_object('check', 'no insert/delete policy was added',
    'ok', v_txt = 'leads_select_own:SELECT,leads_select_store:SELECT,leads_update_store:UPDATE', 'got', v_txt));

  -- ==========================================================================
  -- CUSTOMER A
  -- ==========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.leads where id = v_lead_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer A reads their own lead', 'ok', v_n = 1, 'got', v_n::text));

  select count(*) into v_n from public.leads;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer A sees exactly one lead in the whole table', 'ok', v_n = 1, 'got', v_n::text));

  select count(*) into v_n from public.leads where id = v_lead_b;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer A cannot read customer B''s lead', 'ok', v_n = 0, 'got', v_n::text));

  select count(*) into v_n from public.leads where id = v_lead_g;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer A cannot read a guest lead (customer_id null)', 'ok', v_n = 0, 'got', v_n::text));

  -- The activity centre query, embed included.
  select s.name into v_txt from public.leads l join public.stores s on s.id = l.store_id
   where l.customer_id = v_cust_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer A''s activity read resolves the store name', 'ok', v_txt = '0315 Store A', 'got', coalesce(v_txt, 'null')));

  begin
    update public.leads set status = 'won', message = 'tampered' where id = v_lead_a;
    get diagnostics v_n = row_count;
    res := res || jsonb_build_array(jsonb_build_object('check', 'customer A cannot update their own lead', 'ok', v_n = 0, 'got', v_n::text || ' rows'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'customer A cannot update their own lead', 'ok', true, 'got', sqlerrm));
  end;

  begin
    delete from public.leads where id = v_lead_a;
    get diagnostics v_n = row_count;
    res := res || jsonb_build_array(jsonb_build_object('check', 'customer A cannot delete their own lead', 'ok', v_n = 0, 'got', v_n::text || ' rows'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'customer A cannot delete their own lead', 'ok', true, 'got', sqlerrm));
  end;

  begin
    insert into public.leads (store_id, customer_id, name, phone) values (v_store_a, v_cust_a, 'x', '1');
    res := res || jsonb_build_array(jsonb_build_object('check', 'customer A cannot insert a lead directly', 'ok', false, 'got', 'accepted'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'customer A cannot insert a lead directly', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  -- CUSTOMER B (positive control for A's refusal)
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_b, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.leads where id = v_lead_b;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer B reads their own lead', 'ok', v_n = 1, 'got', v_n::text));
  select count(*) into v_n from public.leads where id = v_lead_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'customer B cannot read customer A''s lead', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- STORE A STAFF (orders): unchanged — all three of the store's leads
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.leads where store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'store A staff still reads all 3 store leads (incl. the guest one)', 'ok', v_n = 3, 'got', v_n::text));

  update public.leads set status = 'contacted' where id = v_lead_a;
  get diagnostics v_n = row_count;
  res := res || jsonb_build_array(jsonb_build_object('check', 'store A staff can still update a lead', 'ok', v_n = 1, 'got', v_n::text));

  -- ==========================================================================
  -- STORE B OWNER: nothing of store A
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.leads where store_id = v_store_a;
  res := res || jsonb_build_array(jsonb_build_object('check', 'store B owner reads none of store A''s leads', 'ok', v_n = 0, 'got', v_n::text));

  -- ==========================================================================
  -- ANON
  -- ==========================================================================
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into v_n from public.leads;
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon reads no leads', 'ok', v_n = 0, 'got', v_n::text || ' rows'));
  exception when others then
    res := res || jsonb_build_array(jsonb_build_object('check', 'anon reads no leads', 'ok', true, 'got', sqlerrm));
  end;

  -- ==========================================================================
  execute 'reset role';
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
