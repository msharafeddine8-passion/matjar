-- 0337: a push that can't be sent says so in the Postgres log.
--
-- notify_push returned silently when private.app_config lacked push_hook_secret
-- or site_url, so a lost config meant every push vanished with no trace (health
-- audit 2026-10-17). It now RAISEs a WARNING (logged, never fails the caller's
-- transaction — an order must not be refused because a push can't go out).

do $mig$
declare def text; old_t text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'notify_push';
  old_t := 'if v_secret is null or v_base is null then return; end if;';
  if position(old_t in def) = 0 then
    raise exception 'notify_push: config guard not found';
  end if;
  execute replace(def, old_t,
    $n$if v_secret is null or v_base is null then
    raise warning 'notify_push: push_hook_secret or site_url missing in private.app_config — push to % dropped', p_uid;
    return;
  end if;$n$);
end
$mig$;
