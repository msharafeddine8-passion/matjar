import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Bookmark, Heart, MessageCircle, Store as StoreIcon } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { dictSlice } from "@/lib/dict-slice";
import { createClient } from "@/lib/supabase/server";
import { getCustomerActivity } from "@/lib/data/activity";
import type { ActivityKind } from "@/lib/activity";
import { Container } from "@/components/ui/container";
import { ActivityList } from "@/components/activity-list";
import { RecentlyViewed } from "@/components/recently-viewed";
import { ACTIVITY_DOMAINS, labelMap } from "@/lib/status-labels";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// طلباتي — everything the customer started, all ten kinds, one screen; plus
// the ways back in: order/book/hire again, what they saved, what they looked
// at. This is the route the bottom tab points at.
//
// The tab keeps its name «طلباتي» and its URL: «طلب» is the everyday word for
// "something I asked for", every row states its own kind (حجز، إقامة، تذاكر،
// إعلان بالسوق…), and renaming the app's main tab days before launch would
// cost more recognition than it buys. The per-kind routes (/orders, /bookings,
// /crafts/requests, /inquiries/[id], /favorites…) all stay where they are —
// this screen links into them; nothing was moved, so nothing redirects.
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login?next=/${lang}/activity`);

  // All in parallel. getCustomerActivity is request-memoised, so the layout's
  // badge read and this list are the same set of queries. The saved counts are
  // head-only (no rows cross the wire) and filtered to the caller, on tables
  // whose RLS already returns only the caller's rows.
  const [dict, items, wish, follows, savedListings] = await Promise.all([
    getDictionary(lang),
    getCustomerActivity(lang),
    supabase
      .from("wishlist")
      .select("product_id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("follows")
      .select("store_id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("listing_favorites")
      .select("listing_id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);
  const t = dict.activity as unknown as Record<string, string>;
  const c = dict.activityCenter;

  // Each domain's own wording, resolved through lib/status-labels.ts. The
  // Record<ActivityKind, …> annotation is what makes TypeScript check that the
  // shared table covers every kind the data layer can produce.
  const statusLabels: Record<ActivityKind, Record<string, string>> = {
    order: labelMap(dict, ACTIVITY_DOMAINS.order),
    booking: labelMap(dict, ACTIVITY_DOMAINS.booking),
    stay: labelMap(dict, ACTIVITY_DOMAINS.stay),
    rental: labelMap(dict, ACTIVITY_DOMAINS.rental),
    ticket: labelMap(dict, ACTIVITY_DOMAINS.ticket),
    service: labelMap(dict, ACTIVITY_DOMAINS.service),
    craft: labelMap(dict, ACTIVITY_DOMAINS.craft),
    lead: labelMap(dict, ACTIVITY_DOMAINS.lead),
    job: labelMap(dict, ACTIVITY_DOMAINS.job),
    listing: labelMap(dict, ACTIVITY_DOMAINS.listing),
  };

  // Saved things: counts only where there is something, each opening the
  // screen that already manages it. No count is shown as 0 — an empty shelf
  // is not a shortcut.
  const saved = [
    {
      n: wish.count ?? 0,
      label: c.savedProducts,
      href: `/${lang}/favorites?tab=products`,
      Icon: Bookmark,
    },
    {
      n: follows.count ?? 0,
      label: c.followedStores,
      href: `/${lang}/favorites`,
      Icon: StoreIcon,
    },
    {
      n: savedListings.count ?? 0,
      label: c.savedListings,
      href: `/${lang}/favorites`,
      Icon: Heart,
    },
  ].filter((s) => s.n > 0);

  return (
    <div className="py-6 sm:py-10">
      <Container className="max-w-2xl">
        <h1 className="text-h1">{t.title}</h1>
        <p className="mt-1 text-caption">{c.subtitle}</p>

        <ActivityList
          items={items}
          lang={lang}
          labels={{ ...t, emptyHref: `/${lang}/explore` }}
          copy={c}
          statusLabels={statusLabels}
          leadKindLabels={labelMap(dict, "leadKind")}
          closeLabel={dict.common.close}
        />

        {/* ===== Saved + messages ===== */}
        <section className="mt-10" aria-labelledby="saved-title">
          <h2 id="saved-title" className="text-base font-extrabold">
            {c.savedTitle}
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {saved.map(({ n, label, href, Icon }) => (
              <li key={label}>
                <Link
                  href={href}
                  className="flex min-h-[var(--m-touch)] items-center gap-2 rounded-2xl border border-border bg-surface p-3 transition-colors active:bg-surface-muted"
                >
                  <Icon className="h-4.5 w-4.5 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block text-lg font-extrabold leading-none tabular-nums">
                      {n}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {label}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {/* Freelance project briefs have no table of their own — they are
                sent as a conversation (freelance/brief) — so their home is the
                inbox, and this is the door to it. */}
            <li>
              <Link
                href={`/${lang}/messages`}
                className="flex min-h-[var(--m-touch)] items-center gap-2 rounded-2xl border border-border bg-surface p-3 transition-colors active:bg-surface-muted"
              >
                <MessageCircle className="h-4.5 w-4.5 shrink-0 text-primary" />
                <span className="min-w-0 text-xs font-bold">{c.messages}</span>
              </Link>
            </li>
          </ul>
        </section>

        {/* Read-only here: nothing is being viewed on this screen, so nothing
            is recorded. Renders nothing when the device has no history. */}
        <RecentlyViewed
          lang={lang as Locale}
          dict={dictSlice(dict, ["product", "offering"])}
        />
      </Container>
    </div>
  );
}
