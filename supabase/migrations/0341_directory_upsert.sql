-- 0341: the curated directory. directory_import only inserted; the curated list
-- also carries a logo and a one-line description, and may bring back or correct a
-- row an earlier pass imported. Never touches a store someone has claimed.
-- Trusted path only: no client role can call it.

create or replace function public.directory_upsert(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_added int := 0; v_updated int := 0; v_n int; r jsonb; v_type uuid;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_type from public.business_types where slug = r->>'sector';
    if v_type is null then continue; end if;

    update public.stores s set
      business_type_id = v_type, name = r->>'name', region = r->>'region', area = r->>'area',
      address = r->>'address', phone = r->>'phone', whatsapp = r->>'whatsapp',
      website = r->>'website', instagram = r->>'instagram', facebook = r->>'facebook',
      logo_url = r->>'logo_url', description = r->>'description', specialties = r->>'specialties',
      lat = coalesce((r->>'lat')::numeric, s.lat), lng = coalesce((r->>'lng')::numeric, s.lng),
      data_source = r->>'data_source', source_url = r->>'source_url',
      deleted_at = null, status_reason = null
    where s.source_key = r->>'source_key' and s.owner_id is null;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_updated := v_updated + v_n; continue; end if;

    insert into public.stores (
      owner_id, business_type_id, name, region, area, address, phone, whatsapp,
      website, instagram, facebook, logo_url, description, lat, lng, specialties,
      status, plan, listing_mode, info_status, data_source, source_url, source_key)
    values (
      null, v_type, r->>'name', r->>'region', r->>'area', r->>'address',
      r->>'phone', r->>'whatsapp', r->>'website', r->>'instagram', r->>'facebook',
      r->>'logo_url', r->>'description', (r->>'lat')::numeric, (r->>'lng')::numeric, r->>'specialties',
      'active', 'free', 'showcase', 'unconfirmed', r->>'data_source', r->>'source_url', r->>'source_key')
    on conflict (source_key) where source_key is not null do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;
  return jsonb_build_object('total', jsonb_array_length(p_rows), 'added', v_added, 'updated', v_updated);
end $function$;

revoke all on function public.directory_upsert(jsonb) from public, anon, authenticated;
