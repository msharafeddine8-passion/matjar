import Link from "next/link";
import { ExternalLink, Store as StoreIcon } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { regions } from "@/lib/catalog";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";

const PAGE_SIZE = 100;

type Row = {
  id: string;
  name: string;
  region: string | null;
  area: string | null;
  phone: string | null;
  business_types: { name_ar: string; name_en: string } | null;
};

/**
 * The admin's view of the directory: searched, paged, read-only. Claims and
 * removals are resolved from /admin/claims against a request from a real person,
 * so nothing here changes a row.
 */
export async function AdminUnclaimedStores({
  lang,
  dict,
  supabase,
  query,
  page,
  tabs,
}: {
  lang: Locale;
  dict: Dictionary;
  supabase: SupabaseClient;
  query: string;
  page: number;
  tabs: React.ReactNode;
}) {
  const t = dict.admin.storesAdmin;
  const size = PAGE_SIZE;
  const from = (page - 1) * size;
  let q = supabase
    .from("stores")
    .select("id, name, region, area, phone, business_types(name_ar, name_en)", { count: "exact" })
    .is("deleted_at", null)
    .is("owner_id", null);
  if (query) q = q.ilike("name", `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`);
  const { data, count } = await q
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + size - 1);
  const rows = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const href = (p: number) => {
    const qs = new URLSearchParams({ owner: "unclaimed" });
    if (query) qs.set("uq", query);
    if (p > 1) qs.set("page", String(p));
    return `/${lang}/admin/stores?${qs}`;
  };

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={StoreIcon} title={t.title} subtitle={t.unclaimedHint} />
        {tabs}

        <form method="get" className="flex gap-2 sm:max-w-md">
          <input type="hidden" name="owner" value="unclaimed" />
          <Input
            name="uq"
            defaultValue={query}
            placeholder={t.unclaimedSearch}
            aria-label={t.unclaimedSearch}
          />
          <Button type="submit" variant="secondary">
            {t.unclaimedSearchGo}
          </Button>
        </form>

        <p className="mt-6 text-sm font-semibold text-muted-foreground tabular-nums">{total}</p>

        {rows.length === 0 ? (
          <div className="mt-2">
            <EmptyState icon={StoreIcon} title={t.unclaimedEmpty} />
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-surface">
            {rows.map((r) => {
              const type = lang === "ar" ? r.business_types?.name_ar : r.business_types?.name_en;
              const region = regions.find((x) => x.key === r.region)?.name[lang];
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-bold" dir="auto">{r.name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {[type, r.area, region].filter(Boolean).join(" · ")}
                      {r.phone ? (
                        <>
                          {" · "}
                          <bdi dir="ltr" className="tabular-nums">{r.phone}</bdi>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <Link
                    href={`/${lang}/store/${r.id}`}
                    target="_blank"
                    className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    {t.unclaimedOpen}
                    <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {pageCount > 1 && (
          <nav className="mt-6 flex items-center justify-center gap-3">
            {page > 1 ? (
              <ButtonLink href={href(page - 1)} variant="secondary">
                {t.unclaimedPrev}
              </ButtonLink>
            ) : (
              <span />
            )}
            <span className="text-sm text-muted-foreground tabular-nums">
              {page} / {pageCount}
            </span>
            {page < pageCount && (
              <ButtonLink href={href(page + 1)} variant="secondary">
                {t.unclaimedNext}
              </ButtonLink>
            )}
          </nav>
        )}
      </Container>
    </div>
  );
}
