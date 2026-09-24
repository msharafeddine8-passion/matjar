import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Building2, MessageCircle } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { localeAlternates } from "@/lib/site";
import { supportWaLink } from "@/lib/support";
import { planCopy } from "@/lib/plan-copy";
import {
  LEGAL_ENV_KEYS,
  LEGAL_VAT_KEY,
  readLegalEntity,
  type LegalEntityState,
} from "@/lib/legal-entity";
import { Container } from "@/components/ui/container";

// ISS-025 — who is behind this, and on what terms.
//
// Matjar has a privacy policy and nothing else: no company, no registration, no
// address, and no terms for the merchants whose businesses are listed on it. A
// regulator, a cautious buyer and a shop owner about to hand over their
// livelihood all ask the same question here and the site had no answer.
//
// Two halves, and they fail differently on purpose:
//
//   The entity block is FACT NOBODY HERE KNOWS. It comes from environment
//   variables (src/lib/legal-entity.ts) and, unset, renders a loud panel naming
//   the exact variables to set — never a plausible company. The page also goes
//   noindex while it is in that state, so an unfinished legal page cannot be the
//   thing a search engine shows someone checking whether this platform is real.
//
//   The terms half is fact this repository DOES know, because it is a
//   description of what the code already does: cash on delivery, no commission,
//   the merchant is the seller, every store reviewed before it publishes, a free
//   tier capped at three products, plans settled by hand. Every clause below is
//   traceable to something in the product. Nothing was invented to fill a
//   heading, and where the honest answer is "this is not built yet" it says so.
//
// It is written in plain Lebanese Arabic first, and it says at the top that it
// has not been through a lawyer — because it has not, and a reader deciding how
// much weight to give it deserves to know that before they read it.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const t = lang === "ar" ? AR : EN;
  const state = readLegalEntity(process.env);
  return {
    title: t.title,
    description: t.metaDesc,
    alternates: localeAlternates(lang, "/legal"),
    // A legal page that cannot name its own legal entity should not be indexed
    // as this platform's answer to "who runs it". Lifts itself the moment the
    // variables are set.
    robots: state.configured ? undefined : { index: false, follow: true },
  };
}

type Block = { title: string; items: string[] };

const AR = {
  title: "الكيان القانوني وشروط الاستخدام",
  metaDesc:
    "مين بيشغّل متجر، وشو الشروط بين المنصّة والتاجر والزبون — بلغة واضحة.",
  draftTitle: "هيدا النص مكتوب بلغة واضحة، مش بلغة محامي",
  draftBody:
    "كتبناه ليشرح كيف المنصّة عم تشتغل فعلياً اليوم، ولسّا ما راجعو محامي. إذا في فرق بين شي مكتوب هون وشي عم يصير بالواقع، الواقع هوّي يلي لازم يتصلّح — احكينا.",
  entityTitle: "مين بيشغّل متجر",
  entityLabels: {
    MATJAR_LEGAL_NAME: "الاسم المسجّل",
    MATJAR_LEGAL_REGISTRATION: "رقم السجل التجاري",
    MATJAR_LEGAL_ADDRESS: "العنوان المسجّل",
    MATJAR_LEGAL_EMAIL: "إيميل الإشعارات القانونية",
  } as Record<string, string>,
  vatLabel: "رقم الـTVA",
  missingTitle: "معلومات الكيان القانوني ما تعبّت على هالنسخة",
  missingBody:
    "هالصفحة ما بتخترع اسم شركة ولا رقم سجل. صاحب المنصّة لازم يحطّ القيم التالية بمتغيّرات البيئة (Vercel ← Settings ← Environment Variables) وبعدها يعيد النشر:",
  missingBlankLabel: "ما تعبّى",
  missingFillerLabel: "معبّى بقيمة مؤقّتة — لازم القيمة الحقيقية",
  missingVatNote:
    "و — بس إذا الكيان مسجّل بالـTVA — المتغيّر {vat}. إذا ما في، خلّيه فاضي وما رح يظهر شي.",
  blocks: [
    {
      title: "الطلبات: مين البائع، ومين بيقبض",
      items: [
        "لمّا تطلب من متجر على المنصّة، البيع بيصير بينك وبين هيداك المتجر مباشرة. متجر بتوفّر الصفحة والأدوات؛ البضاعة والتسليم والاسترجاع مسؤوليّة المتجر.",
        "كل الطلبات كاش عند الاستلام. المنصّة ما بتقبض مصاري الزبون ولا بتمرق عليها، وما في دفع أونلاين ولا بطاقة بأي مكان بالموقع.",
        "الأسعار يلي بتشوفها بيحطّها التاجر. إذا وصلك شي غير يلي طلبتو، أو سعر غير يلي كان مكتوب، احكي مع المتجر أوّلاً — وإذا ما انحلّت، بلّغنا.",
      ],
    },
    {
      title: "للتجّار: شو عم تاخد وشو عم تلتزم فيه",
      items: [
        "فتح المتجر مجّاني، وبتقدر تضيف لحدّ {freeProducts} منتجات على الخطة المجانية. الخطط المدفوعة سعرها منشور على صفحة الأسعار.",
        "ما منطلب منّك بطاقة ولا رقم حساب لتفتح متجر. الاشتراك المدفوع بينحسب بالاتفاق معنا ويداً بيد — ما في دفع أونلاين على المنصّة.",
        "٠٪ عمولة على مبيعاتك. مصاري طلباتك بتوصلك إنت.",
        "كل متجر بينراجع قبل ما ينشر. إذا المتجر خالف القانون اللبناني أو ضحّك على زباينو، فينا نوقّفو أو نشيلو عن المنصّة.",
        "منتجاتك وأرقام زباينك ملكك إنت. ما منبيعها ولا منشاركها. لسّا ما في زرّ تصدير ذاتي — احكينا ومنبعتلك بياناتك أو منسكّرلك المتجر.",
        "إذا بدّك تترك، انقل ملكيّة المتجر لحدا أو احكينا نسكّرو. لا تحذف حسابك وإنت لسّا مالك متجر — بياخد معو المتجر وكل طلبات زباينك.",
      ],
    },
    {
      title: "شو ممنوع يتنشر",
      items: [
        "أي شي بيعو ممنوع بالقانون اللبناني.",
        "متجر أو منتج مش حقيقي، أو صور مسروقة من غيرك.",
        "معلومات أو أسعار مضلّلة.",
        "بلاغك عن أي شي من هودي بيوصلنا من زرّ «بلّغ عن مشكلة» يلي تحت كل صفحة متجر ومنتج.",
      ],
    },
    {
      title: "إذا صار في مشكلة",
      items: [
        "بلّغ عن الصفحة نفسها من زرّ «بلّغ عن مشكلة». البلاغ بينحفظ عنّا مع سببو، وفريق متجر بيراجعو — بس ما منقدر نوعدك بوقت محدّد.",
        "إذا الموضوع مستعجل، أو خسّرك مصاري، أو ما لقيت جواب: احكينا مباشرة عالواتساب. هيدا أسرع طريق لحدا بيرد.",
        "الاسترجاع والتبديل بينتّفق عليهن مع المتجر. إذا المشكلة ما انحلّت، منتدخّل ومنساعد الطرفين يوصلوا لحلّ عادل.",
      ],
    },
    {
      title: "تعديل هالشروط",
      items: [
        "إذا غيّرنا شي بهالصفحة، بتلاقي النص الجديد هون. ما منرجع بأثر رجعي على طلب صار قبل التغيير.",
      ],
    },
  ] as Block[],
  contactTitle: "تواصل معنا",
  contactCta: "احكينا عالواتساب",
  contactPrefill: "مرحبا، عندي سؤال بخصوص الشروط القانونية على متجر.",
  privacyCta: "سياسة الخصوصية",
  trustCta: "الثقة والأمان",
};

const EN = {
  title: "Legal entity & terms of use",
  metaDesc:
    "Who operates Matjar, and the terms between the platform, the merchant and the customer — in plain language.",
  draftTitle: "This is written in plain language, not in legal language",
  draftBody:
    "It describes how the platform actually works today, and it has not been reviewed by a lawyer. If anything written here differs from what really happens, it is reality that needs fixing — tell us.",
  entityTitle: "Who operates Matjar",
  entityLabels: {
    MATJAR_LEGAL_NAME: "Registered name",
    MATJAR_LEGAL_REGISTRATION: "Commercial register number",
    MATJAR_LEGAL_ADDRESS: "Registered address",
    MATJAR_LEGAL_EMAIL: "Address for legal notices",
  } as Record<string, string>,
  vatLabel: "VAT number",
  missingTitle: "Legal entity details are not configured on this deployment",
  missingBody:
    "This page does not invent a company name or a register number. The platform's owner must set the following environment variables (Vercel → Settings → Environment Variables) and redeploy:",
  missingBlankLabel: "not set",
  missingFillerLabel: "set to a placeholder — needs the real value",
  missingVatNote:
    "And — only if the entity is VAT-registered — {vat}. Leave it unset if there is none and nothing is shown.",
  blocks: [
    {
      title: "Orders: who sells, and who takes the money",
      items: [
        "When you order from a store on Matjar, the sale is between you and that store directly. Matjar provides the page and the tools; the goods, the delivery and the returns are the store's responsibility.",
        "Every order is cash on delivery. The platform never holds or handles the customer's money, and there is no online payment and no card field anywhere on this site.",
        "Prices are set by the merchant. If you receive something other than what you ordered, or at a price other than the one shown, speak to the store first — and if that does not resolve it, report it to us.",
      ],
    },
    {
      title: "For merchants: what you get, and what you agree to",
      items: [
        "Opening a store is free, and the free plan lets you list up to {freeProducts} products. Paid plan prices are published on the pricing page.",
        "We never ask you for a card or bank details to open a store. A paid subscription is settled by arrangement with us, by hand — there is no online payment on the platform.",
        "0% commission on your sales. Your customers' money goes to you.",
        "Every store is reviewed before it publishes. If a store breaks Lebanese law or deceives its customers, we can suspend it or remove it from the platform.",
        "Your products and your customers' numbers belong to you. We do not sell or share them. There is no self-service export button yet — message us and we will send you your data or close your store.",
        "If you want to leave, transfer the store to someone else or ask us to close it. Do not delete your account while you still own a store — it would take the store and every order your customers placed with it.",
      ],
    },
    {
      title: "What may not be listed",
      items: [
        "Anything whose sale is prohibited under Lebanese law.",
        "A store or product that is not real, or images taken from someone else.",
        "Misleading information or prices.",
        "You can report any of these from the “Report a problem” button at the bottom of every store and product page.",
      ],
    },
    {
      title: "If something goes wrong",
      items: [
        "Report the page itself with “Report a problem”. The report is saved with its reason and the Matjar team reviews it — but we cannot promise a specific turnaround.",
        "If it is urgent, if it cost you money, or if you got no answer: message us directly on WhatsApp. That is the fastest route to a person.",
        "Returns and exchanges are arranged with the store. If the problem is not resolved, we step in and help both sides reach a fair solution.",
      ],
    },
    {
      title: "Changes to these terms",
      items: [
        "If we change anything on this page, the new text appears here. We do not apply a change retroactively to an order placed before it.",
      ],
    },
  ] as Block[],
  contactTitle: "Contact us",
  contactCta: "Message us on WhatsApp",
  contactPrefill: "Hello, I have a question about the legal terms on Matjar.",
  privacyCta: "Privacy policy",
  trustCta: "Trust & Safety",
};

/** The named blank. Loud on purpose: an owner who ships without reading this
 *  should still not be able to miss it, and a visitor should be told the page is
 *  incomplete rather than shown a gap they have to interpret. */
function NotConfigured({
  state,
  t,
}: {
  state: Extract<LegalEntityState, { configured: false }>;
  t: typeof AR;
}) {
  const status = (key: string) =>
    state.placeholders.includes(key as (typeof LEGAL_ENV_KEYS)[number])
      ? t.missingFillerLabel
      : t.missingBlankLabel;

  return (
    <div className="mt-4 rounded-2xl border-2 border-dashed border-danger/50 bg-danger-soft/40 p-5">
      <h3 className="flex items-start gap-2 font-extrabold text-danger">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        {t.missingTitle}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t.missingBody}
      </p>
      <ul className="mt-3 space-y-2">
        {[...state.missing, ...state.placeholders].map((key) => (
          <li key={key} className="text-sm">
            <code
              dir="ltr"
              className="inline-block rounded-md bg-surface px-2 py-1 font-mono text-xs font-bold"
            >
              {key}
            </code>
            <span className="ms-2 text-xs font-semibold text-muted-foreground">
              {status(key)}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t.entityLabels[key]}
            </span>
          </li>
        ))}
      </ul>
      {/* The variable name comes from the constant, not from the sentence, so a
          rename cannot leave the instructions pointing at a dead key. */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {t.missingVatNote.replace("{vat}", LEGAL_VAT_KEY)}
      </p>
    </div>
  );
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t: typeof AR = lang === "ar" ? AR : (EN as typeof AR);
  const state = readLegalEntity(process.env);

  if (!state.configured) {
    // Same shape as the assetlinks route: the deploy is broken in a way only a
    // log will reach the person who can fix it.
    console.error(
      `[legal] ${[...state.missing, ...state.placeholders].join(", ")} not usable. The /legal page cannot name the operating entity and is serving noindex. See src/lib/legal-entity.ts.`,
    );
  }

  return (
    <div className="py-10 sm:py-14">
      <Container className="max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t.title}
        </h1>

        {/* Said before anything else it might be weighed against. */}
        <div className="mt-6 rounded-2xl border border-border bg-surface-muted/40 p-4">
          <h2 className="text-sm font-extrabold">{t.draftTitle}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {t.draftBody}
          </p>
        </div>

        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Building2 className="h-5 w-5 text-primary" />
            {t.entityTitle}
          </h2>
          {state.configured ? (
            <dl className="mt-4 space-y-3">
              {LEGAL_ENV_KEYS.map((key) => (
                <div key={key}>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {t.entityLabels[key]}
                  </dt>
                  <dd className="mt-0.5 leading-7">{state.fields[key]}</dd>
                </div>
              ))}
              {state.vat && (
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {t.vatLabel}
                  </dt>
                  <dd className="mt-0.5 leading-7" dir="ltr">
                    {state.vat}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <NotConfigured state={state} t={t} />
          )}
        </section>

        {t.blocks.map((block) => (
          <section key={block.title} className="mt-8">
            <h2 className="text-lg font-bold">{block.title}</h2>
            <ul className="mt-3 space-y-3">
              {/* The free product cap in the merchants block is {freeProducts},
                  filled from planProductLimit("free") — the terms cannot quote a
                  cap the product no longer enforces. */}
              {block.items.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="leading-7 text-muted-foreground">{planCopy(item)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="mt-10">
          <h2 className="text-lg font-bold">{t.contactTitle}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={supportWaLink(t.contactPrefill)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
            >
              <MessageCircle className="h-4 w-4" />
              {t.contactCta}
            </a>
            <LegalLink lang={lang} href="privacy" label={t.privacyCta} />
            <LegalLink lang={lang} href="trust" label={t.trustCta} />
            <LegalLink
              lang={lang}
              href="contact"
              label={dict.footer.links.contact}
            />
          </div>
        </section>
      </Container>
    </div>
  );
}

function LegalLink({
  lang,
  href,
  label,
}: {
  lang: Locale;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={`/${lang}/${href}`}
      className="inline-flex min-h-11 items-center rounded-xl border border-border px-5 text-sm font-bold transition-colors hover:border-primary/40 hover:text-primary"
    >
      {label}
    </Link>
  );
}
