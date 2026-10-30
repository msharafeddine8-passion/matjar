-- 0338: showcase stores, and a directory of unclaimed businesses.
--
-- Owner decision, 2026-10-30:
--   1. A business can have a store on Matjar purely to SHOW its products and
--      services, without taking orders or bookings through us
--      (stores.listing_mode = 'showcase').
--   2. Matjar lists real Lebanese businesses gathered from public sources, each
--      plainly marked unconfirmed, and the real owner can claim, correct or
--      remove the listing. Such a store has no owner yet: owner_id IS NULL.
--
-- Facts only: a directory row carries what a public source states (name, sector,
-- place, phone, website) and where it came from (data_source, source_url). No
-- invented descriptions, ratings or photos.
--
-- The rules live in the database as well as the screens: a showcase store cannot
-- receive an order or a booking through any RPC, and an unowned store cannot
-- receive anything that needs someone to read it (message, lead, request, review).
--
-- Claiming is reviewed by an admin — an open "this is mine" button would let
-- anyone take over a business's page. Nothing here sends anything to the business.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.stores alter column owner_id drop not null;

alter table public.stores
  add column if not exists listing_mode text not null default 'full'
    check (listing_mode in ('full', 'showcase')),
  add column if not exists info_status text not null default 'owner'
    check (info_status in ('owner', 'unconfirmed')),
  add column if not exists data_source text,
  add column if not exists source_url text,
  add column if not exists source_key text,
  add column if not exists claimed_at timestamptz;

create unique index if not exists stores_source_key_uq
  on public.stores (source_key) where source_key is not null;
-- Discovery ranks owned stores first and filters on these.
create index if not exists stores_unclaimed_idx
  on public.stores (business_type_id, region) where owner_id is null and deleted_at is null;

-- An ownerless store is never a full transacting store.
alter table public.stores
  add constraint stores_unowned_is_showcase
  check (owner_id is not null or listing_mode = 'showcase');

-- ── Triggers that assumed an owner ──────────────────────────────────────────
create or replace function public.grant_store_trial()
returns trigger language plpgsql set search_path to '' as $function$
begin
  -- 0338: a directory listing has nobody to run a trial; claiming starts it.
  if new.owner_id is not null and new.plan = 'free' and new.trial_ends_at is null then
    new.trial_ends_at := now() + interval '14 days';
  end if;
  return new;
end $function$;

do $mig$
declare def text; old_t text;
begin
  select pg_get_functiondef('public.on_store_status_change()'::regprocedure) into def;
  old_t := $o$  if v_type is null then
    return new;
  end if;$o$;
  if position(old_t in def) = 0 then raise exception 'on_store_status_change: guard not found'; end if;
  execute replace(def, old_t, $n$  if v_type is null or new.owner_id is null then  -- 0338: nobody to tell
    return new;
  end if;$n$);
end $mig$;

create or replace function public.on_new_store()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  -- 0338: importing a directory must not push the admin once per row.
  if new.owner_id is null then
    return new;
  end if;

  update public.profiles
    set role = 'merchant'
    where id = new.owner_id and role = 'customer';

  insert into public.notifications (user_id, type, data)
  select p.id, 'store_new',
         jsonb_build_object('store_id', new.id, 'store_name', new.name, 'status', new.status)
  from public.profiles p
  where p.role = 'super_admin';

  return new;
end $function$;

-- Browser writes can't touch provenance, in either direction.
do $mig$
declare def text; old_t text;
begin
  select pg_get_functiondef('public.guard_store_insert_platform_columns()'::regprocedure) into def;
  old_t := $o$  new.status_reason := null;$o$;
  if position(old_t in def) = 0 then raise exception 'store insert guard: anchor not found'; end if;
  execute replace(def, old_t, $n$  new.info_status := 'owner';
  new.data_source := null;
  new.source_url  := null;
  new.source_key  := null;
  new.claimed_at  := null;
  new.status_reason := null;$n$);

  select pg_get_functiondef('public.guard_store_platform_columns()'::regprocedure) into def;
  old_t := $o$  new.status_reason     := old.status_reason;$o$;
  if position(old_t in def) = 0 then raise exception 'store update guard: anchor not found'; end if;
  execute replace(def, old_t, $n$  new.info_status := old.info_status;
  new.data_source := old.data_source;
  new.source_url  := old.source_url;
  new.source_key  := old.source_key;
  new.claimed_at  := old.claimed_at;
  new.status_reason     := old.status_reason;$n$);
end $mig$;

-- ── A showcase store takes no orders or bookings, by any path ───────────────
create or replace function public.guard_store_transacts()
returns trigger language plpgsql set search_path to '' as $function$
begin
  if exists (select 1 from public.stores s
             where s.id = new.store_id and s.listing_mode = 'showcase') then
    raise exception 'store_showcase_only' using errcode = '42501';
  end if;
  return new;
end $function$;

-- An unowned store has nobody to read a message, lead, request or review.
create or replace function public.guard_store_has_owner()
returns trigger language plpgsql set search_path to '' as $function$
begin
  if exists (select 1 from public.stores s
             where s.id = new.store_id and s.owner_id is null) then
    raise exception 'store_unclaimed' using errcode = '42501';
  end if;
  return new;
end $function$;

do $mig$
declare t text;
begin
  foreach t in array array['orders','bookings','stay_bookings','rental_bookings',
                           'event_tickets','store_memberships','course_enrollments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_a_guard_showcase', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.guard_store_transacts()',
                   t || '_a_guard_showcase', t);
  end loop;
  foreach t in array array['leads','service_requests','conversations','reviews'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_a_guard_unclaimed', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.guard_store_has_owner()',
                   t || '_a_guard_unclaimed', t);
  end loop;
end $mig$;

-- ── Claim / correct / remove requests ───────────────────────────────────────
create table if not exists public.store_claim_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null check (kind in ('claim', 'correct', 'remove')),
  name text not null,
  phone text not null,
  email text,
  note text,
  requester_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'done')),
  admin_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists store_claim_requests_store_idx on public.store_claim_requests (store_id);
create index if not exists store_claim_requests_open_idx on public.store_claim_requests (created_at) where status = 'pending';
create index if not exists store_claim_requests_requester_idx on public.store_claim_requests (requester_id);
create index if not exists store_claim_requests_resolver_idx on public.store_claim_requests (resolved_by);

alter table public.store_claim_requests enable row level security;
-- Names and phones of people who wrote to us: admins only. Requests go through
-- the RPC below; nothing writes to the table directly.
create policy store_claim_requests_admin_select on public.store_claim_requests
  for select using ((select public.admin_can('stores')));

create or replace function public.request_store_claim(
  p_store_id uuid, p_kind text, p_name text, p_phone text,
  p_email text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare
  v_store record;
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('claim', 'correct', 'remove') then
    return jsonb_build_object('ok', false, 'code', 'bad_kind');
  end if;
  if length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'code', 'name');
  end if;
  if length(v_digits) < 7 then
    return jsonb_build_object('ok', false, 'code', 'phone');
  end if;

  select s.id, s.name, s.owner_id into v_store
    from public.stores s
   where s.id = p_store_id and s.deleted_at is null and s.status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_store.owner_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_claimed');
  end if;

  -- Abuse limits: an open form on every directory page.
  if (select count(*) from public.store_claim_requests r
       where regexp_replace(r.phone, '[^0-9]', '', 'g') = v_digits
         and r.created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.store_claim_requests r
          where r.created_at > now() - interval '1 hour') >= 100 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  if exists (select 1 from public.store_claim_requests r
              where r.store_id = p_store_id and r.kind = p_kind and r.status = 'pending'
                and regexp_replace(r.phone, '[^0-9]', '', 'g') = v_digits) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into public.store_claim_requests (store_id, kind, name, phone, email, note, requester_id)
  values (p_store_id, p_kind, left(v_name, 120), left(btrim(p_phone), 40),
          nullif(left(btrim(coalesce(p_email, '')), 200), ''),
          nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
          auth.uid())
  returning id into v_id;

  insert into public.notifications (user_id, type, data)
  select p.id, 'store_claim',
         jsonb_build_object('request_id', v_id, 'store_id', v_store.id, 'store_name', v_store.name,
                            'kind', p_kind, 'name', left(v_name, 120))
  from public.profiles p where p.role = 'super_admin';

  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

revoke all on function public.request_store_claim(uuid, text, text, text, text, text) from public;
grant execute on function public.request_store_claim(uuid, text, text, text, text, text) to anon, authenticated;

-- approve: the business gets the store (the admin checked who they are and
-- names the account by email). remove: the listing comes down. done/reject: close.
create or replace function public.admin_resolve_store_claim(
  p_request_id uuid, p_action text, p_owner_email text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare r record; v_owner uuid;
begin
  if not public.admin_can('stores') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve', 'reject', 'remove', 'done') then
    return jsonb_build_object('ok', false, 'code', 'bad_action');
  end if;

  select * into r from public.store_claim_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'code', 'already_resolved'); end if;

  if p_action = 'approve' then
    select u.id into v_owner from auth.users u
     where lower(u.email) = lower(btrim(coalesce(p_owner_email, ''))) limit 1;
    if v_owner is null then
      return jsonb_build_object('ok', false, 'code', 'user_not_found');
    end if;
    if exists (select 1 from public.stores s where s.id = r.store_id and s.owner_id is not null) then
      return jsonb_build_object('ok', false, 'code', 'already_claimed');
    end if;
    -- Stays a showcase: taking orders is the owner's own decision, from settings.
    update public.stores
       set owner_id = v_owner, info_status = 'owner', claimed_at = now(),
           trial_ends_at = now() + interval '14 days'
     where id = r.store_id;
    update public.profiles set role = 'merchant' where id = v_owner and role = 'customer';
    insert into public.notifications (user_id, type, data)
    select v_owner, 'store_claim_approved',
           jsonb_build_object('store_id', s.id, 'store_name', s.name)
      from public.stores s where s.id = r.store_id;
  elsif p_action = 'remove' then
    update public.stores
       set deleted_at = now(), status_reason = 'directory_removal_request'
     where id = r.store_id and owner_id is null;
  end if;

  update public.store_claim_requests
     set status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'done' end,
         admin_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_request_id;

  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.admin_resolve_store_claim(uuid, text, text, text) from public, anon;
grant execute on function public.admin_resolve_store_claim(uuid, text, text, text) to authenticated;

-- ── Pushes ──────────────────────────────────────────────────────────────────
do $mig$
declare def text; anchor text;
begin
  select pg_get_functiondef('public.push_on_notification()'::regprocedure) into def;
  anchor := $o$    when 'store_new' then$o$;
  if position(anchor in def) = 0 then raise exception 'push_on_notification: store_new branch not found'; end if;
  execute replace(def, anchor, $n$    when 'store_claim' then
      v_title := case new.data->>'kind' when 'claim' then 'طلب مطالبة بمحل 🏪'
                                        when 'remove' then 'طلب حذف محل'
                                        else 'طلب تصحيح معلومات' end;
      v_body := coalesce(new.data->>'name', '') || ' — ' || coalesce(new.data->>'store_name', '');
      v_url := '/ar/admin/claims';
    when 'store_claim_approved' then
      v_title := 'صار المحل باسمك 🎉';
      v_body := coalesce(new.data->>'store_name', 'محلك') || ' — ضيف منتجاتك وصحّح معلوماتك';
      v_url := v_m;
$n$ || anchor);
end $mig$;

-- ── Bulk import, for the directory loader (scripts/directory) ───────────────
-- Trusted path only: nobody but the migration owner can call it. Idempotent on
-- source_key, so re-running a batch adds nothing twice, and everything it adds
-- can be found by data_source and taken down in one statement.
create or replace function public.directory_import(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_added int := 0; v_total int; v_n int; r jsonb; v_type uuid;
begin
  v_total := jsonb_array_length(p_rows);
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_type from public.business_types where slug = r->>'sector';
    if v_type is null then continue; end if;
    insert into public.stores (
      owner_id, business_type_id, name, region, area, address, phone, whatsapp,
      website, instagram, facebook, lat, lng, opening_hours, specialties,
      status, plan, listing_mode, info_status, data_source, source_url, source_key)
    values (
      null, v_type, r->>'name', r->>'region', r->>'area', r->>'address',
      r->>'phone', r->>'whatsapp', r->>'website', r->>'instagram', r->>'facebook',
      (r->>'lat')::numeric, (r->>'lng')::numeric, r->>'opening_hours', r->>'specialties',
      'active', 'free', 'showcase', 'unconfirmed', r->>'data_source', r->>'source_url', r->>'source_key')
    on conflict (source_key) where source_key is not null do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;
  return jsonb_build_object('total', v_total, 'added', v_added);
end $function$;

revoke all on function public.directory_import(jsonb) from public, anon, authenticated;
