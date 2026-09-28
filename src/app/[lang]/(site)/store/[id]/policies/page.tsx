import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { RotateCcw, Truck } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createPublicClient } from "@/lib/supabase/public-client";
import { Container } from "@/components/ui/container";
import { ChevronPrev } from "@/components/ui/directional-icon";
import { localeAlternates } from "@/lib/site";

// A store's return and shipping policies on one public page — the page a
// merchant points Google Merchant Center and Meta at when they ask where the
// shop's policies are, and what a customer reads before ordering.
//
// Both texts are the merchant's own words (stores.return_policy, 0303;
// stores.shipping_policy, 0308). Nothing is defaulted: a policy nobody wrote is
// shown as "not written yet", never as a platform promise — Matjar takes no
// payment and settles nothing.
//
// Deliberately NO loading.tsx here: a loading boundary over a dynamic [id]
// segment turns notFound() into a 200 soft-404 in this repo.
//
// Cached cross-request with the cookie-less anon client (RLS: active stores
// only), tagged `store:<id>` so saving a policy busts it at once.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StorePolicies = {
  name: string;
  returnPolicy: string | null;
  shippingPolicy: string | null;
};

async function fetchPolicies(id: string): Promise<StorePolicies | null> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("stores")
    .select("name, return_policy")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  // Read on its own: until 0308 is applied the column does not exist, and one
  // unknown column fails the whole SELECT. Missing = not written.
  const { data: ship } = await supabase
    .from("stores")
    .select("shipping_policy")
    .eq("id", id)
    .maybeSingle();
  const row = data as { name: string; return_policy: string | null };
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    name: row.name,
    returnPolicy: clean(row.return_policy),
    shippingPolicy: clean((ship as { shipping_policy?: string | null } | null)?.shipping_policy),
  };
}

function getPolicies(id: string): Promise<StorePolicies | null> {
  return unstable_cache(() => fetchPolicies(id), ["store-policies", id], {
    revalidate: 3600,
    tags: ["stores", `store:${id}`],
  })();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) return {};
  const store = await getPolicies(id);
  if (!store || (!store.returnPolicy && !store.shippingPolicy)) return {};
  const t = (await getDictionary(lang)).googleFeed.policiesPage;
  return {
    title: t.title.replace("{store}", store.name),
    description: t.description.replace("{store}", store.name),
    alternates: localeAlternates(lang, `/store/${id}/policies`),
  };
}

export default async function StorePoliciesPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) notFound();
  const store = await getPolicies(id);
  // A page with neither policy says nothing — a 404 rather than an empty,
  // crawlable shell.
  if (!store || (!store.returnPolicy && !store.shippingPolicy)) notFound();
  const t = (await getDictionary(lang)).googleFeed.policiesPage;

  const blocks = [
    { key: "return", icon: RotateCcw, title: t.returnTitle, body: store.returnPolicy },
    { key: "shipping", icon: Truck, title: t.shippingTitle, body: store.shippingPolicy },
  ];

  return (
    <div className="py-10">
      <Container>
        <Link
          href={`/${lang}/store/${id}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {t.backToStore}
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          {t.title.replace("{store}", store.name)}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>

        <div className="mt-8 grid max-w-3xl gap-4">
          {blocks.map(({ key, icon: Icon, title, body }) => (
            <section key={key} className="rounded-2xl border border-border bg-surface p-6">
              <h2 className="flex items-center gap-2 font-bold">
                <Icon className="h-5 w-5 text-primary" />
                {title}
              </h2>
              {body ? (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{body}</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{t.notStated}</p>
              )}
            </section>
          ))}
        </div>
      </Container>
    </div>
  );
}
