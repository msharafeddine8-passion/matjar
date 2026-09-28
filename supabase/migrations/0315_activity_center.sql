-- 0315 — a customer can read the inquiries they sent.
--
-- WHY. create_lead() (0190) writes a lead with customer_id = the signed-in
-- customer, and the customer screens read it back: the activity centre
-- (/activity, «طلباتي») lists it and /inquiries/[id] shows it with the shop's
-- phone and WhatsApp. But the only SELECT policy on public.leads is
-- leads_select_store (0190, re-scoped to staff_can(store_id, 'orders') in
-- 0198). No policy ever let the customer read their own row, so for every
-- customer who is not also staff of that store:
--   * the inquiries tab of the activity centre is always empty, and
--   * /inquiries/<their own lead id> is a 404.
-- Checked on production 2026-09-28: pg_policies on leads = leads_select_store
-- (SELECT) + leads_update_store (UPDATE), nothing else; 3 leads carry a
-- customer_id.
--
-- WHAT. One permissive SELECT policy for `authenticated`: a row whose
-- customer_id is the caller. Nothing else changes:
--   * no INSERT policy — leads are still written only by create_lead()
--     (security definer);
--   * no UPDATE/DELETE for the customer — leads_update_store stays staff-only;
--   * anon gets nothing (the policy is `to authenticated`, and a guest lead has
--     customer_id null, which never equals auth.uid());
--   * store staff keep exactly what leads_select_store gave them (policies are
--     OR-ed; this one adds rows only for the row's own customer).
--
-- COLUMNS. The customer can read every column of their own row, including
-- assigned_to (the uuid of the staff member handling it) and
-- last_contacted_at. Both describe the customer's own inquiry; assigned_to is
-- an opaque id, not a name or a contact. The app selects neither on the
-- customer side. A column-level revoke is not used because `authenticated` is
-- also the merchant's role and the merchant inbox reads assigned_to.
--
-- Idempotent: safe to re-run.

drop policy if exists leads_select_own on public.leads;
create policy leads_select_own on public.leads
  for select
  to authenticated
  using (customer_id = (select auth.uid()));

comment on policy leads_select_own on public.leads is
  'The customer who sent an inquiry can read it (activity centre, /inquiries/[id]). Read only; writes stay with create_lead() and store staff.';
