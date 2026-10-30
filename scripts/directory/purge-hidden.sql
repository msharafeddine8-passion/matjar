-- Permanently deletes the directory rows hidden by the curation pass.
-- There is no undo. Run it yourself in the Supabase SQL editor.
--
-- Only touches rows that have no owner, were hidden with this exact reason, and
-- have no claim request. Real merchants always have an owner, so they can't match.

-- 1. Check the count first.
select count(*) as will_delete
from public.stores s
where s.owner_id is null
  and s.status_reason = 'directory_curation'
  and s.deleted_at is not null
  and not exists (select 1 from public.store_claim_requests c where c.store_id = s.id);

-- 2. Then delete. Their store_locations rows go with them through the foreign key.
delete from public.stores s
where s.owner_id is null
  and s.status_reason = 'directory_curation'
  and s.deleted_at is not null
  and not exists (select 1 from public.store_claim_requests c where c.store_id = s.id);
