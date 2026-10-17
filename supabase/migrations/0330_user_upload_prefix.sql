-- 0330: user-content uploads live under the uploader's own folder.
--
-- can_write_store_asset let any signed-in user write anything under gigs/,
-- listings/, reviews/ and wholesale/ — no owner in the path, so nothing tied a
-- file to a person (update/delete were already owner-only, so this was junk in
-- shared folders rather than overwrites). ImageUpload now writes
-- `<folder>/<user id>/<random>.<ext>` for these four folders; a new upload must
-- carry the caller's own id. Existing files keep their URLs — only new INSERTs
-- are checked.
--
-- Applied after the client that writes the new paths was live on production.

do $mig$
declare def text; old_block text; new_block text;
begin
  select pg_get_functiondef('public.can_write_store_asset(text)'::regprocedure) into def;

  old_block := $o$  if seg1 in ('gigs', 'listings', 'reviews', 'wholesale') then
    return true;
  end if;$o$;

  new_block := $n$  if seg1 in ('gigs', 'listings', 'reviews', 'wholesale') then
    -- 0330: <folder>/<own user id>/<file>
    return seg2 = uid::text and split_part(p_name, '/', 3) <> '';
  end if;$n$;

  if position(old_block in def) = 0 then
    raise exception 'can_write_store_asset: user-folder branch not found';
  end if;
  execute replace(def, old_block, new_block);
end
$mig$;
