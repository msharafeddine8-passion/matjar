"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics";
import { currentStore, notePath } from "@/lib/attribution-client";
import { firstSegment } from "@/lib/attribution";

// Mounted once, in src/app/[lang]/layout.tsx. Two small jobs, both
// fire-and-forget, both invisible:
//
// 1. Remembers the last two pathnames this tab showed, so a store page can
//    tell that its visitor arrived from /search, /map, /market… (the internal
//    half of source attribution — see resolveSource in src/lib/attribution.ts).
//    usePathname only; never useSearchParams, which would opt every page out
//    of static rendering (vercel-cost-guard).
//
// 2. contact_clicked. The storefront's WhatsApp and phone links are rendered
//    by several components (the store header, the sticky CTA, branches, the
//    store page itself), so instead of editing each one, a single delegated
//    listener counts a click on a wa.me / whatsapp / tel: link — but only on
//    the page a store was just viewed on (TrackVisit marks it), so a merchant
//    messaging a customer from the dashboard is never counted.
export function AttributionCapture() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) notePath(pathname);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      try {
        const target = e.target as Element | null;
        const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute("href") ?? "";
        const channel = /^tel:/i.test(href)
          ? "tel"
          : /^https?:\/\/(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com)\//i.test(href)
            ? "whatsapp"
            : null;
        if (!channel) return;
        const store = currentStore();
        if (!store || store.path !== location.pathname) return;
        const surface = firstSegment(location.pathname) === "product" ? "product" : "store";
        track("contact_clicked", {
          storeId: store.id,
          sourceSurface: `${surface}:${channel}`,
        });
      } catch {
        /* analytics never surfaces an error */
      }
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
