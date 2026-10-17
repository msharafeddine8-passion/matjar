-- 0325: money/PII SECURITY DEFINER RPCs checked only can_manage_store (= ANY
-- staff row on the store), so a bookings-only employee could call them straight
-- from the browser and read revenue, expenses, margins, the customer list with
-- names and phones, and colleagues' attendance. Each function had exactly one
-- such check; it is replaced by the permission its page and tables already use:
--
--   store_report, store_margin_report, store_audience  -> staff_can 'orders'
--   store_accounting                                   -> staff_can 'expenses'
--   store_customer_order_totals                        -> staff_can 'customers'
--   store_customer_emails (bookings page)              -> 'bookings' or 'customers'
--   adjust_stock, receive_stock                        -> staff_can 'products'
--   pos_record_sale                                    -> 'pos' or 'orders'
--   attendance_timesheet                               -> owner (or super admin),
--                                                         like the HR tables (0274)
--
-- staff_can() is true for the store owner, so owners are unaffected.
--
-- Written as a rewrite of each function's CURRENT definition (one token swap),
-- so it reproduces on a fresh database after the migrations that define them.
-- Verified 2026-10-17 in a rolled-back transaction with a temporary staffer who
-- had only the 'bookings' permission: report, accounting and timesheet refused,
-- customer totals returned 0 rows, customer emails still worked; the owner kept
-- report, accounting and timesheet.

do $mig$
declare rec record; def text; arg text; token text; newexpr text;
begin
  for rec in select * from (values
    ('store_report',                '#ARG#, ''orders'''),
    ('store_margin_report',         '#ARG#, ''orders'''),
    ('store_audience',              '#ARG#, ''orders'''),
    ('store_accounting',            '#ARG#, ''expenses'''),
    ('store_customer_order_totals', '#ARG#, ''customers'''),
    ('store_customer_emails',       'OR:bookings,customers'),
    ('adjust_stock',                '#ARG#, ''products'''),
    ('receive_stock',               '#ARG#, ''products'''),
    ('pos_record_sale',             'OR:pos,orders'),
    ('attendance_timesheet',        'OWNER')
  ) v(fn, rule) loop
    select pg_get_functiondef(p.oid) into def from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname=rec.fn;
    arg := substring(def from 'can_manage_store\(([^)]*)\)');
    if arg is null then
      raise exception 'expected one can_manage_store call in %', rec.fn;
    end if;
    token := case when position('public.can_manage_store(' in def) > 0
                  then 'public.can_manage_store(' || arg || ')'
                  else 'can_manage_store(' || arg || ')' end;
    newexpr := case
      when rec.rule = 'OWNER' then '(public.is_store_owner(' || arg || ') or public.is_super_admin())'
      when rec.rule like 'OR:%' then '(public.staff_can(' || arg || ', ''' || split_part(substr(rec.rule,4), ',', 1) || ''') or public.staff_can(' || arg || ', ''' || split_part(substr(rec.rule,4), ',', 2) || '''))'
      else 'public.staff_can(' || replace(rec.rule, '#ARG#', arg) || ')' end;
    execute replace(def, token, newexpr);
  end loop;
end
$mig$;
