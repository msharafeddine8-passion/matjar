-- Google free listings: a per-store product feed the merchant connects in their
-- OWN Google Merchant Center (and, the same URL, a Meta catalog data feed).
-- Zero recurring cost to Matjar: no feed-management app, no API key, no AI.
--
-- Three columns on `stores`:
--
--   shipping_policy        The shop's own shipping/delivery terms, in its own
--                          words. Google requires a visible shipping policy and
--                          a visible return policy before it lists a shop's
--                          products; `return_policy` already exists (0303), this
--                          is its sibling and follows the same rule: free text
--                          the merchant writes and honours, never a structured
--                          promise the platform would appear to stand behind.
--   google_feed_enabled    The owner's switch. Off by default for every store.
--   google_feed_enabled_at When the current "on" began. Stamped by the trigger
--                          below, never by a browser.
--
-- AUTHORIZATION — nothing new. The owner writes these through the path they
-- already use for every storefront setting: a PostgREST UPDATE on `stores`,
-- allowed by the `stores_update` policy (owner or an admin with the `stores`
-- permission; staff cannot, per 0302). `anon` and `authenticated` hold
-- table-level SELECT/UPDATE on `stores`, so the new columns are covered with no
-- column grant, and the storefront's anon client can read both policies (RLS
-- still hides the row unless the store is active and not deleted).
--
-- THE GUARD. The public feed route re-checks everything at read time (plan,
-- switch, both policies, active store), so a bypass here could not publish a
-- feed. The trigger is the same rule at the source, so the database never holds
-- a state the dashboard would call impossible:
--
--   * turning the feed ON from a browser (anon/authenticated) requires both
--     policies to be non-blank and the store's plan to be pro/business or an
--     active trial — the effective plan of src/lib/plan-tiers.ts effectivePlan.
--     It reads OLD.plan / OLD.trial_ends_at on an update: the owner cannot
--     change those (guard_store_platform_columns resets them), and that guard
--     runs AFTER this one alphabetically, so reading NEW.plan would let an
--     owner pass the check by claiming "pro" in the same statement.
--   * a browser INSERT can never create a store with the feed already on.
--   * google_feed_enabled_at is always the trigger's: now() when the switch
--     turns on, kept while it stays on, null when it is off.
--
-- A trusted path (a SECURITY DEFINER RPC, the service role, pg_cron) and a
-- super admin skip the precondition check, the same escape hatch as
-- guard_store_platform_columns.
--
-- The function is SECURITY INVOKER (no definer grants to state) with
-- search_path pinned to ''.

alter table public.stores
  add column if not exists shipping_policy text,
  add column if not exists google_feed_enabled boolean not null default false,
  add column if not exists google_feed_enabled_at timestamptz;

comment on column public.stores.shipping_policy is
  'The shop''s own shipping/delivery terms, in its own words. Merchant-authored free text, not a rule the platform enforces. Required (with return_policy) before the Google feed can be switched on; rendered on /store/<id>/policies.';
comment on column public.stores.google_feed_enabled is
  'Owner switch for the public Google/Meta product feed at /feeds/<slug>/google.xml. The route also requires an effective plan of pro/business and both policies at read time.';
comment on column public.stores.google_feed_enabled_at is
  'When the current google_feed_enabled=true period began. Set by guard_google_feed(); a browser cannot write it.';

create or replace function public.guard_google_feed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_browser boolean := current_user in ('authenticated', 'anon');
  v_plan text;
  v_trial timestamptz;
begin
  if tg_op = 'INSERT' then
    if v_browser and not public.is_super_admin() then
      new.google_feed_enabled := false;
    end if;
    new.google_feed_enabled_at := case when new.google_feed_enabled then now() end;
    return new;
  end if;

  if new.google_feed_enabled and not old.google_feed_enabled then
    if v_browser and not public.is_super_admin() then
      if coalesce(btrim(new.return_policy), '') = ''
         or coalesce(btrim(new.shipping_policy), '') = '' then
        raise exception 'google_feed_requires_policies'
          using errcode = 'check_violation',
                hint = 'Write a return policy and a shipping policy first.';
      end if;
      v_plan := old.plan::text;
      v_trial := old.trial_ends_at;
      if not (v_plan in ('pro', 'business') or (v_trial is not null and v_trial > now())) then
        raise exception 'google_feed_requires_plan'
          using errcode = 'check_violation',
                hint = 'The product feed is included in Pro and Business.';
      end if;
    end if;
    new.google_feed_enabled_at := now();
  elsif new.google_feed_enabled then
    new.google_feed_enabled_at := old.google_feed_enabled_at;
  else
    new.google_feed_enabled_at := null;
  end if;
  return new;
end
$$;

-- A trigger function is never an /rpc/ endpoint and firing a trigger does not
-- consult EXECUTE; stated anyway, as 0281 group (c) did for its siblings, so no
-- browser role holds a grant nobody wrote down.
revoke all on function public.guard_google_feed() from public, anon, authenticated;

comment on function public.guard_google_feed() is
  'BEFORE INSERT/UPDATE on stores: a browser may switch the Google feed on only with both policies written and a pro/business (or trial) plan; stamps google_feed_enabled_at. See 0308.';

drop trigger if exists stores_guard_google_feed on public.stores;
create trigger stores_guard_google_feed
  before insert or update on public.stores
  for each row execute function public.guard_google_feed();
