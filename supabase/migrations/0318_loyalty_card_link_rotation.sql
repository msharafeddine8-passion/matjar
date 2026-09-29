-- 0318 — A loyalty card's link can be replaced (the gift-card twin of 0316).
--
-- loyalty_accounts.token (0310) is the only credential behind the public card
-- /[lang]/loyalty/<token>: the member's name, balance and last movements. It
-- was minted once by the column default and could not be changed, so a card
-- link sent to the wrong number stayed readable for good.
--
-- rotate_loyalty_card_link gives the member a fresh token (same shape and
-- entropy as the default: 18 random bytes, url-safe base64) and returns it;
-- get_loyalty_card then answers NULL for the old one and the page 404s.
--
-- Who: staff_can(store, 'customers') — exactly who can already list members
-- with their tokens (store_loyalty_members) and send the card. No plan check:
-- a downgraded store still manages the members it has. Balances live in
-- loyalty_events against the account id, so nothing but the link changes.

create or replace function public.rotate_loyalty_card_link(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store uuid;
  v_token text;
begin
  select a.store_id into v_store from public.loyalty_accounts a where a.id = p_account_id;
  if v_store is null or not public.staff_can(v_store, 'customers') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  update public.loyalty_accounts set token = v_token where id = p_account_id;
  return v_token;
end
$function$;

comment on function public.rotate_loyalty_card_link(uuid) is
  'Staff with customers: replace a loyalty member''s card-link token; the old /loyalty/<token> stops resolving. Balance unchanged. 0318.';

revoke all on function public.rotate_loyalty_card_link(uuid) from public, anon, authenticated;
grant execute on function public.rotate_loyalty_card_link(uuid) to authenticated;
