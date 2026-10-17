-- 0334: money and marketing rules the UI promised but the database didn't keep.
--
-- From the merchant re-audit (2026-10-17):
--   * Coupons are owner-only in the nav and the page, but RLS let ANY staff row
--     insert/update/delete them, and nothing stopped a 500% "percent" coupon
--     (the >100 guard was client-side only). Writes are now owner-only and the
--     table has a CHECK (all existing coupons satisfy it).
--   * send_store_campaign checked only can_manage_store — no staff permission, no
--     plan — so any staffer, or a free store, could push to up to 5,000 people
--     by calling the RPC directly, with any external link. It now needs the
--     orders permission, the Business plan (trial included, via
--     store_effective_plan) and a link on this site.
--   * The campaign screen read `follows` directly; RLS shows a user only their
--     own follow rows, so the audience always read 0 while the sender reached
--     everyone. store_audience_counts() returns the six segment sizes with the
--     sender's own SQL.
--   * store_memberships / course_enrollments (names + phones) were readable by
--     any staff row; now the customers permission, like the CRM (0325).

-- ── Coupons ─────────────────────────────────────────────────────────────────
alter table public.coupons
  add constraint coupons_value_range
  check (value >= 0 and (type <> 'percent' or value <= 100));

drop policy if exists coupons_insert on public.coupons;
create policy coupons_insert on public.coupons
  for insert with check (public.is_store_owner(store_id));
drop policy if exists coupons_update on public.coupons;
create policy coupons_update on public.coupons
  for update using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));
drop policy if exists coupons_delete on public.coupons;
create policy coupons_delete on public.coupons
  for delete using (public.is_store_owner(store_id));

-- ── Campaigns ───────────────────────────────────────────────────────────────
do $mig$
declare def text; old_t text; new_t text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'send_store_campaign';
  old_t := $o$  if not public.can_manage_store(p_store_id) then
    raise exception 'not_authorized';
  end if;$o$;
  new_t := $n$  -- 0334: the screen's rules, kept by the database too.
  if not public.staff_can(p_store_id, 'orders') then
    raise exception 'not_authorized';
  end if;
  if coalesce(public.store_effective_plan(p_store_id), 'free') <> 'business' then
    raise exception 'plan_required';
  end if;
  -- A campaign links into this site only: a relative path, or matjarlb.com.
  if v_url is not null
     and not ((v_url like '/%' and v_url not like '//%')
              or v_url like 'https://matjarlb.com/%'
              or v_url = 'https://matjarlb.com') then
    raise exception 'bad_url';
  end if;$n$;
  if position(old_t in def) = 0 then
    raise exception 'send_store_campaign: authorisation check not found';
  end if;
  execute replace(def, old_t, new_t);
end
$mig$;

create or replace function public.store_audience_counts(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  -- Same segments, same SQL as send_store_campaign's recipients.
  with cust as (
    select o.customer_id as uid, count(*) as cnt, max(o.created_at) as last_at
      from public.orders o
     where o.store_id = p_store_id and o.customer_id is not null
     group by o.customer_id
  ),
  fol as (
    select f.user_id as uid from public.follows f where f.store_id = p_store_id
  )
  select case when public.staff_can(p_store_id, 'orders') then
    jsonb_build_object(
      'followers', (select count(*) from fol),
      'customers', (select count(*) from cust),
      'all',       (select count(*) from (select uid from fol union select uid from cust) u),
      'repeat',    (select count(*) from cust where cnt >= 2),
      'vip',       (select count(*) from cust where cnt >= 3),
      'inactive',  (select count(*) from cust where last_at < now() - interval '60 days'))
  else null end;
$function$;

revoke all on function public.store_audience_counts(uuid) from public, anon;
grant execute on function public.store_audience_counts(uuid) to authenticated;

-- ── Members / enrolments: customers permission ──────────────────────────────
drop policy if exists memberships_select on public.store_memberships;
create policy memberships_select on public.store_memberships
  for select using (public.staff_can(store_id, 'customers') or customer_id = (select auth.uid()));
drop policy if exists enrollments_select on public.course_enrollments;
create policy enrollments_select on public.course_enrollments
  for select using (public.staff_can(store_id, 'customers') or customer_id = (select auth.uid()));
