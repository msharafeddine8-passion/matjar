-- 0331: an upgrade request says which plan the merchant wants.
--
-- request_pro_upgrade(store, phone) only ever meant "Pro". The subscription
-- page now offers every tier above the current one (Basic -> Pro/Business,
-- Pro -> Business), so the request carries p_requested_plan. The two-argument
-- function is REPLACED, not overloaded: two candidates would make PostgREST
-- answer PGRST203 to every call. Old two-argument calls still resolve (the new
-- parameter defaults to null and means "unspecified").
--
-- A named plan must be basic/pro/business and above the store's paid plan.

drop function if exists public.request_pro_upgrade(uuid, text);

create function public.request_pro_upgrade(
  p_store_id uuid,
  p_phone text default null,
  p_requested_plan text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_name text; v_owner uuid; v_plan text; v_trial timestamptz;
  v_oname text; v_ophone text; v_req text := lower(nullif(btrim(coalesce(p_requested_plan, '')), ''));
  v_rank constant jsonb := '{"free":0,"basic":1,"pro":2,"business":3}';
begin
  select s.name, s.owner_id, s.plan::text, s.trial_ends_at
    into v_name, v_owner, v_plan, v_trial
    from public.stores s where s.id = p_store_id;
  if v_owner is null then raise exception 'not_found'; end if;
  if v_owner <> auth.uid() then raise exception 'not_authorized'; end if;

  if v_req is not null then
    if v_req not in ('basic', 'pro', 'business') then
      raise exception 'invalid_plan';
    end if;
    if (v_rank->>v_req)::int <= coalesce((v_rank->>coalesce(v_plan, 'free'))::int, 0) then
      raise exception 'invalid_plan';
    end if;
  end if;

  select p.full_name, p.phone into v_oname, v_ophone
    from public.profiles p where p.id = v_owner;

  insert into public.notifications (user_id, type, data)
  select p.id, 'pro_request',
         jsonb_build_object(
           'store_id', p_store_id,
           'store_name', v_name,
           'owner_name', nullif(trim(coalesce(v_oname, '')), ''),
           'phone', coalesce(
                      nullif(trim(coalesce(p_phone, '')), ''),
                      nullif(trim(coalesce(v_ophone, '')), '')),
           'plan', v_plan,
           'requested_plan', v_req,
           'trial_ends_at', v_trial)
  from public.profiles p where p.role = 'super_admin';
end $function$;

revoke all on function public.request_pro_upgrade(uuid, text, text) from public, anon;
grant execute on function public.request_pro_upgrade(uuid, text, text) to authenticated;

-- The admin push names the plan asked for.
do $mig$
declare def text; old_t text; new_t text;
begin
  select pg_get_functiondef('public.push_on_notification()'::regprocedure) into def;
  old_t := $o$|| ' بدّو يرقّي باقته';$o$;
  new_t := $n$|| ' بدّو يرقّي ' || coalesce('لباقة ' || initcap(new.data->>'requested_plan'), 'باقته');$n$;
  if position(old_t in def) = 0 then
    raise exception 'push_on_notification: pro_request body not found';
  end if;
  execute replace(def, old_t, new_t);
end
$mig$;
