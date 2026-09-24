import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HelpCircle, MessageCircle } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { jsonLdScript } from "@/lib/jsonld";
import { Container } from "@/components/ui/container";
import { ButtonLink } from "@/components/ui/button";
import { supportWaLink } from "@/lib/support";
import { fillPlanCopy, planCopyVars } from "@/lib/plan-copy";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    title: dict.faq.title,
    description: dict.faq.subtitle,
    alternates: localeAlternates(lang, "/help"),
  };
}

export default async function HelpPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.faq;

  // Plan facts in the answers (the free product cap today) are placeholders
  // filled from plan-tiers / plan.ts, so this page and /pricing quote the same
  // numbers. Filled once and used for both the structured data and the markup.
  const vars = planCopyVars();
  const items = t.items.map((it) => ({
    q: fillPlanCopy(it.q, vars),
    a: fillPlanCopy(it.a, vars),
  }));

  // FAQPage structured data (eligible for rich results in Google).
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };

  return (
    <div className="py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqLd) }}
      />
      <Container className="max-w-2xl">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-extrabold tracking-tight">{t.title}</h1>
        </div>
        <p className="mt-2 text-muted-foreground">{t.subtitle}</p>

        <div className="mt-8 space-y-3">
          {items.map((it, i) => (
            <details
              key={i}
              className="group rounded-2xl border border-border bg-surface p-4 shadow-xs transition-colors open:border-primary/30 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 font-bold">
                {it.q}
                <span className="text-primary transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted-foreground">{it.a}</p>
            </details>
          ))}
        </div>

        {/* Somebody reading the bottom of the FAQ has already failed to find
            their answer here. Sending them to a contact PAGE, which then offers
            a WhatsApp link, is one hop of nothing. This opens the conversation. */}
        <ButtonLink
          href={supportWaLink()}
          target="_blank"
          rel="noopener noreferrer"
          variant="whatsapp"
          className="mt-8"
          leftIcon={<MessageCircle className="h-4 w-4" />}
        >
          {t.contactCta}
        </ButtonLink>
      </Container>
    </div>
  );
}
