import { notFound } from "next/navigation";
import {
  ShieldCheck,
  Star,
  Store as StoreIcon,
  Clock,
  Users,
  Receipt,
} from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { getSectionSupply } from "@/lib/data/section-supply";
import { getMerchantStalls } from "@/lib/data/merchant-stalls";
import { Container } from "@/components/ui/container";
import {
  AdminAttentionQueue,
  type AttentionQueue,
} from "@/components/admin-attention-queue";
import { PageHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminBroadcast } from "@/components/admin-broadcast";
import { AdminSectionSupply } from "@/components/admin-section-supply";
import { AdminMerchantStalls } from "@/components/admin-merchant-stalls";
import { PushNotice } from "@/components/push-notice";
import { AdminStoreActions } from "@/components/admin-store-actions";
import { AdminReviewDelete } from "@/components/admin-review-delete";
import { toCategoryKey } from "@/lib/catalog";
import { validateStorePublic } from "@/lib/data-quality";

type ReviewRow = {
  id: string;
  customer_name: string | null;
  rating: number;
  comment: string | null;
  stores: { name: string } | null;
};

type PendingStore = {
  id: string;
  name: string;
  area: string | null;
  service_area: string | null;
  region: string | null;
  phone: string | null;
  whatsapp: string | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  business_types: { slug: string; name_ar: string; name_en: string } | null;
};

export default async function AdminOverviewPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  // Role is already enforced by the admin layout.
  const supabase = await createClient();

  const { data } = await supabase
    .from("stores")
    .select(
      // Everything after `area` is read by the publication gate only
      // (lib/data-quality.ts): a store it holds as blocked cannot be approved.
      "id, name, area, service_area, region, phone, whatsapp, description, logo_url, cover_url, business_types(slug, name_ar, name_en)",
    )
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const pending = (data ?? []) as unknown as PendingStore[];
  // No catalogue count here: a store in review has usually not added one yet,
  // and "no offerings" is the merchant's checklist item, not a reason to hold
  // approval. The rule is skipped when the count is unknown.
  const qualityOf = (store: PendingStore) => {
    const r = validateStorePublic(
      {
        name: store.name,
        category: store.business_types?.slug ?? null,
        area: store.area,
        service_area: store.service_area,
        region: store.region,
        phone: store.phone,
        whatsapp: store.whatsapp,
        description: store.description,
        logo_url: store.logo_url,
        cover_url: store.cover_url,
      },
      { sector: toCategoryKey(store.business_types?.slug, `store ${store.id}`) },
    );
    return {
      level: r.level,
      issues: r.issues.map((i) => dict.dataQuality.issues[i.code]),
    };
  };

  const [storesRes, usersRes, ordersRes] = await Promise.all([
    supabase
      .from("stores")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }),
  ]);

  const { data: reviewData } = await supabase
    .from("reviews")
    .select("id, customer_name, rating, comment, stores(name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  const reviews = (reviewData ?? []) as unknown as ReviewRow[];

  // The queue is what the admin opens this page for; the counts below explain
  // it. Failing soft on purpose — a null here hides the section rather than
  // taking down the whole overview.
  const { data: queueData } = await supabase.rpc("admin_attention_queue");
  const queue = (queueData ?? {}) as AttentionQueue;

  // Which verticals are hidden from navigation, and by how much. The gate is
  // automatic and was previously invisible — see admin-section-supply.tsx.
  const sectionSupply = await getSectionSupply();

  // Which merchants are stuck, at what stage, and since when. The queue above
  // can only see work that generated an event; a shop that has done nothing at
  // all generates none, which is why 12 of 15 active stores were invisible to
  // this page. Returns null for anyone but a super admin — see the function.
  const stalls = await getMerchantStalls(lang);

  const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="py-10">
      <Container>
        <PageHeader
          icon={ShieldCheck}
          title={dict.admin.title}
          subtitle={dict.admin.subtitle}
        />

        <div data-animate className="space-y-8">
          {/* A store waiting for review is urgent to exactly one person, and
              until now that person had to already be looking at this page to
              find out it was waiting. */}
          <PushNotice
            dict={dict}
            title={dict.push.adminNoticeTitle}
            body={dict.push.adminNoticeBody}
          />
          <AdminAttentionQueue queue={queue} lang={lang} dict={dict} />
          {/* Directly under the queue, and above the counts, on purpose: the
              queue lists what is waiting on the owner, this lists what is
              waiting on nobody — which on a platform this size is the bigger
              number by an order of magnitude. */}
          <AdminMerchantStalls data={stalls} dict={dict} />
          <AdminSectionSupply rows={sectionSupply} dict={dict} />
          <StatGrid>
            <Stat
              label={dict.admin.totalStores}
              value={(storesRes.count ?? 0).toLocaleString("en-US")}
              icon={<StoreIcon />}
            />
            <Stat
              label={dict.admin.pendingTitle}
              value={pending.length.toLocaleString("en-US")}
              icon={<Clock />}
            />
            <Stat
              label={dict.admin.users}
              value={(usersRes.count ?? 0).toLocaleString("en-US")}
              icon={<Users />}
            />
            <Stat
              label={dict.admin.ordersTotal}
              value={(ordersRes.count ?? 0).toLocaleString("en-US")}
              icon={<Receipt />}
            />
          </StatGrid>

          <AdminBroadcast dict={dict} />

          <section>
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-lg font-bold">{dict.admin.pendingTitle}</h2>
              {pending.length > 0 && (
                <Badge variant="warning" size="sm">
                  {pending.length}
                </Badge>
              )}
            </div>
            {pending.length ? (
              <div className="space-y-3">
                {pending.map((store) => (
                  <Card key={store.id}>
                    <CardBody className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-base font-extrabold text-primary">
                          {initial(store.name)}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate font-bold">{store.name}</h3>
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">
                            {store.business_types
                              ? lang === "ar"
                                ? store.business_types.name_ar
                                : store.business_types.name_en
                              : null}
                            {store.area ? ` · ${store.area}` : null}
                          </p>
                        </div>
                      </div>
                      <AdminStoreActions
                        storeId={store.id}
                        approveLabel={dict.admin.approve}
                        rejectLabel={dict.admin.reject}
                        errorLabel={dict.auth.errorGeneric}
                        cancelLabel={dict.common.cancel}
                        t={dict.admin.storesAdmin}
                        quality={qualityOf(store)}
                        dq={dict.dataQuality}
                      />
                    </CardBody>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState icon={ShieldCheck} title={dict.admin.noPending} />
            )}
          </section>

          {reviews.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-bold">
                {dict.admin.reviewsTitle}
              </h2>
              <Card>
                <div className="divide-y divide-border">
                  {reviews.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start justify-between gap-4 p-5 transition-colors hover:bg-surface-muted"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">
                            {r.customer_name ?? "—"}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            · {r.stores?.name}
                          </span>
                          <Badge variant="warning" size="sm">
                            <Star className="h-3 w-3 fill-current" />
                            {r.rating}
                          </Badge>
                        </div>
                        {r.comment && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {r.comment}
                          </p>
                        )}
                      </div>
                      <AdminReviewDelete
                        reviewId={r.id}
                        label={dict.admin.deleteReview}
                        confirmLabel={dict.admin.confirmDeleteReview}
                        errorLabel={dict.auth.errorGeneric}
                        okLabel={dict.common.confirm}
                        cancelLabel={dict.common.cancel}
                      />
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}
        </div>
      </Container>
    </div>
  );
}
