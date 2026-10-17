import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { PageHero } from "@/components/ui/page-hero";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkNotificationsRead } from "@/components/mark-notifications-read";

type Notif = {
  id: string;
  type: string;
  data: {
    store_id?: string;
    store_name?: string;
    product_id?: string;
    product_name?: string;
    old_price?: number | string;
    new_price?: number | string;
    listing_id?: string;
    conversation_id?: string;
    title?: string;
    body?: string;
    url?: string;
    name?: string;
    phone?: string;
    leader_id?: string;
    date?: string;
    time?: string;
    service_name?: string;
    owner_name?: string;
    trial_ends_at?: string;
    customer_name?: string;
    description?: string;
    /** Quote loop (0207): quoted / counter-offer amount and its note. */
    amount?: string | number;
    note?: string;
    /** Why a store was suspended or rejected (0282). Absent means no reason was
     *  recorded — the surfaces say so rather than printing nothing. */
    reason?: string;
    requested_plan?: string | null;
    /** Order status changes (0333): which order, its new status, the short
     *  reference the customer sees. */
    order_id?: string;
    status?: string;
    ref?: string;
  } | null;
  is_read: boolean;
  created_at: string;
};

// Notification types that are delivered to a user in their PLATFORM-ADMIN
// capacity (they fan out to every super_admin and are about other people's
// stores) — as opposed to the viewer's own orders, bookings, and messages.
// Tagged in the list so an admin who is also shopping can tell them apart.
const ADMIN_SCOPE_TYPES = new Set([
  "store_new",
  "pro_request",
  "leader_submission",
]);

// 0331: an upgrade request names its plan; requests from before that were
// always for Pro.
function requestedPlanName(plan: unknown): string {
  return plan === "basic" ? "Basic" : plan === "business" ? "Business" : "Pro";
}

// Relative time ("5 minutes ago" / "منذ ٥ دقائق"). Timezone-independent since
// it's a delta, so it's always correct regardless of server/client TZ.
function timeAgo(iso: string, lang: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
    numeric: "auto",
  });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) return rtf.format(-Math.round(diff / secs), unit);
  }
  return rtf.format(-diff, "second");
}

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  // Exclude `message` notifications: chat has its own inbox + unread badge, so
  // surfacing message events in the bell double-counts them ("notifications
  // showing up on my messages").
  const { data } = await supabase
    .from("notifications")
    .select("id, type, data, is_read, created_at")
    .eq("user_id", user.id)
    .neq("type", "message")
    .order("created_at", { ascending: false })
    .limit(50);
  const notifs = (data ?? []) as Notif[];

  const titleFor = (n: Notif) => {
    const t = n.type;
    if (t === "store_product") {
      const store = n.data?.store_name;
      return store
        ? dict.notifications.storeProductNamed.replace("{store}", store)
        : dict.notifications.storeProduct;
    }
    if (t === "price_drop") {
      return dict.notifications.priceDrop
        .replace("{product}", n.data?.product_name ?? "")
        .replace("{price}", String(n.data?.new_price ?? ""));
    }
    if (t === "pro_request") {
      return dict.notifications.proRequest
        .replace("{store}", n.data?.store_name ?? "")
        .replace("{plan}", requestedPlanName(n.data?.requested_plan));
    }
    // Merchant marketing campaign: the merchant authored the title/body; fall
    // back to a generic label when no title was given.
    if (t === "store_campaign") {
      return n.data?.title?.trim() || dict.notifications.storeCampaign;
    }
    // Platform broadcast (admin-authored title/body, e.g. daily rates).
    if (t === "admin_broadcast") {
      return n.data?.title?.trim() || dict.notifications.adminBroadcast;
    }
    if (t === "restock")
      return dict.notifications.restock.replace(
        "{product}",
        n.data?.product_name ?? "",
      );
    if (t === "store_transferred")
      return dict.notifications.storeTransferred.replace(
        "{store}",
        n.data?.store_name ?? "",
      );
    // A store outcome used to fall through to the bottom of this function and
    // render the raw type string — a merchant whose shop was switched off read
    // the literal words "store_suspended" in their own notification list. The
    // recorded reason (0282) rides along when there is one; when there is none,
    // the line stays as it is rather than trailing an empty dash.
    if (
      t === "store_approved" ||
      t === "store_rejected" ||
      t === "store_suspended"
    ) {
      const label =
        t === "store_approved"
          ? dict.notifications.storeApproved
          : t === "store_rejected"
            ? dict.notifications.storeRejected
            : dict.notifications.storeSuspended;
      const named = label.replace("{store}", n.data?.store_name ?? "");
      const why = n.data?.reason?.trim();
      return why ? `${named} — ${why}` : named;
    }
    if (t === "booking_placed") return dict.notifications.bookingPlaced;
    if (t === "booking_rescheduled")
      return `${dict.notifications.bookingRescheduled}${
        n.data?.date ? ` · ${n.data.date} ${n.data?.time ?? ""}` : ""
      }`;
    if (t === "booking_rescheduled_merchant")
      return `${dict.notifications.bookingRescheduledMerchant}${
        n.data?.date ? ` · ${n.data.date} ${n.data?.time ?? ""}` : ""
      }`;
    if (t === "booking_attendance_confirmed")
      return `${dict.notifications.bookingAttendanceConfirmed}${
        n.data?.date ? ` · ${n.data.date} ${n.data?.time ?? ""}` : ""
      }`;
    if (t === "booking_reminder")
      return `${dict.notifications.bookingReminder}${
        n.data?.date ? ` · ${n.data.date} ${n.data?.time ?? ""}` : ""
      }`;
    if (t === "booking_slot_freed")
      return `${dict.notifications.bookingSlotFreed}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "order_placed") return dict.notifications.orderPlaced;
    if (t === "booking_status_merchant")
      return dict.notifications.bookingStatusMerchant;
    // Order status changes say WHICH order and WHAT it became (0333 carries
    // status / ref / customer_name / store_name). Rows from before 0333 have
    // none of that and keep the generic line.
    if (t === "order_status_merchant" || t === "order_status") {
      const statusLabel = n.data?.status
        ? (dict.orders.status as Record<string, string>)[n.data.status]
        : undefined;
      const ref = n.data?.ref?.trim();
      if (!statusLabel || !ref) {
        return t === "order_status"
          ? dict.notifications.orderStatus
          : dict.notifications.orderStatusMerchant;
      }
      const head = (
        t === "order_status"
          ? dict.notifications.orderStatusCustomerTo
          : dict.notifications.orderStatusMerchantTo
      )
        .replace("{ref}", ref)
        .replace("{status}", statusLabel);
      const who =
        t === "order_status_merchant"
          ? n.data?.customer_name?.trim()
          : n.data?.store_name?.trim();
      return who ? `${head} · ${who}` : head;
    }
    // New booking/order for a merchant: name the store (they may own several)
    // and, for bookings, the service.
    if (t === "booking_new")
      return `${dict.notifications.bookingNew}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }${n.data?.service_name ? ` — ${n.data.service_name}` : ""}`;
    if (t === "order_new")
      return `${dict.notifications.orderNew}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "lead_new")
      return `${dict.notifications.leadNew}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    // Quote loop (0207): the customer had no way to learn a quote arrived.
    // Trial lifecycle (0208) — the merchant used to lose features with no warning.
    if (t === "trial_ending") return dict.notifications.trialEnding;
    if (t === "trial_ended") return dict.notifications.trialEnded;
    if (t === "service_quote")
      return `${dict.notifications.serviceQuote}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "service_countered") return dict.notifications.serviceCountered;
    if (t === "service_accepted") return dict.notifications.serviceAccepted;
    if (t === "service_declined")
      return `${dict.notifications.serviceDeclined}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "service_completed")
      return `${dict.notifications.serviceCompleted}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "service_request_new")
      return `${dict.notifications.serviceRequestNew}${
        n.data?.customer_name ? ` · ${n.data.customer_name}` : ""
      }`;
    if (t === "stay_new")
      return `${dict.notifications.stayNew}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "rental_new")
      return `${dict.notifications.rentalNew}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "membership_new")
      return `${dict.notifications.membershipNew}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "enroll_new")
      return `${dict.notifications.enrollNew}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    if (t === "ticket_new")
      return `${dict.notifications.ticketNew}${
        n.data?.store_name ? ` · ${n.data.store_name}` : ""
      }`;
    return t === "order_new"
      ? dict.notifications.orderNew
      : t === "order_status"
        ? dict.notifications.orderStatus
        : t === "booking_new"
          ? dict.notifications.bookingNew
          : t === "booking_status"
            ? dict.notifications.bookingStatus
            : t === "listing_approved"
                ? dict.notifications.listingApproved
                : t === "listing_rejected"
                  ? dict.notifications.listingRejected
                  : t === "listing_match"
                    ? dict.notifications.listingMatch
                    : t === "message"
                      ? dict.notifications.message
                      : t === "store_new"
                        ? dict.notifications.storeNew
                        : t === "pro_request"
                          ? `${dict.notifications.proRequestAdmin.replace("{plan}", requestedPlanName(n.data?.requested_plan))}${n.data?.store_name ? " · " + n.data.store_name : ""}`
                          : t === "leader_submission"
                            ? `${dict.notifications.leaderSubmission}${n.data?.name ? " · " + n.data.name : ""}`
                            : t;
  };

  // Campaigns carry an explicit destination in data.url (the store, an offer,
  // etc.); fall back to the store page.
  const linkFor = (n: Notif): string =>
    // A store outcome belongs on that store's own dashboard, which is where the
    // full explanation and the "contact us" path live. The public store page is
    // wrong for two of the three: it does not exist while a store is suspended.
    (n.type === "store_approved" ||
      n.type === "store_rejected" ||
      n.type === "store_suspended") &&
    n.data?.store_id
      ? `/${lang}/merchant/${n.data.store_id}`
      : n.type === "admin_broadcast"
      ? n.data?.url?.trim() || `/${lang}`
      : n.type === "store_campaign"
      ? n.data?.url?.trim() ||
        (n.data?.store_id
          ? `/${lang}/store/${n.data.store_id}`
          : `/${lang}/notifications`)
      : (n.type === "listing_approved" ||
      n.type === "listing_rejected" ||
      n.type === "listing_match") &&
    n.data?.listing_id
      ? n.type === "listing_rejected"
        ? `/${lang}/account`
        : `/${lang}/market/${n.data.listing_id}`
      : (n.type === "price_drop" || n.type === "restock") &&
          n.data?.product_id
        ? `/${lang}/product/${n.data.product_id}`
        : (n.type === "store_product" ||
              n.type === "booking_slot_freed") &&
            n.data?.store_id
        ? `/${lang}/store/${n.data.store_id}`
        : n.type === "pro_request"
          ? `/${lang}/admin/stores?q=${encodeURIComponent(n.data?.store_name ?? "")}`
          : n.type === "store_new"
          ? `/${lang}/admin/stores`
          : n.type === "leader_submission"
          ? `/${lang}/admin/leaders`
          : n.type === "message"
          ? n.data?.conversation_id
            ? `/${lang}/messages/${n.data.conversation_id}`
            : `/${lang}/messages`
          : n.type === "lead_new" && n.data?.store_id
          ? `/${lang}/merchant/${n.data.store_id}/leads`
          : (n.type === "trial_ending" || n.type === "trial_ended") &&
            n.data?.store_id
          ? `/${lang}/merchant/${n.data.store_id}/subscription`
          : (n.type === "service_quote" ||
              n.type === "service_declined" ||
              n.type === "service_completed") &&
            n.data?.store_id
          ? `/${lang}/store/${n.data.store_id}`
          : (n.type === "service_countered" || n.type === "service_accepted") &&
            n.data?.store_id
          ? `/${lang}/merchant/${n.data.store_id}/requests`
          : n.type === "service_request_new" && n.data?.store_id
          ? `/${lang}/merchant/${n.data.store_id}/requests`
          : n.type === "stay_new" && n.data?.store_id
          ? `/${lang}/merchant/${n.data.store_id}/stays`
          : n.type === "rental_new" && n.data?.store_id
          ? `/${lang}/merchant/${n.data.store_id}/rentals`
          : (n.type === "membership_new" || n.type === "enroll_new") &&
            n.data?.store_id
          ? `/${lang}/merchant/${n.data.store_id}/members`
          : n.type === "ticket_new" && n.data?.store_id
          ? `/${lang}/merchant/${n.data.store_id}/tickets`
          : (n.type === "booking_new" ||
              n.type === "booking_rescheduled_merchant" ||
              n.type === "booking_attendance_confirmed" ||
              n.type === "booking_status_merchant") &&
            n.data?.store_id
            ? `/${lang}/merchant/${n.data.store_id}/bookings`
          : (n.type === "order_new" || n.type === "order_status_merchant") &&
            n.data?.store_id
            ? `/${lang}/merchant/${n.data.store_id}/orders`
          : n.type === "order_new" ||
              n.type === "booking_new" ||
              n.type === "order_status_merchant" ||
              n.type === "booking_status_merchant" ||
              n.type === "booking_rescheduled_merchant" ||
              n.type === "booking_attendance_confirmed" ||
              n.type === "store_transferred"
            ? `/${lang}/merchant`
            : n.type === "order_status" && n.data?.order_id
              ? `/${lang}/orders/${n.data.order_id}`
            : n.type === "order_status" || n.type === "order_placed"
              ? `/${lang}/orders`
              : n.type === "booking_status" ||
                  n.type === "booking_placed" ||
                  n.type === "booking_rescheduled" ||
                  n.type === "booking_reminder"
                ? `/${lang}/bookings`
                : `/${lang}`;

  return (
    <div className="pb-16">
      <MarkNotificationsRead />
      <PageHero title={dict.notifications.title} icon={Bell} />
      <Container className="max-w-3xl py-8">
        {notifs.length ? (
          <div className="space-y-2">
            {notifs.map((n) => (
              <Link
                key={n.id}
                href={linkFor(n)}
                className={`flex items-start gap-3 rounded-2xl border p-4 transition-colors ${
                  n.is_read
                    ? "border-border bg-surface hover:border-primary/40"
                    : "border-primary/30 bg-primary-soft"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    n.is_read
                      ? "bg-surface-muted text-muted-foreground"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  <Bell className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {/* Platform-admin notifications (any store's signup / Pro
                        request / directory submission) land in the same personal
                        bell as the user's own orders and messages. Tag them so
                        it's obvious they arrived in an admin capacity and are
                        not about the viewer's own account. */}
                    {ADMIN_SCOPE_TYPES.has(n.type) && (
                      <span className="me-1.5 rounded-md bg-warning-soft px-1.5 py-0.5 align-middle text-[10px] font-bold text-warning">
                        {dict.notifications.adminScope}
                      </span>
                    )}
                    {titleFor(n)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {timeAgo(n.created_at, lang)}
                  </p>
                  {(n.type === "store_campaign" ||
                    n.type === "admin_broadcast") &&
                    n.data?.body?.trim() && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {n.data.body}
                      </p>
                    )}
                  {n.type === "pro_request" && (
                    <>
                      {n.data?.owner_name && (
                        <p className="mt-1 text-sm font-semibold">
                          {dict.notifications.requestedBy}: {n.data.owner_name}
                        </p>
                      )}
                      {n.data?.phone && (
                        <p
                          className="mt-1 text-sm font-semibold text-primary"
                          dir="ltr"
                        >
                          {dict.notifications.phoneLabel}: {n.data.phone}
                        </p>
                      )}
                      {n.data?.trial_ends_at && (
                        <p className="mt-1 text-sm font-semibold text-warning">
                          {new Date(n.data.trial_ends_at) > new Date()
                            ? dict.notifications.onTrialUntil.replace(
                                "{date}",
                                new Date(n.data.trial_ends_at).toLocaleDateString(
                                  lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB",
                                  { timeZone: "Asia/Beirut", dateStyle: "medium" },
                                ),
                              )
                            : dict.notifications.trialEnded}
                        </p>
                      )}
                    </>
                  )}
                  {(n.type === "service_quote" ||
                    n.type === "service_countered") && (
                    <>
                      {n.data?.amount != null && (
                        <p className="mt-1 font-bold text-primary">
                          ${String(n.data.amount)}
                        </p>
                      )}
                      {n.data?.note && (
                        <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
                          {n.data.note}
                        </p>
                      )}
                    </>
                  )}
                  {n.type === "service_request_new" && (
                    <>
                      {n.data?.description && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                          {n.data.description}
                        </p>
                      )}
                      {n.data?.phone && (
                        <p
                          className="mt-1 text-sm font-semibold text-primary"
                          dir="ltr"
                        >
                          {dict.notifications.phoneLabel}: {n.data.phone}
                        </p>
                      )}
                    </>
                  )}
                </div>
                {!n.is_read && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={Bell} title={dict.notifications.empty} />
        )}
      </Container>
    </div>
  );
}
