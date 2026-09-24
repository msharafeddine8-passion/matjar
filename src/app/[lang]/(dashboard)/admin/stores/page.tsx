import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  FETCH_BOUNDS,
  fetchAllByIds,
  fetchAllPages,
  warnIfTruncated,
} from "@/lib/data/bounds";
import { toCategoryKey } from "@/lib/catalog";
import {
  PRIMARY_ENTITY_SECTORS,
  validateStorePublic,
} from "@/lib/data-quality";
import { AdminStoresClient, type AdminStore } from "@/components/admin-stores-client";

type StoreRow = {
  id: string;
  name: string;
  owner_id: string;
  region: string | null;
  area: string | null;
  service_area: string | null;
  phone: string | null;
  whatsapp: string | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  status: "pending" | "active" | "suspended" | "rejected";
  plan: "free" | "basic" | "pro" | "business";
  is_verified: boolean;
  featured_until: string | null;
  commercial_reg_no: string | null;
  commercial_reg_verified: boolean;
  status_reason: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
  business_types: { slug: string; name_ar: string; name_en: string } | null;
};

export default async function AdminStoresPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("stores", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  // ISS-013. This select used to carry no `.limit()` and no `.range()`, which
  // reads as "all of them" and is not: PostgREST answers an unbounded select
  // with `db-max-rows` rows and calls it a success. At 1001 stores this page
  // would have shown 1000 and said nothing — on the screen whose entire job is
  // deciding which stores are live.
  //
  // Same shape as store-view.ts / market.ts rather than a second mechanism:
  // identical select, filter and order on every round trip, and `id` appended
  // to the order because `created_at` is not unique. Without that tiebreaker
  // `.range()` pages by position over an order the database may resolve either
  // way, so two stores created in the same second can land on both pages or on
  // neither — the failure mode that makes naive paging worse than no paging.
  const rows = await fetchAllPages<StoreRow>(
    (from, to) =>
      supabase
        .from("stores")
        .select(
          // area … cover_url and the type slug feed the data quality column
          // (lib/data-quality.ts); nothing else on this screen reads them.
          "id, name, owner_id, region, area, service_area, phone, whatsapp, description, logo_url, cover_url, status, plan, is_verified, featured_until, commercial_reg_no, commercial_reg_verified, status_reason, status_changed_at, status_changed_by, business_types(slug, name_ar, name_en)",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: StoreRow[] | null }>,
    FETCH_BOUNDS.adminStores,
    "stores (admin roster)",
  );

  // Catalogue size per store, for the "no offerings" flag. One bounded read of
  // store ids rather than a count per store; the same ceiling discovery.ts
  // uses for its catalogue facts. Sectors whose offering is not a product
  // (rooms, tickets, vehicles) are left uncounted so the rule skips them
  // instead of flagging every hotel as empty.
  const { data: productRows } = await supabase
    .from("products")
    .select("store_id")
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(FETCH_BOUNDS.allProducts);
  warnIfTruncated(productRows, FETCH_BOUNDS.allProducts, "products (admin roster)");
  const offeringsByStore = new Map<string, number>();
  for (const p of (productRows ?? []) as { store_id: string }[]) {
    offeringsByStore.set(p.store_id, (offeringsByStore.get(p.store_id) ?? 0) + 1);
  }

  // Resolve owner names in one round-trip. The admin who last set each status
  // rides along in the same lookup — "suspended by someone" is barely better
  // than "suspended", and a second query for a handful of ids is waste.
  const peopleIds = [
    ...new Set([
      ...rows.map((r) => r.owner_id),
      ...rows.map((r) => r.status_changed_by).filter((id): id is string => !!id),
    ]),
  ];
  const ownerMap = new Map<string, string>();
  if (peopleIds.length) {
    // The other half of ISS-013 on this page. `peopleIds` now scales with the
    // store count, and an `.in()` filter travels in the query string — a
    // thousand uuids is a ~40KB URL that a proxy rejects before the database
    // ever sees it. fetchAllByIds chunks the ids and pages each chunk, which is
    // what stores.ts already does for the follows lookup.
    type PersonRow = { id: string; full_name: string | null };
    const owners = await fetchAllByIds<PersonRow>(
      peopleIds,
      (chunk, from, to) =>
        supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: PersonRow[] | null;
        }>,
      FETCH_BOUNDS.adminStorePeople,
      "profiles (admin store roster)",
    );
    for (const o of owners) {
      if (o.full_name) ownerMap.set(o.id, o.full_name);
    }
  }

  const stores: AdminStore[] = rows.map((r) => {
    const sector = toCategoryKey(r.business_types?.slug, `store ${r.id}`);
    const quality = validateStorePublic(
      {
        name: r.name,
        category: r.business_types?.slug ?? null,
        area: r.area,
        service_area: r.service_area,
        region: r.region,
        phone: r.phone,
        whatsapp: r.whatsapp,
        description: r.description,
        logo_url: r.logo_url,
        cover_url: r.cover_url,
        offerings: PRIMARY_ENTITY_SECTORS.has(sector)
          ? undefined
          : (offeringsByStore.get(r.id) ?? 0),
      },
      { sector },
    );
    return {
    id: r.id,
    name: r.name,
    region: r.region,
    status: r.status,
    plan: r.plan,
    quality: { level: quality.level, issues: quality.issues.map((i) => i.code) },
    isVerified: r.is_verified,
    featuredUntil: r.featured_until,
    commercialRegNo: r.commercial_reg_no,
    commercialRegVerified: r.commercial_reg_verified,
    // NULL stays NULL all the way to the screen. Nothing here invents a reason
    // for the 20 stores suspended before there was anywhere to write one.
    statusReason: r.status_reason,
    statusChangedAt: r.status_changed_at,
    statusChangedByName: r.status_changed_by
      ? (ownerMap.get(r.status_changed_by) ?? null)
      : null,
    typeName: r.business_types
      ? lang === "ar"
        ? r.business_types.name_ar
        : r.business_types.name_en
      : null,
    ownerName: ownerMap.get(r.owner_id) ?? null,
    };
  });

  return <AdminStoresClient lang={lang} dict={dict} stores={stores} />;
}
