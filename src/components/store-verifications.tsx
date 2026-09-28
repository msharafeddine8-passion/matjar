import { BadgeCheck, ShieldCheck } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

// number and verify_url are not here (0314, P2-PRIV-03): anon cannot read
// them any more, and the licence number is not something the storefront needs
// to publish. The merchant and the admin still see both on their own screens.
export type StoreVerification = {
  id: string;
  kind: string;
  title: string;
  issuer: string | null;
  issued_on: string | null;
  expires_on: string | null;
  status: string;
};

// Public display of a store's certificates & licenses. Two states, kept
// deliberately distinct: uploaded documents are shown as "provided by the
// business — not reviewed" (self-declared, no endorsement), while an
// admin-reviewed document is marked "verified". Rejected docs are hidden.
//
// The scanned document itself is NOT shown, and doc_url is deliberately absent
// from this type so it cannot be reintroduced by accident. It used to render as
// a thumbnail linking to the full-resolution original — and the document people
// actually photograph for this, a Lebanese commercial registration, routinely
// carries the owner's ID number and home address. What a shopper needs is the
// claim and who checked it; the paperwork behind it is for the admin review
// queue, not the storefront.
export function StoreVerifications({
  verifications,
  dict,
  lang,
}: {
  verifications: StoreVerification[];
  dict: Dictionary;
  lang: Locale;
}) {
  const shown = verifications.filter((v) => v.status !== "rejected");
  if (!shown.length) return null;
  const t = dict.verifications;
  const kinds = t.kinds as Record<string, string>;
  const fmt = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString(lang === "ar" ? "ar" : "en", {
          year: "numeric",
          month: "short",
        })
      : null;

  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
        <ShieldCheck className="h-5 w-5 text-primary" />
        {t.publicTitle}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {shown.map((v) => {
          const verified = v.status === "verified";
          const expired =
            v.expires_on != null && new Date(v.expires_on) < new Date();
          return (
            <div
              key={v.id}
              className="flex gap-3 rounded-2xl border border-border bg-surface p-4"
            >
              <span
                aria-hidden
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground"
              >
                {verified ? (
                  <ShieldCheck className="h-7 w-7 text-success" />
                ) : (
                  <BadgeCheck className="h-7 w-7" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground">
                    {kinds[v.kind] ?? v.kind}
                  </span>
                  {verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-bold text-success">
                      <BadgeCheck className="h-3 w-3" />
                      {t.verifiedDoc}
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {t.selfDeclared}
                    </span>
                  )}
                  {expired && (
                    <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning">
                      {t.expired}
                    </span>
                  )}
                </div>
                <p className="mt-1 font-bold leading-tight">{v.title}</p>
                {v.issuer && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {v.issuer}
                  </p>
                )}
                {(v.issued_on || v.expires_on) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[fmt(v.issued_on), fmt(v.expires_on)]
                      .filter(Boolean)
                      .join(" — ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
