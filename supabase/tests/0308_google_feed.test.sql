-- ============================================================================
-- 0308 — Google feed columns and guard. Verification, rolled back.
-- ============================================================================
-- Run AFTER 0308 is applied, as one script (SQL editor, or
--   supabase db execute --file supabase/tests/0308_google_feed.test.sql).
-- Everything happens inside begin … rollback, so the fixture edits to a real
-- store never survive. Results go into the temp table `r` and are selected ONCE
-- at the end (NOTICEs do not come back through the MCP / some clients).
--
-- Fixture: one ACTIVE store on pro/business with an owner. An active store is
-- deliberate — on `stores` RLS returns NULL for "cannot see the row" and for
-- "cannot read the column" alike (see 0303), so the anon read must be tested
-- against a row anon is allowed to see.
--
-- Every row in `r` should read ok = true.
-- ============================================================================

begin;

create temp table r (n int, check_name text, ok boolean, detail text) on commit drop;
grant all on r to anon, authenticated;

do $$
declare
  v_store uuid;
  v_owner uuid;
  v_other uuid;
  v_rows int;
  v_err text;
  v_at timestamptz;
  v_on boolean;
  v_owner_claims text;
begin
  select s.id, s.owner_id into v_store, v_owner
  from public.stores s
  where s.status = 'active' and s.deleted_at is null and s.plan in ('pro', 'business')
  order by s.created_at
  limit 1;
  if v_store is null then
    insert into r values (0, 'fixture: an active pro/business store exists', false, 'none found');
    return;
  end if;
  -- Any other real user, to prove a non-owner cannot flip the switch.
  select p.id into v_other from public.profiles p
  where p.id <> v_owner and p.role not in ('super_admin') limit 1;

  v_owner_claims := json_build_object('sub', v_owner, 'role', 'authenticated')::text;

  -- 1. Schema
  insert into r
  select 1, 'columns exist with the declared types/defaults',
         count(*) = 3,
         string_agg(column_name || ':' || data_type || ':' || coalesce(column_default, 'null') || ':' || is_nullable, ', ')
  from information_schema.columns
  where table_schema = 'public' and table_name = 'stores'
    and ((column_name = 'shipping_policy' and data_type = 'text' and is_nullable = 'YES')
      or (column_name = 'google_feed_enabled' and data_type = 'boolean' and column_default = 'false' and is_nullable = 'NO')
      or (column_name = 'google_feed_enabled_at' and data_type = 'timestamp with time zone'));

  -- Start from a known state (trusted path: postgres).
  update public.stores
     set return_policy = null, shipping_policy = null, google_feed_enabled = false
   where id = v_store;

  -- 2. Owner cannot switch on with no policies.
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims', v_owner_claims, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    update public.stores set google_feed_enabled = true where id = v_store;
    v_err := 'no error';
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  insert into r values (2, 'owner blocked without policies', v_err = 'google_feed_requires_policies', v_err);

  -- 3. Owner writes both policies (the existing owner UPDATE path).
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims', v_owner_claims, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  update public.stores
     set return_policy = 'Returns within 3 days if unopened.',
         shipping_policy = 'Delivery across Lebanon in 1-3 days.'
   where id = v_store;
  get diagnostics v_rows = row_count;
  reset role;
  insert into r values (3, 'owner can write both policies', v_rows = 1, v_rows || ' row(s)');

  -- 4. Owner switches on; timestamp is stamped by the trigger, not the client.
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims', v_owner_claims, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    update public.stores
       set google_feed_enabled = true, google_feed_enabled_at = '2000-01-01'
     where id = v_store;
    v_err := 'no error';
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  select google_feed_enabled, google_feed_enabled_at into v_on, v_at from public.stores where id = v_store;
  insert into r values (4, 'owner switches on with both policies; enabled_at is the trigger''s',
    v_err = 'no error' and v_on and v_at > now() - interval '1 minute',
    v_err || ' / on=' || v_on || ' at=' || coalesce(v_at::text, 'null'));

  -- 5. anon (the feed route's client) can read the switch and both policies.
  execute format('set local role %I', 'anon');
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select google_feed_enabled into v_on from public.stores where id = v_store;
  select count(*) into v_rows from public.stores
   where id = v_store and shipping_policy is not null and return_policy is not null;
  reset role;
  insert into r values (5, 'anon reads google_feed_enabled and both policies', v_on is true and v_rows = 1,
    'on=' || coalesce(v_on::text, 'null') || ' rows=' || v_rows);

  -- 6. Switching off clears the timestamp.
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims', v_owner_claims, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  update public.stores set google_feed_enabled = false where id = v_store;
  reset role;
  select google_feed_enabled, google_feed_enabled_at into v_on, v_at from public.stores where id = v_store;
  insert into r values (6, 'switching off clears enabled_at', not v_on and v_at is null,
    'on=' || v_on || ' at=' || coalesce(v_at::text, 'null'));

  -- 7. A store below Pro (no trial) is refused — and cannot sneak past by
  --    claiming plan = 'pro' in the same statement.
  update public.stores set plan = 'free', trial_ends_at = null where id = v_store;  -- trusted path
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims', v_owner_claims, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    update public.stores set google_feed_enabled = true, plan = 'pro' where id = v_store;
    v_err := 'no error';
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  insert into r values (7, 'free store refused, even when claiming plan=pro in the same update',
    v_err = 'google_feed_requires_plan', v_err);

  -- 8. An active trial counts as Pro.
  update public.stores set trial_ends_at = now() + interval '3 days' where id = v_store;  -- trusted path
  execute format('set local role %I', 'authenticated');
  perform set_config('request.jwt.claims', v_owner_claims, true);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  begin
    update public.stores set google_feed_enabled = true where id = v_store;
    v_err := 'no error';
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  insert into r values (8, 'free store on an active trial may switch on', v_err = 'no error', v_err);

  -- 9. A different signed-in user cannot touch the switch (RLS: 0 rows).
  if v_other is not null then
    execute format('set local role %I', 'authenticated');
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_other::text, true);
    update public.stores set google_feed_enabled = false where id = v_store;
    get diagnostics v_rows = row_count;
    reset role;
    insert into r values (9, 'non-owner update touches 0 rows', v_rows = 0, v_rows || ' row(s)');
  else
    insert into r values (9, 'non-owner update touches 0 rows', null, 'no second user to test with');
  end if;

  -- 10. The trigger function states no definer rights and pins search_path.
  insert into r
  select 10, 'guard_google_feed is SECURITY INVOKER with search_path pinned',
         not p.prosecdef and p.proconfig @> array['search_path=""'],
         'secdef=' || p.prosecdef || ' config=' || coalesce(array_to_string(p.proconfig, ','), 'null')
  from pg_proc p
  where p.oid = 'public.guard_google_feed()'::regprocedure;
end
$$;

select * from r order by n;

rollback;
