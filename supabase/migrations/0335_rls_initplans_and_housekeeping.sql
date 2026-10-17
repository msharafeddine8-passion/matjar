-- 0335: row-security helpers run once per query, not once per row; housekeeping.
--
-- From the technical health audit (2026-10-17): 137 of 328 policies call
-- is_super_admin(), user_is_active() or admin_can('<constant>') bare. Postgres
-- then evaluates them for EVERY row the policy checks — profiles showed 13.7M
-- sequential scans, and an anon `select store_id from store_sections` cost 7 ms
-- for 14 rows. Wrapped in a scalar subquery, (select f()), the planner runs each
-- once per statement as an InitPlan (Supabase's documented RLS guidance). None
-- of these take a column argument, so the result is identical; only the cost
-- changes.
--
-- Also: indexes on the 9 foreign keys that had none, and a daily purge of
-- cron.job_run_details (11,483 rows and growing, never cleaned).

do $mig$
declare
  r record;
  re constant text := '(?<!SELECT )(is_super_admin\(\)|user_is_active\(\)|admin_can\(''[a-z_]+''::text\))';
  q text; w text; stmt text; n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname in ('public', 'storage')
       and coalesce(qual, '') || coalesce(with_check, '') ~ re
  loop
    q := case when r.qual is null then null
              else regexp_replace(r.qual, re, '(SELECT \1)', 'g') end;
    w := case when r.with_check is null then null
              else regexp_replace(r.with_check, re, '(SELECT \1)', 'g') end;
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if q is not null then stmt := stmt || format(' using (%s)', q); end if;
    if w is not null then stmt := stmt || format(' with check (%s)', w); end if;
    execute stmt;
    n := n + 1;
  end loop;
  raise notice '0335: rewrote % policies', n;
end
$mig$;

-- Foreign keys without a supporting index (FK checks on delete and joins).
do $mig$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
      from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[])
  loop
    execute format('create index if not exists %I on %s (%s)',
                   left(r.conname, 55) || '_idx', r.tbl, r.cols);
  end loop;
end
$mig$;

-- Keep a week of cron history.
select cron.schedule('matjar-purge-cron-history', '15 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
