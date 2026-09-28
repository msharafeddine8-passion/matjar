-- 0316 — A gift card's balance link can be replaced.
--
-- gift_cards.token (0310) is the VIEWING credential behind /[lang]/gift/<token>:
-- balance, expiry and the last movements, never the code. It was minted once by
-- the column default and could not be changed, unlike 0307's statement links —
-- so a link forwarded to the wrong person stayed readable for the card's life.
--
-- rotate_gift_card_link gives the card a fresh token (same shape and entropy as
-- the default: 18 random bytes, url-safe base64) and returns it. The old link
-- then answers NULL from get_gift_card and the page 404s.
--
-- Owner only, the same rule as issue/void. No plan check: a downgraded store
-- still manages the cards it already issued. The code and the balance are not
-- touched — a leaked CODE is what void_gift_card is for.

create or replace function public.rotate_gift_card_link(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store uuid;
  v_token text;
begin
  select g.store_id into v_store from public.gift_cards g where g.id = p_id;
  if v_store is null or not public.is_store_owner(v_store) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  update public.gift_cards set token = v_token where id = p_id;
  return v_token;
end
$function$;

comment on function public.rotate_gift_card_link(uuid) is
  'Owner only: replace a gift card''s read-only link token; the old /gift/<token> stops resolving. Code and balance unchanged. 0316.';

revoke all on function public.rotate_gift_card_link(uuid) from public, anon, authenticated;
grant execute on function public.rotate_gift_card_link(uuid) to authenticated;
