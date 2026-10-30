import { Gem, MessageCircle } from "lucide-react";
import { waLink } from "@/lib/phone";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { JoinAction } from "@/components/join-action";

export type MembershipPlan = {
  id: string;
  name: string;
  name_en: string | null;
  price: number | null;
  period: string;
  description: string | null;
};

// Public membership/subscription plans (gyms, clubs, schools). The platform has
// no payment gateway, so "join" opens a pre-filled WhatsApp message to the
// business — a contact/lead, not a charge.
export function StoreMemberships({
  plans,
  dict,
  lang,
  whatsapp,
  contactOnly = false,
}: {
  plans: MembershipPlan[];
  dict: Dictionary;
  lang: Locale;
  whatsapp: string | null;
  /** Display only (0338): the database refuses a join, so the button asks on
   *  WhatsApp instead, and is absent without a number. */
  contactOnly?: boolean;
}) {
  if (!plans.length) return null;
  const t = dict.memberships;
  const periods = t.periods as Record<string, string>;

  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
        <Gem className="h-5 w-5 text-primary" />
        {t.publicTitle}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
          const name = lang === "en" ? p.name_en || p.name : p.name;
          return (
            <div
              key={p.id}
              className="flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-xs"
            >
              <h3 className="font-extrabold">{name}</h3>
              {p.price != null && (
                <p className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-primary">
                    ${p.price}
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">
                    · {periods[p.period] ?? p.period}
                  </span>
                </p>
              )}
              {p.description && (
                <p className="mt-2 flex-1 text-sm text-muted-foreground">
                  {p.description}
                </p>
              )}
              {contactOnly ? (
                whatsapp && (
                  <a
                    href={waLink(whatsapp, `${t.joinMsg} ${name}`) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
                  >
                    <MessageCircle aria-hidden className="h-4 w-4" />
                    {dict.store.whatsapp}
                  </a>
                )
              ) : (
              <JoinAction
                kind="membership"
                targetId={p.id}
                whatsapp={whatsapp}
                waText={`${t.joinMsg} ${name}`}
                loginHref={`/${lang}/login`}
                labels={{
                  join: t.join,
                  done: t.subscribed,
                  errorGeneric: dict.common.actionFailed,
                }}
              />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
