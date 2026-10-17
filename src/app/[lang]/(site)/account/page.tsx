import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Plus,
  Package,
  CalendarCheck,
  Heart,
  Bookmark,
  MessageCircle,
  Briefcase,
  Sparkles,
  Boxes,
  CircleUser,
  Wrench,
  Hammer,
} from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { getMyListings } from "@/lib/data/market";
import { SITE_URL } from "@/lib/site";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { AppBuildMarker } from "@/components/app-build-marker";
import { ProfileForm } from "@/components/profile-form";
import { LoyaltyPanel } from "@/components/loyalty-panel";
import { AddressManager, type AddressRow } from "@/components/address-manager";
import { MyListingsManager } from "@/components/my-listings-manager";
import { PushOptIn } from "@/components/push-opt-in";
import {
  SavedSearchesManager,
  type SavedSearchRow,
} from "@/components/saved-searches-manager";
import {
  DeleteAccount,
  type DeletionPreview,
} from "@/components/delete-account";
import { dictSlice } from "@/lib/dict-slice";

export default async function AccountPage({
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .maybeSingle();

  const initial = {
    full_name:
      (profile?.full_name as string | null) ??
      (user.user_metadata?.full_name as string | undefined) ??
      "",
    phone: (profile?.phone as string | null) ?? "",
  };

  const { data: addressRows } = await supabase
    .from("addresses")
    .select("id, label, region, city, street, building, floor, details, phone, is_default")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });

  // Loyalty + referral.
  const [{ data: referralCode }, { data: pointsBalance }, refsRes, historyRes] =
    await Promise.all([
      supabase.rpc("get_my_referral_code"),
      supabase.rpc("loyalty_balance", { p_user: user.id }),
      supabase.from("referrals").select("status").eq("referrer_id", user.id),
      supabase
        .from("loyalty_ledger")
        .select("delta, reason, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
  const referralCount = ((refsRes.data ?? []) as { status: string }[]).filter(
    (r) => r.status === "rewarded",
  ).length;

  const myListings = await getMyListings(user.id, lang as Locale);

  const { data: savedSearches } = await supabase
    .from("saved_searches")
    .select("id, q, category, region, city")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // Counted server-side so the deletion warning states this account's real
  // numbers rather than a generic paragraph. The RPC takes no arguments and
  // reads only the caller's own rows (0294).
  const { data: deletionPreview } = await supabase.rpc(
    "my_account_deletion_preview",
  );

  return (
    <div className="py-10">
      <Container className="max-w-xl">
        <PageHeader title={dict.account.title} icon={CircleUser} />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary-soft p-4">
          <p className="text-sm font-semibold">{dict.push.prompt}</p>
          <PushOptIn dict={dictSlice(dict, ["push"])} />
        </div>

        <div className="mt-6">
          <LoyaltyPanel
            lang={lang as Locale}
            dict={dictSlice(dict, ["loyalty"])}
            balance={(pointsBalance as number | null) ?? 0}
            code={(referralCode as string | null) ?? ""}
            referralCount={referralCount}
            history={(historyRes.data ?? []) as {
              delta: number;
              reason: string;
              created_at: string;
            }[]}
            siteUrl={SITE_URL}
          />
        </div>
        <div className="mt-6">
          <ProfileForm dict={dictSlice(dict, ["account", "auth"])} initial={initial} />
        </div>
        <div className="mt-6">
          <AddressManager
            lang={lang as Locale}
            dict={dictSlice(dict, ["account", "auth", "common"])}
            rows={(addressRows ?? []) as AddressRow[]}
          />
        </div>

        <div className="mt-10 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-extrabold tracking-tight">
            {dict.market.myListings}
          </h2>
          <ButtonLink
            href={`/${lang}/market/new`}
            className="shrink-0"
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {dict.market.publish}
          </ButtonLink>
        </div>
        <div className="mt-4">
          <MyListingsManager
            listings={myListings}
            lang={lang as Locale}
            dict={dictSlice(dict, ["auth", "common", "market", "moderation"])}
          />
        </div>

        <SavedSearchesManager
          rows={(savedSearches ?? []) as SavedSearchRow[]}
          lang={lang as Locale}
          dict={dictSlice(dict, ["common", "savedSearch"])}
        />

        {[
          {
            title: dict.account.groupOrders,
            items: [
              { href: `/${lang}/orders`, label: dict.orders.title, Icon: Package },
              { href: `/${lang}/bookings`, label: dict.booking.myBookings, Icon: CalendarCheck },
              { href: `/${lang}/crafts/requests`, label: dict.crafts.myRequests, Icon: Wrench },
            ],
          },
          {
            title: dict.account.groupSaved,
            items: [
              { href: `/${lang}/favorites`, label: dict.favorites.title, Icon: Heart },
              // Saved products are a segment of /favorites now (MP-024), so
              // this tile opens that segment directly instead of bouncing
              // through the old route's redirect.
              { href: `/${lang}/favorites?tab=products`, label: dict.wishlist.title, Icon: Bookmark },
              { href: `/${lang}/messages`, label: dict.messages.title, Icon: MessageCircle },
            ],
          },
          {
            title: dict.account.groupSelling,
            items: [
              { href: `/${lang}/jobs/mine`, label: dict.jobs.myPostings, Icon: Briefcase },
              { href: `/${lang}/freelance/mine`, label: dict.freelance.myGigs, Icon: Sparkles },
              { href: `/${lang}/wholesale/mine`, label: dict.wholesale.myListings, Icon: Boxes },
              { href: `/${lang}/crafts/me`, label: dict.crafts.mePanel, Icon: Hammer },
            ],
          },
        ].map((group) => (
          <div key={group.title} className="mt-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {group.items.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-center transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-semibold">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* ===== App-only settings =====
            The mirror image of what the native shell removes from its chrome.
            A language toggle in a top bar and a merchant CTA in a sitemap
            footer are website furniture; in an app they are Settings, and this
            is where someone on a phone goes looking for them.
            `data-app-only` is `display:none` everywhere except inside the shell
            (src/lib/app-mode.ts), so the web page renders exactly as it did —
            this block is in the HTML and never gets a box. Server-rendered
            rather than gated on a JS check, so it is there in the app's first
            paint, same as the removals are. */}
        <div data-app-only className="mt-10">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {dict.account.groupApp}
          </h2>
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
            <span className="text-sm font-semibold">
              {dict.account.language}
            </span>
            <LanguageSwitcher currentLocale={lang as Locale} />
          </div>
          <div className="mt-3 rounded-2xl border border-border bg-surface p-4">
            <p className="text-sm text-muted-foreground">
              {dict.account.merchantDoor}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink href={`/${lang}/merchant/new`} size="sm">
                {dict.common.openStore}
              </ButtonLink>
              <ButtonLink
                href={`/${lang}/merchants`}
                size="sm"
                variant="secondary"
              >
                {dict.common.forMerchants}
              </ButtonLink>
            </div>
          </div>
        
          {/* Which build this is, and whether app mode actually switched on.
              Diagnostic rather than decoration: the shell displays the live
              site, so a new APK changes little about what is on screen, and
              "I installed it and it looks the same" is otherwise impossible to
              tell apart from an install that quietly declined. */}
          <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {dict.account.groupBuild}
          </h2>
          <AppBuildMarker
            labels={{
              mode: dict.account.buildMode,
              on: dict.account.buildModeOn,
              off: dict.account.buildModeOff,
              agent: dict.account.buildAgent,
              version: dict.account.buildVersion,
            }}
          />
        </div>

        <DeleteAccount
          lang={lang as Locale}
          dict={dictSlice(dict, ["account", "common"])}
          email={user.email ?? ""}
          preview={
            ((deletionPreview as DeletionPreview | null) ?? {
              stores: 0,
              open_orders: 0,
              orders: 0,
              reviews: 0,
              listings: 0,
              addresses: 0,
            }) as DeletionPreview
          }
        />
      </Container>
    </div>
  );
}
