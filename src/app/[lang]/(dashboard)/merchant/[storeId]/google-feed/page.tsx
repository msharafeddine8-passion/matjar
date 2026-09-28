import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, XCircle, Info, ShoppingBag, Share2 } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { ProGate } from "@/components/pro-gate";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { SITE_URL } from "@/lib/site";
import {
  evaluateFeedChecklist,
  feedPath,
  feedServes,
  type FeedProductRow,
  type FeedStore,
} from "@/lib/google-feed";
import { GoogleFeedPanel } from "./google-feed-panel";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many incomplete products the checklist names before "and N more". */
const ISSUES_SHOWN = 12;

// Google free listings: the owner's activation page, pre-flight checklist and
// connection guide for the per-store feed at /feeds/<slug>/google.xml.
//
// Owner-only, like settings: the switch and both policies are columns on
// `stores`, which only the owner may update (stores_update, 0302).
//
// Pro and Business. A store below Pro still SEES the page — what it does and
// how it works — with the shared upgrade prompt in place of the controls, so
// the feature is visible rather than a padlock with no explanation.
export default async function GoogleFeedPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  const { lang, storeId } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(storeId)) redirect(`/${lang}/merchant`);
  const dict = await getDictionary(lang);
  const t = dict.googleFeed;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data: storeRow } = await supabase
    .from("stores")
    .select(
      "id, name, slug, status, deleted_at, plan, trial_ends_at, return_policy, business_types(slug)",
    )
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!storeRow) redirect(`/${lang}/merchant`);
  const s = storeRow as unknown as Record<string, unknown> & {
    business_types: { slug: string } | null;
  };

  // The 0308 columns are read on their own: PostgREST fails a whole SELECT on
  // one unknown column, and until the migration is applied that would take the
  // store row (and this page) down with it. A failed read here just means "not
  // switched on, no shipping policy yet", and the controls say so.
  const { data: feedRow, error: feedErr } = await supabase
    .from("stores")
    .select("shipping_policy, google_feed_enabled, google_feed_enabled_at")
    .eq("id", storeId)
    .maybeSingle();
  const migrationPending = !!feedErr;
  const f = (feedRow ?? {}) as {
    shipping_policy?: string | null;
    google_feed_enabled?: boolean;
    google_feed_enabled_at?: string | null;
  };

  const store: FeedStore = {
    id: storeId,
    name: s.name as string,
    slug: (s.slug as string | null) ?? null,
    sectorSlug: s.business_types?.slug ?? null,
    status: s.status as string,
    deletedAt: (s.deleted_at as string | null) ?? null,
    plan: (s.plan as string | null) ?? null,
    trialEndsAt: (s.trial_ends_at as string | null) ?? null,
    returnPolicy: (s.return_policy as string | null) ?? null,
    shippingPolicy: f.shipping_policy ?? null,
    googleFeedEnabled: f.google_feed_enabled === true,
  };

  const { data: productData } = await supabase
    .from("products")
    .select(
      "id, name, description, price, discount_price, image_url, stock, is_available, status, deleted_at, hidden_by_plan, item_kind, brand, sku",
    )
    .eq("store_id", storeId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(2000);
  const products = (productData ?? []) as FeedProductRow[];

  const checklist = evaluateFeedChecklist({ store, products });
  const planOk = checklist.items.find((i) => i.key === "plan")?.ok ?? false;
  const serving = feedServes(store);
  const base = `/${lang}/merchant/${storeId}`;
  const feedUrl = `${SITE_URL}${feedPath(store)}`;
  const policiesHref = `/${lang}/store/${storeId}/policies`;

  const onSince = f.google_feed_enabled_at
    ? new Intl.DateTimeFormat(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
        timeZone: "Asia/Beirut",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(f.google_feed_enabled_at))
    : null;
  const statusKey = serving ? "on" : store.googleFeedEnabled ? "paused" : "off";

  return (
    <div className="py-10">
      <Container>
        <Link
          href={base}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.dashboard.panel}
        </Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <ShoppingBag className="h-7 w-7 text-primary" />
          {t.title}
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{t.subtitle}</p>

        {!planOk ? (
          <div className="mt-8">
            <ProGate
              lang={lang}
              dict={dict}
              storeId={storeId}
              title={t.lockedTitle}
              body={t.lockedBody}
              compact
            />
          </div>
        ) : (
          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              {migrationPending && (
                <p className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning-soft p-4 text-sm font-semibold text-warning">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  {t.migrationPending}
                </p>
              )}

              {/* Pre-flight checklist */}
              <section className="rounded-2xl border border-border bg-surface p-6">
                <h2 className="font-bold">{t.checklistTitle}</h2>
                <ul className="mt-4 space-y-2.5">
                  {checklist.items.map((item) => (
                    <li key={item.key} className="flex items-start gap-2 text-sm">
                      {item.ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                      )}
                      <span className={item.ok ? "" : "font-semibold"}>
                        {t.checklist[item.key]}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm font-semibold">
                  {t.listableCount.replace("{n}", String(checklist.listableCount))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t.listableNote}</p>

                {checklist.productIssues.length > 0 && (
                  <div className="mt-5 border-t border-border pt-4">
                    <h3 className="text-sm font-bold">{t.issuesTitle}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t.issuesBody}</p>
                    <ul className="mt-3 space-y-2">
                      {checklist.productIssues.slice(0, ISSUES_SHOWN).map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3.5 py-2 text-sm"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{p.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {p.missing.map((m) => t.missing[m]).join(" · ")}
                            </span>
                          </span>
                          <Link
                            href={`${base}/products/${p.id}`}
                            className="shrink-0 rounded-lg border border-border px-3 py-1 text-xs font-bold text-primary hover:border-primary"
                          >
                            {t.fix}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {checklist.productIssues.length > ISSUES_SHOWN && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t.issuesMore.replace(
                          "{n}",
                          String(checklist.productIssues.length - ISSUES_SHOWN),
                        )}
                      </p>
                    )}
                  </div>
                )}
              </section>

              <GoogleFeedPanel
                storeId={storeId}
                t={t}
                feedUrl={feedUrl}
                policiesHref={policiesHref}
                initialReturnPolicy={store.returnPolicy ?? ""}
                initialShippingPolicy={store.shippingPolicy ?? ""}
                enabled={store.googleFeedEnabled}
                canActivate={checklist.canActivate && !migrationPending}
                disabled={migrationPending}
                statusKey={statusKey}
                onSince={serving && onSince ? t.onSince.replace("{date}", onSince) : null}
              />
            </div>

            {/* The connection guide */}
            <div className="space-y-6">
              <section className="rounded-2xl border border-border bg-surface p-6">
                <h2 className="font-bold">{t.guideTitle}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{t.guideIntro}</p>
                <ol className="mt-4 space-y-3">
                  {t.guideSteps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary tabular-nums">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="rounded-2xl border border-border bg-surface p-6">
                <h2 className="flex items-center gap-2 font-bold">
                  <Share2 className="h-4 w-4 text-primary" />
                  {t.metaTitle}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t.metaBody}
                </p>
              </section>
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}

