-- A service is booked, never ordered.
--
-- lib/offering.ts refuses a service (item_kind = 'service') in the cart, but
-- only in the browser. place_customer_order and place_guest_order accept any
-- product id and never read item_kind, so a direct API call could turn a
-- clinic's "أشعة" into a delivery order. A BEFORE INSERT trigger on
-- order_items puts the rule on the row both RPCs write, inside their own
-- transaction, without editing either RPC.
--
-- Narrow on purpose: only item_kind = 'service'. Checked read-only on
-- 2026-09-24: 13 service items exist and none has ever been on an order line.
-- SECURITY DEFINER with an empty search_path so the check sees the product
-- whoever inserts; a trigger function has no client audience.
-- Approved by the owner on 2026-09-24. Applied to production the same day after a
-- rolled-back test: the service line was rejected (SQLSTATE 23514), a product
-- line on the same order went through.

create or replace function public.order_item_rejects_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_id is not null and exists (
    select 1 from public.products p
    where p.id = new.product_id and p.item_kind = 'service'
  ) then
    raise exception 'A service is booked, not ordered (product %)', new.product_id
      using errcode = 'check_violation',
            hint = 'Book it through the store''s appointment flow.';
  end if;
  return new;
end;
$$;

revoke all on function public.order_item_rejects_service() from public, anon, authenticated;

drop trigger if exists order_item_rejects_service on public.order_items;
create trigger order_item_rejects_service
  before insert on public.order_items
  for each row execute function public.order_item_rejects_service();
