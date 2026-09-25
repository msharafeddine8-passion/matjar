"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import { oncePerSession, touchStore } from "@/lib/attribution-client";

const VID_KEY = "matjar-vid";

// A stable, random, non-identifying id kept in localStorage — lets the merchant
// see UNIQUE visitors without us storing anything personal about them.
function visitorId(): string {
  try {
    let v = localStorage.getItem(VID_KEY);
    if (!v) {
      v =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Math.floor(Math.random() * 1e12));
      localStorage.setItem(VID_KEY, v);
    }
    return v;
  } catch {
    return "";
  }
}

// Fire-and-forget visit log for a real storefront / product page. Powers the
// merchant "Audience" report (visits, sources, conversion). De-duped per
// (path + id) per browsing session so a back-and-forth doesn't inflate counts.
// No PII leaves the browser: only a random localStorage id and the referrer
// (bucketed into a coarse source server-side) are sent.
export function TrackVisit({
  storeId,
  productId = null,
  path,
}: {
  storeId: string;
  productId?: string | null;
  path: "store" | "product";
}) {
  useEffect(() => {
    // Skip automated agents so bot hits don't distort the numbers.
    if (typeof navigator !== "undefined" && navigator.webdriver) return;

    // Source attribution (first/last touch per store, 30 days) and the §34
    // view events ride on the same mount — every storefront and product page
    // already renders this, so nothing else had to be edited to get them.
    // Both are de-duplicated on their own terms and never throw.
    touchStore(storeId);
    if (path === "product" && productId) {
      oncePerSession(`matjar-evt-offering-${productId}`, () =>
        track("offering_viewed", { storeId, offeringId: productId, sourceSurface: "product" }),
      );
    } else if (path === "store") {
      oncePerSession(`matjar-evt-business-${storeId}`, () =>
        track("business_viewed", { storeId, sourceSurface: "store" }),
      );
    }

    const seenKey = `matjar-seen-${path}-${productId ?? storeId}`;
    try {
      if (sessionStorage.getItem(seenKey)) return;
      sessionStorage.setItem(seenKey, "1");
    } catch {
      /* sessionStorage unavailable — fall through and still record once */
    }

    const vid = visitorId();
    const referrer =
      typeof document !== "undefined" ? document.referrer : "";

    void createClient()
      .rpc("track_store_visit", {
        p_store_id: storeId,
        p_product_id: productId,
        p_path: path,
        p_referrer: referrer || null,
        p_visitor: vid || null,
      })
      // Analytics must never surface an error to the visitor.
      .then(() => {}, () => {});
  }, [storeId, productId, path]);

  return null;
}
