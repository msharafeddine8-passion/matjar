-- 0306: a search that found nothing can say what it was looking for.
--
-- search_logs (0216) already records THAT a search came back empty — 10 of the
-- last 12 on production did («مطاعم» ×3, «ملابس», «سوق الاحد», «قطة», «فول» …).
-- What it cannot record is the person behind it: where they are, what exactly
-- they meant, and whether they would like to hear back when a shop that sells
-- it joins. That is the difference between a statistic and a merchant-
-- acquisition list.
--
-- This adds:
--   demand_requests       — one row per «ما لقيت يلي بدّك ياه؟ خبّرنا».
--   submit_demand(...)    — the ONLY way in. Validates, normalises, rate-limits.
--   set_demand_status(..) — the admin moves a request new → contacted/fulfilled/dismissed.
--   demand_summary(days)  — zero-result searches and requests side by side,
--                           per normalised term. Admin (section 'growth') only.
--   purge_demand_personal_data() + a daily pg_cron job — retention.
--
-- WHY section 'growth' and not a new one: admin-sections.ts has no demand or
-- insights section, and 'growth' is where merchant acquisition already lives
-- (0150 gives it coupons, campaigns, referrals). Inventing a section would mean
-- a policy naming a permission nobody can be granted — 0216's warning about
-- admin_can('moderation') applies. Super admins pass admin_can() anyway.
--
-- PRIVACY — what is and is not stored:
--   * Contact is OPTIONAL. The form says so and says why (only to tell the
--     person if we find it). Without a contact the row is pure demand signal.
--   * No IP address, no user agent, no device fingerprint. Nothing here that
--     the person did not type, except auth.uid() when they are signed in.
--   * Nobody but an admin with 'growth' can read a row: RLS has no policy for
--     anon, and table privileges for anon are revoked outright. The admin page
--     is the only place a contact is ever rendered.
--   * RETENTION: after 180 days contact, contact_kind, note and user_id are
--     cleared by a daily pg_cron job. The query, section, region and area stay —
--     they are the aggregate signal, and without a contact they identify nobody.
--     pg_cron is already used on this project (0039, 0118, 0120, 0177), so the
--     retention is enforced rather than merely promised.
--
-- ABUSE LIMITS (all rolling windows, checked inside submit_demand):
--   * signed in:            5 requests per user_id per 24h
--   * any contact given:    5 requests per normalised contact per 24h
--   * anonymous, no contact: 3 per identical q_norm + region per 60s
--   * anonymous (any):      30 per 60s platform-wide — a flood guard, so a
--                           script cycling fake contacts still hits a ceiling
-- The counts are not serialised (two concurrent calls can both see 4), so a
-- limit can be overshot by the concurrency of one burst. That is acceptable
-- for a demand form; it is not a money path.
--
-- The limits here are mirrored in src/lib/demand.ts (DEMAND_LIMITS), and
-- src/lib/__tests__/demand.test.ts fails if the two files disagree.

-- ── 1. The table ────────────────────────────────────────────────────────────
create table if not exists public.demand_requests (
  id uuid primary key default gen_random_uuid(),
  q text not null check (char_length(q) between 1 and 120),
  q_norm text,
  section text,
  region text check (region is null or region in
    ('beirut','mountLebanon','north','south','bekaa')),
  area text check (area is null or char_length(area) <= 60),
  contact text check (contact is null or char_length(contact) <= 80),
  contact_kind text check (contact_kind is null or contact_kind in ('phone','whatsapp','email')),
  note text check (note is null or char_length(note) <= 300),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'new'
    check (status in ('new','contacted','fulfilled','dismissed')),
  handled_at timestamptz,
  handled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A kind without a contact (or the reverse) is a half-written row.
  constraint demand_requests_contact_pair
    check ((contact is null) = (contact_kind is null))
);

comment on table public.demand_requests is
  'Zero-result demand: what a visitor looked for and did not find, optionally with a way to reach them. Written only by submit_demand(); read only by admins with the growth section. Contact, note and user_id are cleared after 180 days (purge_demand_personal_data, daily pg_cron).';
comment on column public.demand_requests.contact is
  'Optional, volunteered for one purpose: telling this person when what they asked for is available. Never shown outside /admin/demand. Cleared after 180 days.';

-- Rate-limit lookups, the gap report, the admin queue, and the two FKs.
create index if not exists demand_requests_user_idx
  on public.demand_requests (user_id, created_at desc);
create index if not exists demand_requests_contact_idx
  on public.demand_requests (contact, created_at desc) where contact is not null;
create index if not exists demand_requests_anon_idx
  on public.demand_requests (created_at desc) where user_id is null;
create index if not exists demand_requests_qnorm_idx
  on public.demand_requests (q_norm, created_at desc);
create index if not exists demand_requests_status_idx
  on public.demand_requests (status, created_at desc);
create index if not exists demand_requests_handled_by_idx
  on public.demand_requests (handled_by);

alter table public.demand_requests enable row level security;

-- Supabase grants every table to anon and authenticated by default; RLS would
-- still refuse, but a privilege that was never needed should not exist.
-- Writes go through the SECURITY DEFINER functions below, so neither role
-- needs INSERT/UPDATE/DELETE at all; authenticated keeps SELECT for the admin
-- page, and RLS narrows that to admins.
revoke all on table public.demand_requests from public, anon, authenticated;
grant select on table public.demand_requests to authenticated;

drop policy if exists demand_requests_admin_read on public.demand_requests;
create policy demand_requests_admin_read on public.demand_requests
  for select to authenticated using (public.admin_can('growth'));

-- ── 2. The only way in ──────────────────────────────────────────────────────
create or replace function public.submit_demand(
  p_q text,
  p_section text default null,
  p_region text default null,
  p_area text default null,
  p_contact text default null,
  p_contact_kind text default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := auth.uid();
  v_q text;
  v_norm text;
  v_section text;
  v_region text;
  v_area text;
  v_contact text;
  v_kind text;
  v_note text;
  v_id uuid;
begin
  -- Query: whitespace collapsed, same 120 cap as search_logs.q.
  v_q := btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g'));
  v_norm := public.normalize_search(v_q);
  if v_norm is null or char_length(v_norm) < 2 then
    raise exception 'demand_query_too_short' using errcode = 'P0001';
  end if;
  if char_length(v_q) > 120 then
    raise exception 'demand_query_too_long' using errcode = 'P0001';
  end if;

  -- Section and region are whitelisted and otherwise DROPPED, not refused: a
  -- stale URL parameter must never be why someone's request fails.
  v_section := case when p_section in (
      'search','stores','products','freelance','jobs','market','wholesale',
      'food','retail','services','healthcare','realEstate','automotive',
      'beauty','fitness','sportsCourts','education','events','hospitality',
      'pharmacy','petCare','professional','contractors','farm')
    then p_section else null end;
  v_region := case when p_region in ('beirut','mountLebanon','north','south','bekaa')
    then p_region else null end;

  v_area := nullif(btrim(regexp_replace(coalesce(p_area, ''), '\s+', ' ', 'g')), '');
  if char_length(v_area) > 60 then
    raise exception 'demand_area_too_long' using errcode = 'P0001';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(v_note) > 300 then
    raise exception 'demand_note_too_long' using errcode = 'P0001';
  end if;

  -- Contact: optional. Kind as given, else inferred ('@' → email, else phone).
  v_contact := nullif(btrim(coalesce(p_contact, '')), '');
  if v_contact is not null then
    v_kind := coalesce(nullif(p_contact_kind, ''),
      case when position('@' in v_contact) > 0 then 'email' else 'phone' end);
    if v_kind not in ('phone','whatsapp','email') then
      raise exception 'demand_invalid_contact' using errcode = 'P0001';
    end if;
    if v_kind = 'email' then
      v_contact := lower(v_contact);
      if char_length(v_contact) > 80
         or v_contact !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
        raise exception 'demand_invalid_contact' using errcode = 'P0001';
      end if;
    else
      -- Arabic-Indic and Persian digits first: ٠٣١٢٣٤٥٦ is how a Lebanese
      -- number is typed on an Arabic keyboard.
      v_contact := regexp_replace(
        translate(v_contact, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
        '[[:space:]().-]', '', 'g');
      if left(v_contact, 2) = '00' then
        v_contact := '+' || substr(v_contact, 3);
      end if;
      if char_length(v_contact) > 80 or v_contact !~ '^\+?[0-9]{7,15}$' then
        raise exception 'demand_invalid_contact' using errcode = 'P0001';
      end if;
    end if;
  else
    v_kind := null;
  end if;

  -- Abuse limits. See the header for the reasoning behind each number.
  if v_uid is not null and (
      select count(*) from public.demand_requests d
      where d.user_id = v_uid and d.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'demand_rate_limited' using errcode = 'P0001';
  end if;

  if v_contact is not null and (
      select count(*) from public.demand_requests d
      where d.contact = v_contact and d.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'demand_rate_limited' using errcode = 'P0001';
  end if;

  if v_uid is null then
    if v_contact is null and (
        select count(*) from public.demand_requests d
        where d.user_id is null and d.contact is null
          and d.q_norm = v_norm
          and d.region is not distinct from v_region
          and d.created_at > now() - interval '60 seconds') >= 3 then
      raise exception 'demand_rate_limited' using errcode = 'P0001';
    end if;
    if (select count(*) from public.demand_requests d
        where d.user_id is null
          and d.created_at > now() - interval '60 seconds') >= 30 then
      raise exception 'demand_rate_limited' using errcode = 'P0001';
    end if;
  end if;

  insert into public.demand_requests
    (q, q_norm, section, region, area, contact, contact_kind, note, user_id)
  values
    (v_q, v_norm, v_section, v_region, v_area, v_contact, v_kind, v_note, v_uid)
  returning id into v_id;

  return v_id;
end $function$;

revoke all on function public.submit_demand(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_demand(text, text, text, text, text, text, text)
  to anon, authenticated;

-- ── 3. The admin moves a request along ──────────────────────────────────────
-- Through a function rather than an UPDATE grant so the only column that can
-- change is status, and every change is stamped with who and when.
create or replace function public.set_demand_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = '' as $function$
begin
  if not public.admin_can('growth') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_status not in ('new','contacted','fulfilled','dismissed') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  update public.demand_requests
     set status = p_status,
         handled_at = case when p_status = 'new' then null else now() end,
         handled_by = case when p_status = 'new' then null else auth.uid() end
   where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end $function$;

revoke all on function public.set_demand_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_demand_status(uuid, text) to authenticated;

-- ── 4. Unmet demand, one row per normalised term ────────────────────────────
-- searches  = zero-result searches in search_logs
-- requests  = DISTINCT requesters (user, else contact, else the row itself) in
--             demand_requests, dismissed excluded — so one person pressing the
--             button five times is one request, not five.
-- reachable = distinct contacts left on those requests
-- Ranked by requests (weighted ×3: a person who stopped to type is a stronger
-- signal than a person who typed and left) plus searches.
-- Non-admins get zero rows, not an error, so the page can render "nothing".
create or replace function public.demand_summary(p_days integer default 30)
returns table (
  q_norm text,
  sample_q text,
  section text,
  region text,
  searches bigint,
  requests bigint,
  reachable bigint,
  last_seen timestamptz
)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
declare
  v_since timestamptz;
begin
  if not public.admin_can('growth') then
    return;
  end if;
  v_since := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));

  return query
  with s as (
    select l.q_norm as term,
           count(*)::bigint as n,
           max(l.created_at) as last_at,
           max(l.q) as sample,
           mode() within group (order by l.section) as sec,
           mode() within group (order by l.region) as reg
      from public.search_logs l
     where l.results_count = 0 and l.created_at >= v_since
     group by l.q_norm
  ), d as (
    select r.q_norm as term,
           count(distinct coalesce(r.user_id::text, r.contact, r.id::text))::bigint as n,
           count(distinct r.contact)::bigint as reach,
           max(r.created_at) as last_at,
           max(r.q) as sample,
           mode() within group (order by r.section) as sec,
           mode() within group (order by r.region) as reg
      from public.demand_requests r
     where r.created_at >= v_since and r.status <> 'dismissed'
     group by r.q_norm
  )
  select coalesce(d.term, s.term),
         coalesce(d.sample, s.sample),
         coalesce(d.sec, s.sec),
         coalesce(d.reg, s.reg),
         coalesce(s.n, 0),
         coalesce(d.n, 0),
         coalesce(d.reach, 0),
         greatest(s.last_at, d.last_at)
    from s full join d on d.term = s.term
   order by coalesce(d.n, 0) * 3 + coalesce(s.n, 0) desc,
            greatest(s.last_at, d.last_at) desc
   limit 200;
end $function$;

revoke all on function public.demand_summary(integer) from public, anon, authenticated;
grant execute on function public.demand_summary(integer) to authenticated;

-- ── 5. Retention ────────────────────────────────────────────────────────────
-- Clears the personal half of a request after 180 days and keeps the demand
-- half. Called by pg_cron only; no browser role may execute it.
create or replace function public.purge_demand_personal_data()
returns integer
language plpgsql security definer set search_path = '' as $function$
declare v_n integer;
begin
  update public.demand_requests
     set contact = null, contact_kind = null, note = null, user_id = null
   where created_at < now() - interval '180 days'
     and (contact is not null or note is not null or user_id is not null);
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.purge_demand_personal_data() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron with schema extensions;
exception when others then
  raise notice 'pg_cron unavailable, skipping schedule setup: %', sqlerrm;
end $$;

do $$
begin
  perform cron.unschedule('matjar-demand-retention');
exception when others then null;  -- not scheduled yet
end $$;

do $$
begin
  perform cron.schedule('matjar-demand-retention', '30 3 * * *',
                        'select public.purge_demand_personal_data();');
exception when others then
  raise notice 'could not schedule matjar-demand-retention: %', sqlerrm;
end $$;
