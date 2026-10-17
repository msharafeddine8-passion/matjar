-- 0326: deleting a catalogue entity no longer wipes customer history.
--
-- These five foreign keys were ON DELETE CASCADE, and the merchant managers had
-- no "edit", only add + delete — so changing a price meant delete + re-create,
-- and the delete silently took every customer record hanging off it:
--   accommodation_units    -> stay_bookings      (stays)
--   rental_vehicles        -> rental_bookings    (rentals)
--   event_ticket_types     -> event_tickets      (sold tickets)
--   store_membership_plans -> store_memberships  (members' subscriptions)
--   store_courses          -> course_enrollments (enrolments)
--
-- Now such a delete fails with 23503 while history exists; the dashboard offers
-- edit / deactivate instead. NO ACTION rather than RESTRICT: it is checked at
-- the end of the statement, so removing a whole store (which removes the
-- history rows in the same statement) still works.

alter table public.stay_bookings
  drop constraint stay_bookings_unit_id_fkey,
  add constraint stay_bookings_unit_id_fkey
    foreign key (unit_id) references public.accommodation_units(id) on delete no action;

alter table public.rental_bookings
  drop constraint rental_bookings_vehicle_id_fkey,
  add constraint rental_bookings_vehicle_id_fkey
    foreign key (vehicle_id) references public.rental_vehicles(id) on delete no action;

alter table public.event_tickets
  drop constraint event_tickets_ticket_type_id_fkey,
  add constraint event_tickets_ticket_type_id_fkey
    foreign key (ticket_type_id) references public.event_ticket_types(id) on delete no action;

alter table public.store_memberships
  drop constraint store_memberships_plan_id_fkey,
  add constraint store_memberships_plan_id_fkey
    foreign key (plan_id) references public.store_membership_plans(id) on delete no action;

alter table public.course_enrollments
  drop constraint course_enrollments_course_id_fkey,
  add constraint course_enrollments_course_id_fkey
    foreign key (course_id) references public.store_courses(id) on delete no action;
