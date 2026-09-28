import { requestNow } from "@/lib/now";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { toCategoryKey } from "@/lib/catalog";
import {
  getSector,
  OS_GROUPS,
  OS_MODULE_META,
  sectorTeamMeta,
  type OsModuleKey,
} from "@/lib/sectors";
import {
  hasPlan,
  planRank,
  effectivePlan as resolvePlan,
} from "@/lib/plan-tiers";
import { isOpenNow, parseHours } from "@/lib/hours";
import type { MerchantNavItem } from "@/components/merchant/merchant-bottom-nav";
import { MerchantModeBar } from "@/components/merchant/merchant-mode-bar";
import {
  MerchantSidebar,
  type SidebarNav,
} from "@/components/merchant-sidebar";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Modules that live pinned at the sidebar's bottom (Shopify-style: settings
// and account concerns sit below the fold, out of the daily-work groups).
const PINNED: OsModuleKey[] = ["subscription", "settings", "edit"];

// ===== Matjar Business OS — store shell =====
// Wraps every /merchant/[storeId]/* page with the persistent sidebar. Guards
// once (auth + manage rights), resolves the sector, and hands the sidebar a
// fully serializable nav model — labels resolved here on the server so the
// client bundle never ships the dictionaries.
export default async function StoreOsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: canManage } = await supabase.rpc("can_manage_store", {
    p_store_id: storeId,
  });
  if (!canManage) redirect(`/${lang}/merchant`);

  const { data: store } = await supabase
    .from("stores")
    .select(
      // `hours` rides along on the row the layout already fetches: the mode bar
      // states the shop's open/closed status on every dashboard screen, and it
      // is derived from this column exactly as the storefront derives it.
      "id, name, slug, owner_id, plan, trial_ends_at, logo_url, hours, business_types(slug)",
    )
    .eq("id", storeId)
    .maybeSingle();
  if (!store) redirect(`/${lang}/merchant`);

  const s = store as unknown as {
    id: string;
    name: string;
    slug: string | null;
    owner_id: string;
    plan: string | null;
    trial_ends_at: string | null;
    logo_url: string | null;
    hours: unknown;
    business_types: { slug: string } | null;
  };
  // Effective plan mirrors getStorePlan: an active 14-day trial counts as Pro,
  // so the sidebar never shows a lock on a module the page will actually open.
  const trialEnds = s.trial_ends_at ? new Date(s.trial_ends_at) : null;
  const onTrial = trialEnds != null && trialEnds > new Date();
  const trialDaysLeft = onTrial
    ? Math.max(
        1,
        Math.ceil((trialEnds!.getTime() - requestNow()) / 86_400_000),
      )
    : 0;
  const effectivePlan = resolvePlan(s.plan, s.trial_ends_at);
  const category = toCategoryKey(s.business_types?.slug, `store ${storeId}`);
  const sector = getSector(category);

  // Owner sees every module; staff only what they were granted.
  const isOwner = s.owner_id === user.id;
  let perms: Record<string, boolean> = {};
  if (!isOwner) {
    const { data: staffRow } = await supabase
      .from("store_staff")
      .select("permissions")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle();
    perms = (staffRow?.permissions as Record<string, boolean> | null) ?? {};
  }
  const canSee = (key: OsModuleKey) => {
    const meta = OS_MODULE_META[key];
    if (isOwner) return true;
    if (meta.ownerOnly) return false;
    return meta.perm ? (perms[meta.perm] ?? false) : true;
  };

  // Same label mapping as the OS home — every string is an existing dict key.
  const moduleLabel: Record<OsModuleKey, string> = {
    orders: dict.merchant.ordersLink,
    bookings: dict.merchant.bookingsLink,
    resources: dict.resources.link,
    memberships: dict.memberships.link,
    classes: dict.classes.link,
    portfolio: dict.portfolio.link,
    courses: dict.courses.link,
    tools: dict.hub.toolsTitle,
    requests: dict.os.requests.link,
    leads: dict.os.leads.link,
    units: dict.os.units.link,
    stays: dict.os.stays.link,
    vehicles: dict.os.vehicles.link,
    rentals: dict.os.rentals.link,
    tickets: dict.os.tickets.link,
    members: dict.os.members.link,
    items: dict.store[sector.flow.itemsKey],
    // The roster module is keyed `doctors` in the registry (so is its table and
    // its route) but a salon does not have doctors. The sector registry decides
    // the word; the key stays where the data is.
    doctors: dict.os.team[sectorTeamMeta(category).labelKey],
    customers: dict.os.nouns[sector.customersNoun],
    ledger: dict.ledger.nav,
    campaigns: dict.os.campaigns.link,
    staff: dict.merchant.staffLink,
    hr: dict.os.hr.title,
    automations: dict.os.automations.link,
    tasks: dict.os.tasks.link,
    inventory: dict.os.inventory.link,
    pos: dict.os.pos.link,
    suppliers: dict.os.suppliers.link,
    kitchen: dict.os.kitchen.link,
    reports: dict.merchant.analytics.link,
    accounting: dict.merchant.accounting.link,
    coupons: dict.merchant.coupons.link,
    subscription: dict.merchant.subscriptionLink,
    branches: dict.os.branches.link,
    verifications: dict.verifications.link,
    modules: dict.os.modules.heading,
    settings: dict.merchant.settingsLink,
    edit: dict.merchant.edit,
  };

  const base = `/${lang}/merchant/${storeId}`;
  /** A module this store's plan will not open — the page re-gates regardless. */
  const isLocked = (key: OsModuleKey) => {
    const meta = OS_MODULE_META[key];
    return !!meta.minPlan && !hasPlan(effectivePlan, meta.minPlan);
  };
  const toItem = (key: OsModuleKey) => ({
    key,
    label: moduleLabel[key],
    href: `${base}/${OS_MODULE_META[key].path}`,
    locked: isLocked(key),
  });

  // ISS-004/005: a free store's rail listed 13 padlocks interleaved with its 7
  // working tools, four groups deep. A row you cannot open is not navigation —
  // it is an advertisement, and thirteen of them scattered through the nav read
  // as a paywall rather than as a product. The locks stay (these are shipped
  // features, and hiding them outright would misrepresent what the plan buys)
  // but they are collected into ONE labelled section at the end of the nav,
  // stated as what the plan adds. A store on a plan that opens everything sees
  // no change at all, because it has nothing to collect.
  const visibleModules = OS_GROUPS.flatMap((group) =>
    sector.modules[group].filter((key) => !PINNED.includes(key)).filter(canSee),
  );

  const nav: SidebarNav = {
    home: { key: "home", label: dict.dashboard.panel, href: base, exact: true },
    groups: OS_GROUPS.map((group) => ({
      key: group,
      label: dict.os.groups[group],
      items: sector.modules[group]
        .filter((key) => !PINNED.includes(key))
        .filter(canSee)
        .filter((key) => !isLocked(key))
        .map(toItem),
    })).filter((group) => group.items.length > 0),
    advanced: {
      label: dict.os.nextStep.advancedTools,
      hint: dict.os.nextStep.advancedToolsHint,
      items: visibleModules.filter(isLocked).map(toItem),
    },
    pinned: PINNED.filter(canSee).map(toItem),
    backLabel: dict.merchant.products.back,
    supportLabel: dict.common.supportWhatsapp,
    viewStoreLabel: dict.os.viewPublic,
    proBadge: dict.os.pro.badge,
    freeBadge: dict.merchant.subscription.free,
    trialBadge: dict.os.pro.trialBadge.replace("{days}", String(trialDaysLeft)),
  };


  // ---- Phone bottom navigation ------------------------------------------
  // Five slots, fixed in this order: home · operations · catalogue · customers
  // · more. That is the redesign brief's الرئيسية · الطلبات · منتجاتي · زبائني
  // · المزيد — but WHICH module fills the middle three is resolved from the
  // sector, not hardcoded, because sectors.ts already knows that a clinic's
  // operations module is bookings and its customers are patients. Hardcoding
  // the words would print "منتجاتي" over a hotel's room list.
  //
  // Two gates, both the sidebar's own: `canSee` (a staff member never gets a
  // tab they would be redirected out of) and `isLocked` (a tab that opens a
  // paywall is an advertisement in the most valuable strip of the phone, which
  // is the mistake ISS-004/005 records).
  const sectorModules = new Set(OS_GROUPS.flatMap((g) => sector.modules[g]));
  const firstVisible = (candidates: OsModuleKey[]) =>
    candidates.find(
      (k) => sectorModules.has(k) && canSee(k) && !isLocked(k),
    );

  // Order matters: the first match wins, so the most operational module for
  // that sector leads. "stays" and "tickets" are here because a hotel and an
  // events organiser have no orders or bookings table driving their day —
  // leaving them out gave those two sectors no operations tab at all, which
  // the per-sector resolution check caught.
  const opsKey = firstVisible([
    "orders",
    "bookings",
    "stays",
    "tickets",
    "requests",
    "leads",
  ]);
  const catalogKey = firstVisible([
    "items",
    "units",
    "resources",
    "classes",
    "courses",
  ]);
  // `customers` is a Pro module (OS_MODULE_META), so on a free store past its
  // trial this slot resolves to nothing rather than to a padlock, and the bar
  // renders four tabs. `members` and `leads` are the sector-equivalent people
  // lists for a gym and an agency.
  const peopleKey = firstVisible(["customers", "members", "leads"]);

  // Only the operations tab carries a badge, and only from a real count of
  // work actually awaiting the merchant — orders in `pending`, the status the
  // accept button clears. A number they cannot clear would be worse than none,
  // so a sector whose operations module is not orders gets no badge rather
  // than a plausible-looking one.
  let opsBadge = 0;
  if (opsKey === "orders") {
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("status", "pending");
    opsBadge = count ?? 0;
  }

  // The brief's own words for the two slots where the sector's word IS the
  // generic one; anywhere else the sector keeps its vocabulary (المرضى، الغرف).
  const opsLabel =
    opsKey === "orders" ? dict.merchant.mobile.navOrders : opsKey ? moduleLabel[opsKey] : "";
  const catalogLabel =
    catalogKey === "items"
      ? dict.merchant.mobile.navItems
      : catalogKey
        ? moduleLabel[catalogKey]
        : "";
  const peopleLabel =
    peopleKey === "customers" && sector.customersNoun === "customers"
      ? dict.merchant.mobile.navCustomers
      : peopleKey
        ? moduleLabel[peopleKey]
        : "";

  const tabs: MerchantNavItem[] = [
    { key: "home", label: dict.merchant.mobile.navHome, href: base },
    ...(opsKey
      ? [
          {
            key: opsKey,
            label: opsLabel,
            href: `${base}/${OS_MODULE_META[opsKey].path}`,
            badge: opsBadge,
          },
        ]
      : []),
    ...(catalogKey
      ? [
          {
            key: catalogKey,
            label: catalogLabel,
            href: `${base}/${OS_MODULE_META[catalogKey].path}`,
          },
        ]
      : []),
    ...(peopleKey
      ? [
          {
            key: peopleKey,
            label: peopleLabel,
            href: `${base}/${OS_MODULE_META[peopleKey].path}`,
          },
        ]
      : []),
    { key: "more", label: dict.merchant.mobile.navMore },
  ];

  // The shop's real open/closed state, derived from its weekly hours grid the
  // same way the storefront header, /explore and the for-you strip derive it.
  // null = no hours configured, which the bar says out loud rather than
  // guessing. Read through requestNow() so every consumer in this request
  // agrees on the instant.
  const openNow = isOpenNow(parseHours(s.hours), new Date(requestNow()));

  return (
    // One breakpoint decides which shell the merchant gets: below lg the mode
    // bar + bottom nav + drawer, from lg the rail beside the content.
    <div className="flex flex-col lg:flex-row">
      <MerchantModeBar
        storeName={s.name}
        open={openNow}
        chipLabel={dict.merchant.mobile.modeChip}
        openLabel={dict.os.hours.openNow}
        closedLabel={dict.os.hours.closedNow}
        unknownLabel={dict.merchant.mobile.hoursUnknown}
        hoursNote={dict.merchant.mobile.hoursNote}
        hoursUnsetNote={dict.merchant.mobile.hoursUnset}
        // The weekly hours grid lives on the store edit screen — the one place
        // that actually decides open/closed. Owner-only, and a staff member
        // who lands there is redirected by that page's own guard.
        hoursHref={`${base}/edit`}
        viewHref={`/${lang}/${s.slug ?? `store/${storeId}`}`}
        viewLabel={dict.os.viewPublic}
      />
      <MerchantSidebar
        lang={lang}
        storeId={storeId}
        storeName={s.name}
        logoUrl={s.logo_url}
        plan={planRank(effectivePlan) >= planRank("pro") ? "pro" : "free"}
        trialDaysLeft={trialDaysLeft}
        slug={s.slug}
        category={category}
        nav={nav}
        tabs={tabs}
      />
      {/* Clear the fixed bottom nav (56px + safe area) so the last row of any
          screen is never trapped under it. The nav stops at lg, so the
          reservation stops at lg too — left on past it, every desktop screen
          would hang 56px of dead space. */}
      <div className="min-w-0 flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </div>
    </div>
  );
}
