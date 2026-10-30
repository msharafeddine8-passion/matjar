-- 0339: the public can read what a directory page shows.
--
-- stores has had column-level grants since 0314; 0338 added columns without
-- granting them, so a public read of listing_mode failed with 42501. source_key
-- stays internal.
--
-- stores.address is private for merchants (0314). For an unowned directory row
-- the address is public-source fact the page exists to show, so it is exposed
-- for those rows only, through a function.

grant select (listing_mode, info_status, data_source, source_url, claimed_at)
  on public.stores to anon, authenticated;

create or replace function public.directory_store_address(p_store_id uuid)
returns text
language sql stable security definer set search_path to '' as $$
  select s.address from public.stores s
   where s.id = p_store_id and s.owner_id is null
     and s.deleted_at is null and s.status = 'active'
$$;
revoke all on function public.directory_store_address(uuid) from public;
grant execute on function public.directory_store_address(uuid) to anon, authenticated;
