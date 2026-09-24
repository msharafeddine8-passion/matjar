"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { toCategoryKey } from "@/lib/catalog";
import type { OfferingKind } from "@/lib/offering";
import { ProductMiniCard } from "@/components/product-mini-card";

const KEY = "matjar-recent";
const MAX = 12;

type Row = {
  id: string;
  name: string;
  nameEn: string | null;
  price: number;
  discountPrice: number | null;
  imageUrl: string | null;
  storeName: string;
  /** Resolver inputs: a recently viewed أشعة must come back as a service. */
  itemKind: OfferingKind;
  category: ReturnType<typeof toCategoryKey>;
  durationMinutes: number | null;
};

// Records the current product in localStorage and shows the previously viewed
// ones — lightweight personalization, no account or server state needed.
export function RecentlyViewed({
  currentId,
  lang,
  dict,
}: {
  currentId: string;
  lang: Locale;
  dict: Dictionary;
}) {
  const [items, setItems] = useState<Row[]>([]);

  useEffect(() => {
    let ids: string[] = [];
    try {
      ids = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      ids = [];
    }
    const others = ids.filter((id) => id !== currentId).slice(0, MAX);
    // Record the current product at the front for next time.
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify([currentId, ...others].slice(0, MAX)),
      );
    } catch {
      /* ignore */
    }
    if (others.length === 0) return;

    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("products")
        .select(
          "id, name, name_en, price, discount_price, image_url, item_kind, duration_minutes, stores(name, business_types(slug))",
        )
        .in("id", others)
        .eq("status", "active")
        .eq("is_available", true)
        .is("deleted_at", null);
      const map = new Map(
        ((data ?? []) as unknown as {
          id: string;
          name: string;
          name_en: string | null;
          price: number;
          discount_price: number | null;
          image_url: string | null;
          item_kind: string | null;
          duration_minutes: number | null;
          stores: {
            name: string;
            business_types: { slug: string } | null;
          } | null;
        }[]).map((r) => [
          r.id,
          {
            id: r.id,
            name: r.name,
            nameEn: r.name_en,
            price: Number(r.price),
            discountPrice: r.discount_price != null ? Number(r.discount_price) : null,
            imageUrl: r.image_url,
            storeName: r.stores?.name ?? "",
            itemKind: (r.item_kind ?? "product") as OfferingKind,
            category: toCategoryKey(
              r.stores?.business_types?.slug,
              `recently viewed ${r.id}`,
            ),
            durationMinutes:
              r.duration_minutes != null ? Number(r.duration_minutes) : null,
          } as Row,
        ]),
      );
      // Preserve recency order.
      setItems(others.map((id) => map.get(id)).filter(Boolean) as Row[]);
    })();
  }, [currentId]);

  if (items.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
        <History className="h-5 w-5 text-primary" />
        {dict.product.recentlyViewed}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((p) => (
          <ProductMiniCard
            key={p.id}
            lang={lang}
            id={p.id}
            name={p.name}
            nameEn={p.nameEn}
            price={p.price}
            discountPrice={p.discountPrice}
            imageUrl={p.imageUrl}
            storeName={p.storeName}
            offering={{
              itemKind: p.itemKind,
              category: p.category,
              durationMinutes: p.durationMinutes,
            }}
            copy={dict.offering}
          />
        ))}
      </div>
    </section>
  );
}
