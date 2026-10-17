-- 0332: the money and stock paths 0325 missed now check the staff permission
-- their screens use, and the POS can read its own sales.
--
-- From the merchant re-audit (2026-10-17):
--   * record_order_payment, request_delivery, update_delivery_status and
--     issue_invoice checked can_manage_store (= ANY staff row), so a
--     bookings-only employee could record refunds (which issue credit notes),
--     book or cancel couriers and issue invoices straight from the API.
--     -> staff_can 'orders'. redeem_loyalty_points -> 'orders' as well: it is
--     applied to an order at the till/checkout.
--   * order_payments / delivery_requests were readable by any staff
--     -> staff_can 'orders' (customers keep reading their own payments).
--   * adjust_stock / receive_stock (0325) asked for 'products', but the stock
--     tables they write (stock_movements, product_branch_stock) check
--     'inventory'. Either now passes, matching both screens that call them.
--   * pos_sales was readable only with 'pos' while pos_record_sale also accepts
--     'orders', so an orders-permission cashier sold all day and saw "0 · $0".
--     Read = pos or orders; writes stay 'pos' (sales go through the DEFINER RPC).
--
-- staff_can() is true for the owner, so owners are unaffected. Each function has
-- exactly one check (verified 2026-10-17); the rewrite asserts it found it.

do $mig$
declare rec record; def text; arg text; token text; newexpr text;
begin
  for rec in select * from (values
    ('record_order_payment',   'orders'),
    ('request_delivery',       'orders'),
    ('update_delivery_status', 'orders'),
    ('issue_invoice',          'orders'),
    ('redeem_loyalty_points',  'orders')
  ) v(fn, perm) loop
    select pg_get_functiondef(p.oid) into def from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = rec.fn;
    arg := substring(def from 'can_manage_store\(([^)]*)\)');
    if arg is null then
      raise exception 'expected one can_manage_store call in %', rec.fn;
    end if;
    token := case when position('public.can_manage_store(' in def) > 0
                  then 'public.can_manage_store(' || arg || ')'
                  else 'can_manage_store(' || arg || ')' end;
    newexpr := 'public.staff_can(' || arg || ', ''' || rec.perm || ''')';
    execute replace(def, token, newexpr);
  end loop;

  for rec in select * from (values ('adjust_stock'), ('receive_stock')) v(fn) loop
    select pg_get_functiondef(p.oid) into def from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = rec.fn;
    arg := substring(def from 'staff_can\(([^,]*), ''products''\)');
    if arg is null then
      raise exception 'expected staff_can(..., ''products'') in %', rec.fn;
    end if;
    token := case when position('public.staff_can(' in def) > 0
                  then 'public.staff_can(' || arg || ', ''products'')'
                  else 'staff_can(' || arg || ', ''products'')' end;
    newexpr := '(public.staff_can(' || arg || ', ''products'') or public.staff_can(' || arg || ', ''inventory''))';
    execute replace(def, token, newexpr);
  end loop;
end
$mig$;

drop policy if exists delivery_requests_select_store on public.delivery_requests;
create policy delivery_requests_select_store on public.delivery_requests
  for select using (public.staff_can(store_id, 'orders'));

drop policy if exists order_payments_select on public.order_payments;
create policy order_payments_select on public.order_payments
  for select using (
    public.staff_can(store_id, 'orders')
    or public.is_super_admin()
    or exists (select 1 from public.orders o
               where o.id = order_payments.order_id
                 and o.customer_id = (select auth.uid())));

drop policy if exists pos_sales_manage on public.pos_sales;
create policy pos_sales_select on public.pos_sales
  for select using (public.staff_can(store_id, 'pos') or public.staff_can(store_id, 'orders'));
create policy pos_sales_insert on public.pos_sales
  for insert with check (public.staff_can(store_id, 'pos'));
create policy pos_sales_update on public.pos_sales
  for update using (public.staff_can(store_id, 'pos')) with check (public.staff_can(store_id, 'pos'));
create policy pos_sales_delete on public.pos_sales
  for delete using (public.staff_can(store_id, 'pos'));
