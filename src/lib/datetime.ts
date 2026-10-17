// One way to print an instant: Beirut wall-clock time, Western digits.
//
// `toLocaleString(lang === "ar" ? "ar" : "en", …)` was the pattern on the
// orders list, the order card, the timeline and the invoice. It has two faults
// that show up on every Lebanese merchant's screen: plain `ar` renders Eastern
// Arabic digits (٣:٤٥) while every price beside it is 0-9, and with no
// `timeZone` the server renders in UTC — a 9pm order printed "6:00 PM" on the
// receipt, three hours off. Same rules as formatInstant in lib/activity.ts,
// kept in a dependency-free module so client components can import it cheaply.

const localeFor = (lang: string) =>
  lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB";

export type BeirutDateTimeStyle =
  /** "28 Sep, 21:05" — lists and timelines. */
  | "short"
  /** "28 Sep 2026, 21:05" — printed documents. */
  | "long"
  /** "21:05" — a card for something that happened today. */
  | "time";

const OPTIONS: Record<BeirutDateTimeStyle, Intl.DateTimeFormatOptions> = {
  short: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  long: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
  time: { hour: "2-digit", minute: "2-digit" },
};

const CACHE = new Map<string, Intl.DateTimeFormat>();

export function formatBeirutDateTime(
  iso: string | null | undefined,
  lang: string,
  style: BeirutDateTimeStyle = "short",
): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const key = `${lang}|${style}`;
  let f = CACHE.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(localeFor(lang), {
      ...OPTIONS[style],
      timeZone: "Asia/Beirut",
    });
    CACHE.set(key, f);
  }
  return f.format(t);
}
