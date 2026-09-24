"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import {
  toCategoryKey,
  type RegionKey,
  type Store,
} from "@/lib/catalog";
import { isOpenNow, parseHours } from "@/lib/hours";
import type { StorePlan } from "@/lib/plan-tiers";
import { Container } from "@/components/ui/container";
import { StoreCard } from "@/components/store-card";

// Shape returned by the recommended_stores RPC (migration 0098).
type RecommendedRow = {
  id: string;
  name: string;
  area: string | null;
  region: string | null;
  plan: StorePlan | null;
  is_verified: boolean | null;
  commercial_reg_verified: boolean | null;
  featured_until: string | null;
  logo_url: string | null;
  cover_url: string | null;
  cover_position?: number | null;
  lat: number | string | null;
  lng: number | string | null;
  hours: unknown;
  rating_avg: number | string | null;
  rating_count: number | null;
  category: string | null;
};

// Maps an RPC row into the Store shape StoreCard consumes. Mirrors rowToStore in
// src/lib/data/stores.ts so the card looks identical to every other strip.
function rowToStore(row: RecommendedRow): Store {
  const ratingAvg = row.rating_avg != null ? Number(row.rating_avg) : 0;
  const open = isOpenNow(parseHours(row.hours), new Date());
  return {
    id: row.id,
    name: { ar: row.name, en: row.name },
    area: { ar: row.area ?? "", en: row.area ?? "" },
    region: (row.region as RegionKey) ?? undefined,
    category: toCategoryKey(row.category, `store ${row.id}`),
    isOpen: open ?? true,
    plan: row.plan ?? "free",
    verified: row.is_verified ?? false,
    registered: row.commercial_reg_verified ?? false,
    rating: ratingAvg > 0 ? ratingAvg : undefined,
    reviews: row.rating_count != null ? Number(row.rating_count) : 0,
    featured:
      row.featured_until != null && new Date(row.featured_until) > new Date(),
    logoUrl: row.logo_url,
    coverUrl: row.cover_url,
    coverPosition: row.cover_position ?? 50,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    // Recommendations are stores the user does NOT follow, by definition.
    favorited: false,
  };
}

// Per-user "For you" strip. This is a CLIENT island on purpose: it fetches its
// data in the browser after load via the recommended_stores RPC, so the
// homepage server component adds ZERO per-user reads and stays cacheable.
// Signed-out visitors and users with no follows/orders render nothing.
export function ForYouStrip({
  lang,
  dict,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "home" | "catalog" | "explore" | "featured" | "trust">;
}) {
  const [stores, setStores] = useState<Store[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();

      // Ask only when there is somebody to recommend to. `recommended_stores`
      // is revoked from anon (migration 0098:95), so calling it signed-out is
      // not "returns empty" as the old comment here claimed — it is a
      // guaranteed 401 plus a console error, on every logged-out view of the
      // busiest page on the site. A permanent error on the homepage is exactly
      // where a real one goes unnoticed. getSession() reads the local cookie
      // and makes no network request, so the guard costs nothing.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;
      if (!session) {
        setStores([]);
        return;
      }

      const { data, error } = await supabase.rpc("recommended_stores", {
        p_limit: 8,
      });
      if (!active) return;
      if (error || !data) {
        setStores([]);
        return;
      }
      setStores((data as RecommendedRow[]).map(rowToStore));
    })();
    return () => {
      active = false;
    };
  }, []);

  // Nothing to show (still loading, anon, or no engagement history) -> hide the
  // whole section so it never leaves an empty gap on the page.
  if (!stores || stores.length === 0) return null;

  // Title comes from dict.home.forYou (reported separately for translation).
  // Defensive access + fallback so the component compiles/renders before the
  // key lands in the dictionaries.
  const home = (dict as unknown as {
    home?: { forYou?: string; forYouSubtitle?: string };
  }).home;
  const title = home?.forYou ?? (lang === "ar" ? "مختارة لك" : "For you");
  const subtitle =
    home?.forYouSubtitle ??
    (lang === "ar"
      ? "متاجر نعتقد أنها تناسب ذوقك بناءً على متابعاتك وطلباتك."
      : "Stores we think you'll love, based on who you follow and order from.");

  return (
    <section className="py-10 sm:py-16">
      <Container>
        <div className="mb-8">
          <h2 className="text-3xl font-extrabold tracking-tight">{title}</h2>
          <p className="mt-2 text-muted-foreground">{subtitle}</p>
        </div>

        {/* Horizontal strip: scrolls on every width (RTL-safe — flex direction
            and logical start/end props flip automatically under dir="rtl"). */}
        <div className="-mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {stores.map((store) => (
            <div
              key={store.id}
              className="w-[280px] shrink-0 snap-start sm:w-[300px]"
            >
              <StoreCard store={store} lang={lang} dict={dict} />
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
