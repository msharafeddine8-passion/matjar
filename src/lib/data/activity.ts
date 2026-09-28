import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  normaliseActivity,
  countNeedingCustomer as countPure,
  type ActivityItem,
  type RawActivity,
} from "@/lib/activity";

// Everything the customer started, in one place — the fetching half.
//
// The decisions (what a row is called, whether it is the customer's move,
// what "again" means) live in lib/activity.ts, which is pure and tested. This
// file only reads, and only the caller's own rows: every table below has an
// RLS policy that returns a customer exactly their own rows (customer_id /
// applicant_id / seller_id = auth.uid()), and every query ALSO filters on the
// caller's id, so a merchant who is also a customer does not get their
// store's rows mixed into their personal list.
//
// One round trip per kind, all in parallel, no per-row follow-ups: names come
// in through embedded selects, and "already reviewed" is one extra read of
// the customer's own store reviews plus an embed on craft_reviews.
//
// Leads: until migration 0315 is applied the customer has no SELECT on
// `leads` (0190/0198 gave it to store staff only), so that read returns []
// and the inquiries tab simply does not appear — the same as before. It does
// not error.

export type { ActivityItem, ActivityKind } from "@/lib/activity";

/** Rows per kind. One screen of history per kind, not an archive. */
const PER_KIND = 50;

async function fetchCustomerActivity(lang: string): Promise<ActivityItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const uid = user.id;

  const [
    orders,
    bookings,
    stays,
    rentals,
    tickets,
    services,
    crafts,
    leads,
    jobs,
    listings,
    reviews,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id, status, total, created_at, updated_at, store_id, stores(name)")
      .eq("customer_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("bookings")
      .select(
        "id, status, service_name, requested_date, created_at, store_id, product_id, stores(name)",
      )
      .eq("customer_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("stay_bookings")
      .select(
        "id, status, check_in, check_out, grand_total, created_at, store_id, stores(name), accommodation_units(name, name_en)",
      )
      .eq("customer_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("rental_bookings")
      .select(
        "id, status, pickup_date, return_date, grand_total, created_at, store_id, stores(name), rental_vehicles(name, name_en)",
      )
      .eq("customer_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("event_tickets")
      .select(
        "id, status, quantity, created_at, store_id, stores(name), event_ticket_types(name, name_en)",
      )
      .eq("customer_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("service_requests")
      .select(
        "id, status, description, quote_amount, counter_amount, created_at, store_id, stores(name)",
      )
      .eq("customer_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("craft_requests")
      .select(
        "id, status, description, created_at, provider_id, craft_providers(name), craft_reviews(id)",
      )
      .eq("customer_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("leads")
      .select("id, status, kind, message, created_at, store_id, stores(name)")
      .eq("customer_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("job_applications")
      .select("id, created_at, job_id, job_postings(title, company_name)")
      .eq("applicant_id", uid)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("listings")
      .select("id, status, title, price, created_at, updated_at")
      .eq("seller_id", uid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    // Store reviews are one per customer per store (no order id), so "this
    // order still wants a review" means "you have not reviewed this store".
    supabase
      .from("reviews")
      .select("store_id")
      .eq("customer_id", uid)
      .is("deleted_at", null)
      .limit(200),
  ]);

  // A failed read of one kind drops that kind, never the whole screen.
  const rows = <T,>(r: { data: unknown; error: unknown }): T[] =>
    r.error ? [] : ((r.data ?? []) as T[]);

  const raw: RawActivity = {
    orders: rows(orders),
    bookings: rows(bookings),
    stays: rows(stays),
    rentals: rows(rentals),
    tickets: rows(tickets),
    services: rows(services),
    crafts: rows(crafts),
    leads: rows(leads),
    jobs: rows(jobs),
    listings: rows(listings),
    reviewedStoreIds: rows<{ store_id: string }>(reviews).map((r) => r.store_id),
  };

  return normaliseActivity(raw, lang, Date.now());
}

/**
 * The customer's activity, newest first.
 *
 * Memoised per request with React `cache`: the site layout calls this for the
 * tab badge on every page and the activity page calls it again for the list —
 * one set of reads serves both.
 */
export const getCustomerActivity = cache(fetchCustomerActivity);

/** What the tab badge shows: only what the customer themselves must act on. */
export function countNeedingCustomer(items: ActivityItem[]): number {
  return countPure(items);
}
