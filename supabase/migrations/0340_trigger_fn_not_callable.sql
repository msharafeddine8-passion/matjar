-- 0340: a trigger function from 0333 needs no client EXECUTE (check-definer-grants).
revoke all on function public.cancel_delivery_with_order() from public, anon, authenticated;
