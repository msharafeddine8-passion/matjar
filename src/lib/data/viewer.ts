import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANONYMOUS,
  displayNameOf,
  normaliseRole,
  type MeResponse,
} from "@/lib/viewer";
import { countActionable } from "@/lib/viewer-badge";

// The fetching half of /api/me. Takes the client as an argument so the route
// handler passes the cookie-bound one and the unit test passes a fake.
//
// Every read is the caller's own rows: RLS returns a customer exactly their own
// rows, and each query ALSO filters on the caller's id (same rule as
// lib/data/activity.ts) so a merchant's store rows never count as their own.
//
// Cost per call: 1 auth call + one parallel round of small reads — head counts
// where the status alone decides, minimal columns (no embeds of names) where a
// date or review decides — plus the reviewed-stores RPC only when there is a
// completed order that could still want a review. The old layout ran the full
// eleven-table activity list on EVERY navigation for the same number.

/** Rows per kind, matching lib/data/activity.ts. */
const PER_KIND = 50;

type Res<T> = { data: T | null; error: unknown; count?: number | null };

const rowsOf = <T,>(r: Res<T[]>): T[] => (r.error ? [] : (r.data ?? []));
const countOf = (r: Res<unknown>): number =>
  r.error ? 0 : Math.max(0, r.count ?? 0);

export async function loadMe(
  supabase: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<MeResponse> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return ANONYMOUS;
  const uid = user.id;

  const [
    profile,
    notifs,
    msgs,
    orders,
    bookings,
    stays,
    rentals,
    crafts,
    services,
    listings,
  ] = await Promise.all([
    supabase.from("profiles").select("role, is_active").eq("id", uid).maybeSingle(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .eq("is_read", false)
      .neq("type", "message"),
    supabase.rpc("unread_conversation_count"),
    supabase
      .from("orders")
      .select("status, store_id, updated_at")
      .eq("customer_id", uid)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("bookings")
      .select("status, requested_date")
      .eq("customer_id", uid)
      .in("status", ["accepted", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("stay_bookings")
      .select("status, check_in, check_out")
      .eq("customer_id", uid)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("rental_bookings")
      .select("status, pickup_date, return_date")
      .eq("customer_id", uid)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("craft_requests")
      .select("status, craft_reviews(id)")
      .eq("customer_id", uid)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(PER_KIND),
    supabase
      .from("service_requests")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", uid)
      .eq("status", "quoted"),
    supabase
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", uid)
      .eq("status", "rejected")
      .is("deleted_at", null),
  ]);

  const orderRows = rowsOf(
    orders as Res<{ status: string; store_id: string | null; updated_at: string | null }[]>,
  );

  // Only worth asking which stores are reviewed when an order could want one.
  let reviewedStoreIds: string[] = [];
  if (orderRows.some((o) => o.store_id)) {
    const r = (await supabase.rpc("my_reviewed_store_ids")) as Res<
      (string | { my_reviewed_store_ids: string })[]
    >;
    reviewedStoreIds = rowsOf(r)
      .map((v) => (typeof v === "string" ? v : v?.my_reviewed_store_ids))
      .filter((v): v is string => typeof v === "string");
  }

  const p = (profile as Res<{ role?: string | null; is_active?: boolean | null }>)
    .data;
  const msgCount = (msgs as Res<number>).error ? 0 : (msgs.data as number | null);

  return {
    signedIn: true,
    id: uid,
    name: displayNameOf(user),
    role: normaliseRole(p?.role),
    suspended: p?.is_active === false,
    unreadNotifications: countOf(notifs as Res<unknown>),
    unreadMessages:
      typeof msgCount === "number" && msgCount > 0 ? Math.floor(msgCount) : 0,
    activityCount: countActionable(
      {
        orders: orderRows,
        bookings: rowsOf(
          bookings as Res<{ status: string; requested_date: string | null }[]>,
        ),
        stays: rowsOf(
          stays as Res<
            { status: string; check_in: string | null; check_out: string | null }[]
          >,
        ),
        rentals: rowsOf(
          rentals as Res<
            {
              status: string;
              pickup_date: string | null;
              return_date: string | null;
            }[]
          >,
        ),
        crafts: rowsOf(
          crafts as Res<
            {
              status: string;
              craft_reviews?: { id: string }[] | { id: string } | null;
            }[]
          >,
        ),
        quotedServices: countOf(services as Res<unknown>),
        rejectedListings: countOf(listings as Res<unknown>),
        reviewedStoreIds,
      },
      nowMs,
    ),
  };
}
