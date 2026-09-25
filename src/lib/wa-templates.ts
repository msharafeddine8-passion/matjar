// ===== WhatsApp action templates — pure =====
//
// Every WhatsApp action a merchant can take (confirm an order, send a status
// update, chase an abandoned cart, remind about a debt, confirm or remind a
// booking, ask for a review) is a FREE click-to-chat link:
//
//     https://wa.me/<number>?text=<encodeURIComponent(message)>
//
// The merchant taps, WhatsApp opens with the text filled in, the merchant
// presses send. No WhatsApp Business API, no SMS, no provider — zero recurring
// cost. This file decides WHAT the text says. It has no React, no Supabase and
// no dictionary import, so it runs identically on the server, in the browser
// and under vitest.
//
// Default wording lives HERE, in code, in Lebanese Arabic and English. A
// merchant may override any key/locale (public.store_wa_templates, 0309); no
// override row means the default below.
//
// ---------------------------------------------------------------------------
// VARIABLES — what a template may say, and where each one is available
// ---------------------------------------------------------------------------
//   {customer_name}  the customer's name as they gave it            (all)
//   {store_name}     the store's name                                (all)
//   {order_number}   the order reference the store and customer both
//                    see — "#" + the first 8 characters of the order id,
//                    exactly as the order list and the confirmation screen
//                    show it. Never the raw uuid.                    (orders)
//   {total}          "$25 (≈ 2,237,500 ل.ل.)" — USD, plus LBP at the live
//                    rate when one is set                            (orders, carts)
//   {items}          one "• name ×2" line per item, shortened to fit (orders, carts)
//   {eta}            expected delivery — ONLY from real data: the order's
//                    scheduled time, or its delivery zone's ETA range (order_confirmation)
//   {status}         the order's current status in words           (order_status)
//   {link}           the page the message points to: order tracking,
//                    the review form, the store, the booking, the
//                    ledger statement — only a page that exists     (all)
//   {balance}        what is owed, per currency, never converted    (debt_reminder)
//   {service}        the booked service                             (bookings)
//   {date} {time}    the booking's date and time                     (bookings)
//   {coupon}         a coupon code the merchant chose to attach      (abandoned_cart)
//
// ---------------------------------------------------------------------------
// MISSING VALUES — the one rule
// ---------------------------------------------------------------------------
// A message must never reach a customer with a raw "{eta}" in it, and must
// never invent a value (no made-up ETA, no fake tracking link). So when a
// variable has no value, THE WHOLE LINE IT SITS ON IS DROPPED. That is why the
// defaults put every optional variable on a line of its own: no ETA known →
// no "Expected delivery" line at all. The one exception is {customer_name},
// which empties quietly ("مرحبا {customer_name}،" → "مرحبا،") because a
// guest order may carry no name and a greeting is still a greeting.
// An unknown variable (a typo like {nmae}) is treated the same as a missing
// one when sending; the editor preview shows it highlighted so the merchant
// sees the typo before any customer does.
//
// ---------------------------------------------------------------------------
// LENGTH — the other rule
// ---------------------------------------------------------------------------
// Some WhatsApp clients truncate a wa.me URL at around 2,000 characters, and
// Arabic is six URL characters per letter once percent-encoded (ا → %D8%A7),
// so ~300 Arabic letters is already the limit. composeWaMessage() keeps the
// WHOLE URL under WA_URL_BUDGET: first by listing fewer items ("+ 3 غيرن"),
// then by dropping trailing lines (never the one carrying the link), and only
// as a last resort by cutting the text with "…".

import { waNumber, waUrl } from "@/lib/phone";
import { formatLbp, formatUsd } from "@/lib/currency";

// ---------------------------------------------------------------------------
// Keys, locales, variables
// ---------------------------------------------------------------------------

export const WA_TEMPLATE_KEYS = [
  "order_confirmation",
  "order_status",
  "review_request",
  "abandoned_cart",
  "booking_confirmation",
  "booking_reminder",
  "debt_reminder",
] as const;
export type WaTemplateKey = (typeof WA_TEMPLATE_KEYS)[number];

export function isWaTemplateKey(v: unknown): v is WaTemplateKey {
  return typeof v === "string" && (WA_TEMPLATE_KEYS as readonly string[]).includes(v);
}

export const WA_LOCALES = ["ar", "en"] as const;
export type WaLocale = (typeof WA_LOCALES)[number];

export function isWaLocale(v: unknown): v is WaLocale {
  return v === "ar" || v === "en";
}

export const WA_VARS = [
  "customer_name",
  "store_name",
  "order_number",
  "total",
  "items",
  "eta",
  "status",
  "link",
  "balance",
  "service",
  "date",
  "time",
  "coupon",
] as const;
export type WaVar = (typeof WA_VARS)[number];

export function isWaVar(v: string): v is WaVar {
  return (WA_VARS as readonly string[]).includes(v);
}

/** The variables each template can actually fill — the editor offers these as
 *  chips, and the preview flags any other variable as unavailable. */
export const WA_TEMPLATE_VARS: Record<WaTemplateKey, readonly WaVar[]> = {
  order_confirmation: ["customer_name", "store_name", "order_number", "items", "total", "eta", "link"],
  order_status: ["customer_name", "store_name", "order_number", "status", "total", "link"],
  review_request: ["customer_name", "store_name", "order_number", "link"],
  abandoned_cart: ["customer_name", "store_name", "items", "total", "coupon", "link"],
  booking_confirmation: ["customer_name", "store_name", "service", "date", "time", "link"],
  booking_reminder: ["customer_name", "store_name", "service", "date", "time", "link"],
  debt_reminder: ["customer_name", "store_name", "balance", "link"],
};

/** Which kind of record a template is about — the wa_action_log target_type. */
export type WaTargetType = "order" | "booking" | "cart" | "ledger_customer";

export const WA_TEMPLATE_TARGET: Record<WaTemplateKey, WaTargetType> = {
  order_confirmation: "order",
  order_status: "order",
  review_request: "order",
  abandoned_cart: "cart",
  booking_confirmation: "booking",
  booking_reminder: "booking",
  debt_reminder: "ledger_customer",
};

/** Variables that empty quietly instead of dropping their line. */
const SOFT_VARS: ReadonlySet<string> = new Set<WaVar>(["customer_name"]);

// ---------------------------------------------------------------------------
// Default wording (Lebanese Arabic + English). Short on purpose: see LENGTH.
// Every optional variable sits on its own line: see MISSING VALUES.
// ---------------------------------------------------------------------------

export const DEFAULT_WA_TEMPLATES: Record<WaTemplateKey, Record<WaLocale, string>> = {
  order_confirmation: {
    ar: [
      "مرحبا {customer_name}،",
      "معك {store_name}. وصلنا طلبك {order_number} وتأكّد.",
      "{items}",
      "المجموع: {total}",
      "التوصيل المتوقّع: {eta}",
      "فيك تتابع طلبك من هون: {link}",
      "شكراً إلك!",
    ].join("\n"),
    en: [
      "Hi {customer_name},",
      "This is {store_name}. We received your order {order_number} and it is confirmed.",
      "{items}",
      "Total: {total}",
      "Expected delivery: {eta}",
      "Follow your order here: {link}",
      "Thank you!",
    ].join("\n"),
  },
  order_status: {
    ar: [
      "مرحبا {customer_name}،",
      "طلبك {order_number} من {store_name} صار: {status}",
      "فيك تتابع طلبك من هون: {link}",
    ].join("\n"),
    en: [
      "Hi {customer_name},",
      "Your order {order_number} from {store_name} is now: {status}",
      "Follow your order here: {link}",
    ].join("\n"),
  },
  review_request: {
    ar: [
      "مرحبا {customer_name}،",
      "شكراً إنك طلبت من {store_name}! رأيك بيهمّنا كتير.",
      "قيّمنا من هون، ما بياخد دقيقة: {link}",
    ].join("\n"),
    en: [
      "Hi {customer_name},",
      "Thank you for ordering from {store_name}! Your opinion means a lot to us.",
      "Leave us a quick review here: {link}",
    ].join("\n"),
  },
  abandoned_cart: {
    ar: [
      "مرحبا {customer_name}،",
      "معك {store_name}. لاحظنا إنو طلبك ما كمل:",
      "{items}",
      "المجموع التقريبي: {total}",
      "كود حسم إلك: {coupon}",
      "إذا حابب تكمّل، نحنا هون: {link}",
    ].join("\n"),
    en: [
      "Hi {customer_name},",
      "This is {store_name}. We noticed your order did not go through:",
      "{items}",
      "Approximate total: {total}",
      "A discount code for you: {coupon}",
      "If you would like to finish it, we are here: {link}",
    ].join("\n"),
  },
  booking_confirmation: {
    ar: [
      "مرحبا {customer_name}،",
      "معك {store_name}. تأكّد موعدك:",
      "{service}",
      "التاريخ: {date}",
      "الساعة: {time}",
      "تفاصيل الموعد: {link}",
      "منستناك!",
    ].join("\n"),
    en: [
      "Hi {customer_name},",
      "This is {store_name}. Your appointment is confirmed:",
      "{service}",
      "Date: {date}",
      "Time: {time}",
      "Details: {link}",
      "See you then!",
    ].join("\n"),
  },
  booking_reminder: {
    ar: [
      "مرحبا {customer_name}،",
      "تذكير من {store_name} بموعدك:",
      "{service}",
      "التاريخ: {date}",
      "الساعة: {time}",
      "إذا في شي تغيّر، خبّرنا. منستناك!",
    ].join("\n"),
    en: [
      "Hi {customer_name},",
      "A reminder from {store_name} about your appointment:",
      "{service}",
      "Date: {date}",
      "Time: {time}",
      "If anything has changed, just let us know. See you!",
    ].join("\n"),
  },
  // Word for word the reminder the ledger shipped with (dict.ledger
  // .reminderTemplate), with the variables renamed to this file's names — so
  // wiring the ledger to this system changes nothing a customer receives.
  debt_reminder: {
    ar: "مرحبا {customer_name}، معك {store_name}. حبّينا نذكّرك إنو المبلغ المسجّل عالدفتر: {balance}. فيك تشوف كشف حسابك هون: {link}\nشكراً إلك.",
    en: "Hello {customer_name}, this is {store_name}. A friendly reminder that the amount on your account is {balance}. You can see your statement here: {link}\nThank you.",
  },
};

/** The body to use for a key/locale: the merchant's override when there is a
 *  non-blank one, otherwise the default. */
export type WaTemplateOverride = { key: string; locale: string; body: string };

export type ResolvedTemplates = Record<
  WaTemplateKey,
  Record<WaLocale, { body: string; custom: boolean }>
>;

export function resolveTemplates(
  overrides: readonly WaTemplateOverride[] | null | undefined,
): ResolvedTemplates {
  const out = {} as ResolvedTemplates;
  for (const key of WA_TEMPLATE_KEYS) {
    out[key] = {
      ar: { body: DEFAULT_WA_TEMPLATES[key].ar, custom: false },
      en: { body: DEFAULT_WA_TEMPLATES[key].en, custom: false },
    };
  }
  for (const o of overrides ?? []) {
    if (!isWaTemplateKey(o.key) || !isWaLocale(o.locale)) continue;
    const body = (o.body ?? "").trim();
    if (!body) continue;
    out[o.key][o.locale] = { body, custom: true };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export type WaValues = Partial<Record<WaVar, string | null | undefined>>;

// A variable is {identifier}: a letter or underscore, then letters, digits or
// underscores. Anything else in braces is ordinary text.
const VAR_RE = /\{([A-Za-z_][A-Za-z0-9_]{0,29})\}/g;

function present(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

// Marks where a soft variable emptied, so the tidy-up touches only the gap it
// left and never the text of a value ("#1 ?" in a coupon stays as typed).
const GAP = "\u0000";

/** Closes the gap an emptied {customer_name} leaves: "مرحبا ،" → "مرحبا،",
 *  "Hi ," → "Hi,", "Dear  welcome" → "Dear welcome". */
function closeGaps(s: string): string {
  return s
    .replace(new RegExp(`[ \\t]*${GAP}[ \\t]*([،,.!؟?:;])`, "g"), "$1")
    .replace(new RegExp(`[ \\t]*${GAP}[ \\t]*`, "g"), " ")
    .trim();
}

/**
 * Fills a template for SENDING. A line with a missing or unknown variable is
 * dropped (see MISSING VALUES); {customer_name} empties quietly. Consecutive
 * blank lines collapse to one and the result is trimmed. Returns "" when every
 * line was dropped — callers then fall back to the default template.
 */
export function renderWaTemplate(body: string, values: WaValues): string {
  const out: string[] = [];
  for (const rawLine of body.replace(/\r\n?/g, "\n").split("\n")) {
    let drop = false;
    let hadVar = false;
    let gap = false;
    const filled = rawLine.replace(VAR_RE, (_m, name: string) => {
      hadVar = true;
      if (!isWaVar(name)) {
        drop = true;
        return "";
      }
      const v = values[name];
      if (present(v)) return v.trim();
      if (SOFT_VARS.has(name)) {
        gap = true;
        return GAP;
      }
      drop = true;
      return "";
    });
    if (drop) continue;
    const line = gap ? closeGaps(filled) : filled.replace(/[ \t]+$/, "");
    if (hadVar && line.trim() === "") continue;
    out.push(line);
  }
  // Collapse runs of blank lines, trim blank lines at both ends.
  const collapsed: string[] = [];
  for (const l of out) {
    if (l === "" && (collapsed.length === 0 || collapsed[collapsed.length - 1] === "")) continue;
    collapsed.push(l);
  }
  while (collapsed.length && collapsed[collapsed.length - 1] === "") collapsed.pop();
  return collapsed.join("\n");
}

/** One piece of a template as the editor PREVIEW shows it. */
export type WaSegment =
  | { kind: "text"; text: string }
  /** A variable filled from the sample data. */
  | { kind: "value"; name: WaVar; text: string }
  /** A real variable this template cannot fill — left visible, flagged. */
  | { kind: "unavailable"; name: string; text: string }
  /** Not a variable at all (a typo) — left visible, flagged. */
  | { kind: "unknown"; name: string; text: string };

/**
 * The template split for the editor preview. Unlike renderWaTemplate nothing
 * is dropped: an unknown or unavailable variable stays on screen, marked, so
 * the merchant sees exactly what would be removed when sending.
 */
export function previewSegments(
  body: string,
  values: WaValues,
  allowed: readonly WaVar[] = WA_VARS,
): WaSegment[] {
  const segs: WaSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(VAR_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) segs.push({ kind: "text", text: body.slice(last, idx) });
    const name = m[1];
    if (!isWaVar(name)) {
      segs.push({ kind: "unknown", name, text: m[0] });
    } else if (!allowed.includes(name) || !present(values[name])) {
      segs.push({ kind: "unavailable", name, text: m[0] });
    } else {
      segs.push({ kind: "value", name, text: String(values[name]).trim() });
    }
    last = idx + m[0].length;
  }
  if (last < body.length) segs.push({ kind: "text", text: body.slice(last) });
  return segs;
}

/** Variable names used in a body that are not usable for this key. */
export function problemVars(body: string, key: WaTemplateKey): string[] {
  const allowed = WA_TEMPLATE_VARS[key];
  const bad = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) {
    const name = m[1];
    if (!isWaVar(name) || !allowed.includes(name)) bad.add(name);
  }
  return [...bad];
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type WaItem = { name: string; quantity: number };

/** "• كنزة ×2" per item; beyond `limit`, one "+ 3 غيرن" line. */
export function itemsText(
  items: readonly WaItem[],
  locale: WaLocale,
  limit: number = items.length,
): string {
  const shown = items.slice(0, Math.max(0, limit));
  const lines = shown.map((i) => `• ${i.name.trim()} ×${Math.max(1, Math.round(i.quantity))}`);
  const rest = items.length - shown.length;
  if (rest > 0) lines.push(locale === "ar" ? `+ ${rest} غيرن` : `+ ${rest} more`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The URL, and the length guard
// ---------------------------------------------------------------------------

/** Some clients cut a wa.me URL near 2,000 characters; stay well under it. */
export const WA_URL_LIMIT = 2000;
export const WA_URL_BUDGET = 1900;

// The one wa.me builder (lib/phone.ts), not a second copy of the format.
function urlFor(digits: string, text: string): string {
  return waUrl(digits, text);
}

export function waUrlLength(digits: string, text: string): number {
  return urlFor(digits, text).length;
}

export type ComposeInput = {
  /** The template body to render (an override or a default). */
  body: string;
  /** Rendered when `body` drops to nothing (every line had a missing value). */
  fallbackBody?: string;
  values: WaValues;
  /** When given, {items} is built from these and shortened first. */
  items?: readonly WaItem[];
  locale: WaLocale;
  /** Normalised number (from waNumber) — its length counts toward the URL. */
  digits?: string;
  budget?: number;
};

export type Composed = { text: string; truncated: boolean };

/** Cuts text by code points (never mid-surrogate) until the URL fits. */
function hardCut(digits: string, text: string, budget: number): string {
  const cps = Array.from(text);
  let lo = 0;
  let hi = cps.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = cps.slice(0, mid).join("").trimEnd() + "…";
    if (waUrlLength(digits, candidate) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : cps.slice(0, lo).join("").trimEnd() + "…";
}

/**
 * The message text, filled and guaranteed to fit a wa.me URL.
 *  1. render with every item;
 *  2. too long → list fewer items, ending with "+ N غيرن";
 *  3. still too long → drop trailing lines, keeping any line with the link;
 *  4. still too long → cut the text and end it with "…".
 */
export function composeWaMessage(input: ComposeInput): Composed {
  const digits = input.digits ?? "96100000000";
  const budget = input.budget ?? WA_URL_BUDGET;
  const items = input.items;

  const render = (limit: number): string => {
    const values: WaValues = { ...input.values };
    if (items) values.items = items.length ? itemsText(items, input.locale, limit) : null;
    let text = renderWaTemplate(input.body, values);
    if (!text && input.fallbackBody && input.fallbackBody !== input.body) {
      text = renderWaTemplate(input.fallbackBody, values);
    }
    return text;
  };

  const fits = (t: string) => waUrlLength(digits, t) <= budget;

  let text = render(items ? items.length : 0);
  if (fits(text)) return { text, truncated: false };

  if (items && items.length > 0) {
    for (let k = items.length - 1; k >= 0; k--) {
      text = render(k);
      if (fits(text)) return { text, truncated: true };
    }
  }

  const link = input.values.link?.trim();
  const lines = text.split("\n");
  while (lines.length > 1 && !fits(lines.join("\n"))) {
    let i = lines.length - 1;
    while (i > 0 && link && lines[i].includes(link)) i--;
    if (i <= 0) break;
    lines.splice(i, 1);
  }
  text = lines.join("\n");
  if (fits(text)) return { text, truncated: true };

  return { text: hardCut(digits, text, budget), truncated: true };
}

/**
 * The finished wa.me link for a customer's phone, or null when the number
 * cannot be dialled (the button is then disabled, never pointed at a dead
 * page). +961 normalisation is the shared helper's (src/lib/phone.ts).
 */
export function waActionHref(
  phone: string | null | undefined,
  input: Omit<ComposeInput, "digits">,
): { href: string; text: string; truncated: boolean } | null {
  const digits = waNumber(phone);
  if (!digits) return null;
  const { text, truncated } = composeWaMessage({ ...input, digits });
  if (!text) return null;
  return { href: urlFor(digits, text), text, truncated };
}

// ---------------------------------------------------------------------------
// Values: order numbers, money, statuses, times, links
// ---------------------------------------------------------------------------

/** The order reference the UI already shows everywhere: "#" + 8 characters. */
export function orderNumber(orderId: string): string {
  return `#${orderId.slice(0, 8)}`;
}

/** "$25 (≈ 2,237,500 ل.ل.)" — LBP only when a live rate is set. */
export function formatWaTotal(usd: number, rate: number, locale: WaLocale): string {
  const n = Number(usd);
  if (!Number.isFinite(n)) return "";
  const usdText = formatUsd(n, { cents: true });
  const lbp = rate > 0 && n > 0 ? formatLbp(n, rate, locale) : "";
  return lbp ? `${usdText} (${lbp})` : usdText;
}

const ORDER_STATUS_WORDS: Record<string, Record<WaLocale, string>> = {
  pending: { ar: "قيد المراجعة", en: "received, under review" },
  accepted: { ar: "انقبل", en: "accepted" },
  preparing: { ar: "عم نحضّرو", en: "being prepared" },
  ready: { ar: "جاهز", en: "ready" },
  out_for_delivery: { ar: "طلع مع الديليفري", en: "out for delivery" },
  completed: { ar: "تسلّم", en: "completed" },
  cancelled: { ar: "انلغى", en: "cancelled" },
  rejected: { ar: "ما انقبل", en: "not accepted" },
};

/** The status in words for the CUSTOMER (not the merchant's dashboard label). */
export function orderStatusWords(status: string, locale: WaLocale): string | null {
  return ORDER_STATUS_WORDS[status]?.[locale] ?? null;
}

/** Joins two currency amounts in a debt reminder. */
export const WA_AND: Record<WaLocale, string> = { ar: " و ", en: " and " };

const intlLocale = (l: WaLocale) => (l === "ar" ? "ar-LB-u-nu-latn" : "en-GB");

/** A timestamp as a Lebanese customer reads it: Beirut time, Western digits. */
export function formatWaDateTime(iso: string, locale: WaLocale): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Beirut",
  }).format(d);
}

/** A calendar date (yyyy-mm-dd) — no time zone shift, it is a day, not an
 *  instant. */
export function formatWaDate(ymd: string | null | undefined, locale: WaLocale): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(d);
}

/** "17:30" → "17:30"; anything that is not a time → null (line dropped). */
export function formatWaTime(t: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((t ?? "").trim());
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Expected delivery, ONLY from data the store actually has:
 *  - a scheduled order → the scheduled time;
 *  - a delivery zone with an ETA → its range in minutes;
 *  - otherwise null, and the {eta} line is dropped. Never a guess.
 */
export function formatWaEta(
  opts: {
    scheduledFor?: string | null;
    etaMinMinutes?: number | null;
    etaMaxMinutes?: number | null;
  },
  locale: WaLocale,
): string | null {
  if (opts.scheduledFor) return formatWaDateTime(opts.scheduledFor, locale);
  const lo = Number(opts.etaMinMinutes);
  const hi = Number(opts.etaMaxMinutes);
  const okLo = Number.isFinite(lo) && lo > 0;
  const okHi = Number.isFinite(hi) && hi > 0;
  const unit = locale === "ar" ? "دقيقة" : "minutes";
  if (okLo && okHi && hi > lo) return `${lo}–${hi} ${unit}`;
  if (okLo || okHi) return `${okHi ? hi : lo} ${unit}`;
  return null;
}

/** Where an order message may send the customer. An order placed with an
 *  account opens on its own order page (which is also where the review form
 *  lives); a guest order has the phone-verified tracker. */
export function orderLinkPath(
  lang: WaLocale,
  orderId: string,
  hasAccount: boolean,
): string {
  return hasAccount ? `/${lang}/orders/${orderId}` : `/${lang}/track/${orderId}`;
}

/** The review form exists only for an account order (reviews are tied to the
 *  customer's account and a completed order) — null otherwise, so the button
 *  never sends a link to a form the customer cannot use. */
export function reviewLinkPath(
  lang: WaLocale,
  orderId: string,
  hasAccount: boolean,
): string | null {
  return hasAccount ? `/${lang}/orders/${orderId}` : null;
}

/** The customer's own booking page — account bookings only. */
export function bookingLinkPath(
  lang: WaLocale,
  bookingId: string,
  hasAccount: boolean,
): string | null {
  return hasAccount ? `/${lang}/bookings/${bookingId}` : null;
}

/** The public store page. A cart lives in the customer's own browser, so no
 *  link can honestly "reopen their cart" — the store page is the truthful
 *  destination. */
export function storeLinkPath(
  lang: WaLocale,
  storeId: string,
  slug: string | null | undefined,
): string {
  return `/${lang}/${slug ? slug : `store/${storeId}`}`;
}

export function absoluteLink(origin: string, path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

// ---------------------------------------------------------------------------
// Sample data for the editor preview
// ---------------------------------------------------------------------------

export const WA_SAMPLE_VALUES: Record<WaLocale, WaValues> = {
  ar: {
    customer_name: "رنا",
    store_name: "متجرك",
    order_number: "#a1b2c3d4",
    total: "$25 (≈ 2,237,500 ل.ل.)",
    items: "• منقوشة زعتر ×2\n• عصير ليمون ×1",
    eta: "30–45 دقيقة",
    status: "طلع مع الديليفري",
    link: "https://matjarlb.com/ar/track/a1b2c3d4",
    balance: "$40 و 1,500,000 ل.ل.",
    service: "قص شعر",
    date: "الخميس 2 تشرين الأول",
    time: "17:30",
    coupon: "WELCOME10",
  },
  en: {
    customer_name: "Rana",
    store_name: "Your store",
    order_number: "#a1b2c3d4",
    total: "$25 (≈ 2,237,500 LBP)",
    items: "• Zaatar manoushe ×2\n• Lemonade ×1",
    eta: "30–45 minutes",
    status: "out for delivery",
    link: "https://matjarlb.com/en/track/a1b2c3d4",
    balance: "$40 and 1,500,000 LBP",
    service: "Haircut",
    date: "Thursday 2 October",
    time: "17:30",
    coupon: "WELCOME10",
  },
};

// ---------------------------------------------------------------------------
// Phones and abandoned carts
// ---------------------------------------------------------------------------

/**
 * A phone reduced for MATCHING (not display). Mirrors public.wa_phone_key in
 * 0309: digits only, no 00 prefix, no 961 in front of a Lebanese national
 * number, no trunk zero. For a Lebanese number this is waNumber() without its
 * 961; a foreign number keeps its digits so it still matches itself.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const wa = waNumber(raw);
  if (wa) return wa.slice(3);
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("961") && d.length >= 10 && d.length <= 12) d = d.slice(3);
  d = d.replace(/^0+/, "");
  return d || null;
}

export const ABANDONED_MIN_AGE_MS = 60 * 60 * 1000;
export const ABANDONED_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The same rule as public.store_abandoned_carts, for the fallback path the
 * screen uses before 0309 is applied: last touched 1 hour to 14 days ago, and
 * no order from the same phone at the store since then.
 */
export function isAbandonedCart(
  intent: { phone: string | null; updated_at: string },
  orders: readonly { phone: string | null; created_at: string }[],
  now: Date = new Date(),
): boolean {
  const touched = new Date(intent.updated_at).getTime();
  if (Number.isNaN(touched)) return false;
  const age = now.getTime() - touched;
  if (age <= ABANDONED_MIN_AGE_MS || age >= ABANDONED_MAX_AGE_MS) return false;
  const key = phoneKey(intent.phone);
  if (!key) return true;
  return !orders.some(
    (o) => new Date(o.created_at).getTime() >= touched && phoneKey(o.phone) === key,
  );
}

/** One line of an abandoned cart, priced from the CURRENT catalogue. */
export type CartLine = {
  product_id: string | null;
  name: string;
  name_en: string | null;
  quantity: number;
  /** null when the product no longer exists in this store — never guessed. */
  unit_price: number | null;
  available: boolean;
};

export type CatalogueProduct = {
  id: string;
  name: string;
  name_en: string | null;
  price: number | string | null;
  discount_price: number | string | null;
  is_available: boolean | null;
};

/**
 * The intent's stored items (product id, name, quantity — no prices) priced at
 * today's catalogue. Mirrors the `lines` step of public.store_abandoned_carts:
 * a live discount below the price wins, a product that is gone keeps its
 * stored name and has no price, and the estimate sums only priced lines.
 */
export function priceCart(
  rawItems: unknown,
  products: ReadonlyMap<string, CatalogueProduct>,
): { lines: CartLine[]; itemCount: number; totalEstimate: number; unpriced: number } {
  const arr = Array.isArray(rawItems) ? rawItems : [];
  const lines: CartLine[] = [];
  let cents = 0;
  let count = 0;
  let unpriced = 0;
  for (const raw of arr) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const pid = typeof it.product_id === "string" ? it.product_id : null;
    const p = pid ? products.get(pid) : undefined;
    const q = String(it.quantity ?? "");
    const quantity = /^\d{1,4}$/.test(q) ? Math.max(1, Math.min(999, Number(q))) : 1;
    let unit: number | null = null;
    if (p) {
      const price = Number(p.price);
      const disc = p.discount_price == null ? NaN : Number(p.discount_price);
      unit = Number.isFinite(disc) && disc > 0 && disc < price ? disc : price;
      if (!Number.isFinite(unit)) unit = null;
    }
    const storedName = typeof it.name === "string" && it.name.trim() ? it.name.trim() : "—";
    lines.push({
      product_id: p ? p.id : null,
      name: p?.name ?? storedName,
      name_en: p?.name_en ?? null,
      quantity,
      unit_price: unit,
      available: !!p && p.is_available === true,
    });
    count += quantity;
    if (unit == null) unpriced += 1;
    else cents += Math.round(unit * 100) * quantity;
  }
  return { lines, itemCount: count, totalEstimate: cents / 100, unpriced };
}

export type CouponRow = {
  code: string;
  is_active: boolean | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number | null;
};

/** Coupons a customer could actually redeem right now — the only ones worth
 *  offering in a reminder. */
export function usableCoupons<T extends CouponRow>(rows: readonly T[], now: Date = new Date()): T[] {
  return rows.filter(
    (c) =>
      c.is_active === true &&
      !!c.code?.trim() &&
      (!c.expires_at || new Date(c.expires_at).getTime() > now.getTime()) &&
      (c.max_uses == null || (c.used_count ?? 0) < c.max_uses),
  );
}

// ---------------------------------------------------------------------------
// «آخر إرسال: من 3 أيام»
// ---------------------------------------------------------------------------

export type Since =
  | { unit: "now" }
  | { unit: "minutes" | "hours" | "days"; n: number };

export function sinceParts(iso: string, now: Date = new Date()): Since | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (s < 60) return { unit: "now" };
  const m = Math.floor(s / 60);
  if (m < 60) return { unit: "minutes", n: m };
  const h = Math.floor(m / 60);
  if (h < 24) return { unit: "hours", n: h };
  return { unit: "days", n: Math.floor(h / 24) };
}

/** Arabic counts take four shapes: يوم / يومين / 3 أيام / 11 يوم. */
export type PluralForm = "one" | "two" | "few" | "many";

export function pluralForm(n: number, locale: WaLocale): PluralForm {
  if (locale === "en") return n === 1 ? "one" : "many";
  if (n === 1) return "one";
  if (n === 2) return "two";
  if (n >= 3 && n <= 10) return "few";
  return "many";
}
