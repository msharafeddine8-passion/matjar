// Which columns of public.stores each database role may SELECT (migration 0314).
//
// Until 0314, anon and authenticated held a TABLE-level SELECT on stores, so a
// logged-out visitor could read every one of the 71 columns of every active
// store — tax number, legal name and address, commercial register number, the
// admin's suspension note. 0314 replaces that with COLUMN-level grants. These
// lists are the single statement of what each role gets; three things are
// checked against them so they cannot drift apart:
//
//   * the grant lists in supabase/migrations/0314_privacy_hardening.sql
//     (src/lib/__tests__/store-column-grants.test.ts parses the SQL);
//   * every `stores` select, filter and embed in src/ (the same test scans the
//     source: a public page that names a column outside STORE_ANON_COLUMNS, or
//     any page that names a STORE_PRIVATE_COLUMNS column, fails the build's
//     test run instead of failing on the live storefront with 42501);
//   * supabase/tests/0314_privacy_hardening.test.sql, which runs a SELECT of
//     every anon column AS anon, so a missing grant fails before the apply.
//
// ADDING A COLUMN TO stores AFTER 0314: a table-level grant no longer covers
// it. A column the public site reads needs `grant select (col) on
// public.stores to anon, authenticated;` in its migration AND a line here; a
// dashboard-only column needs the grant to authenticated only.

/** Every column of public.stores, in table order (production, 2026-09-28). */
export const STORE_ALL_COLUMNS = [
  "id", "owner_id", "business_type_id", "name", "slug", "description",
  "logo_url", "cover_url", "phone", "whatsapp", "region", "area", "address",
  "status", "plan", "is_verified", "created_at", "updated_at", "deleted_at",
  "opening_hours", "instagram", "facebook", "website", "accepts_delivery",
  "accepts_pickup", "min_order", "prep_time", "payment_note", "specialties",
  "insurance", "lat", "lng", "short_code", "featured_until",
  "commercial_reg_no", "commercial_reg_verified", "hours",
  "booking_slot_minutes", "service_area", "rating_avg", "rating_count",
  "loyalty_redemption_enabled", "loyalty_points_per_unit", "trial_ends_at",
  "accent_color", "storefront_layout", "announcement", "storefront_theme",
  "booking_cancel_hours", "legal_name", "tax_no", "legal_address", "vat_rate",
  "vat_inclusive", "invoice_prefix", "invoice_next_no", "cover_position",
  "credit_note_next_no", "books_locked_until", "clock_radius_m",
  "late_grace_minutes", "auto_close_hours", "status_reason",
  "status_changed_at", "status_changed_by", "request_intake",
  "branch_stock_separate", "return_policy", "shipping_policy",
  "google_feed_enabled", "google_feed_enabled_at",
] as const;

export type StoreColumn = (typeof STORE_ALL_COLUMNS)[number];

/**
 * What a logged-out visitor may read: exactly the columns the public site
 * selects, filters or joins on, and nothing else.
 *
 * Three entries are here for reasons that are not "a page shows it":
 *   owner_id         — RLS policies on products, orders, bookings, order_items,
 *                      store_staff … and the invoker helpers can_manage_store,
 *                      staff_can and is_store_owner run
 *                      `exists (select 1 from stores s where s.owner_id = …)`
 *                      AS THE CALLER. Postgres checks column privileges inside
 *                      those subqueries, so without this grant every anonymous
 *                      product read fails with 42501.
 *   business_type_id — PostgREST joins business_types(...) through it.
 *   trial_ends_at    — the Google feed route (anon) decides the effective plan.
 */
export const STORE_ANON_COLUMNS = [
  "id", "owner_id", "business_type_id", "name", "slug", "description",
  "logo_url", "cover_url", "cover_position", "phone", "whatsapp", "region",
  "area", "service_area", "status", "plan", "trial_ends_at", "is_verified",
  "commercial_reg_verified", "featured_until", "created_at", "updated_at",
  "deleted_at", "hours", "booking_slot_minutes", "booking_cancel_hours",
  "instagram", "facebook", "website", "accepts_delivery", "accepts_pickup",
  "min_order", "prep_time", "payment_note", "specialties", "insurance", "lat",
  "lng", "short_code", "rating_avg", "rating_count",
  "loyalty_redemption_enabled", "loyalty_points_per_unit", "accent_color",
  "storefront_layout", "announcement", "storefront_theme", "return_policy",
  "shipping_policy", "google_feed_enabled", "request_intake",
] as const satisfies readonly StoreColumn[];

/**
 * Revoked from EVERY client role, signed in or not. The owner, their staff and
 * admins read these through public.store_private_fields(uuid[]) (0314), a
 * SECURITY DEFINER getter scoped per row — see src/lib/store-private.ts.
 * invoice_next_no / credit_note_next_no are read only inside definer
 * functions (issue_invoice …), and address by nothing at all.
 */
export const STORE_PRIVATE_COLUMNS = [
  "legal_name", "tax_no", "legal_address", "commercial_reg_no",
  "invoice_prefix", "invoice_next_no", "credit_note_next_no", "status_reason",
  "status_changed_by", "address",
] as const satisfies readonly StoreColumn[];

const PRIVATE = new Set<string>(STORE_PRIVATE_COLUMNS);

/** What any signed-in account may read: everything except the private set.
 *  The dashboard's own-store screens (HR radius, books lock, plan, trial …)
 *  run under the user's session and read these directly. */
export const STORE_AUTHENTICATED_COLUMNS: readonly StoreColumn[] =
  STORE_ALL_COLUMNS.filter((c) => !PRIVATE.has(c));

/**
 * public.store_verifications (P2-PRIV-03). anon gets what the storefront's
 * trust section renders; signed-in accounts additionally keep what the
 * merchant and admin review screens read — never reviewed_by (which admin).
 */
export const VERIFICATION_ANON_COLUMNS = [
  "id", "store_id", "kind", "title", "issuer", "issued_on", "expires_on",
  "status", "created_at",
] as const;

export const VERIFICATION_AUTHENTICATED_COLUMNS = [
  ...VERIFICATION_ANON_COLUMNS,
  "number", "verify_url", "updated_at", "reviewed_at", "rejection_reason",
] as const;
