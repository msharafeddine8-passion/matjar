"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

export type NotFoundCopy = {
  title: string;
  body: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchSubmit: string;
  home: string;
  explore: string;
  askUs: string;
};

/**
 * The 404 in the visitor's own language.
 *
 * A not-found boundary receives no params, so the locale comes from the URL
 * the visitor is on (usePathname also resolves during SSR, so the first paint
 * is already in the right language). Both copies arrive from the server as
 * plain strings — no dictionary in the client bundle.
 *
 * It is a way forward, not a dead end: a search box that works without
 * JavaScript (a plain GET to /<lang>/search), home, explore, and a human.
 */
export function NotFoundBody({
  copies,
  supportHref,
}: {
  copies: { ar: NotFoundCopy; en: NotFoundCopy };
  supportHref: string;
}) {
  const pathname = usePathname() ?? "";
  const lang = pathname === "/en" || pathname.startsWith("/en/") ? "en" : "ar";
  const t = copies[lang];

  return (
    <div
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
      className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="text-5xl font-extrabold text-primary">404</p>
      <h1 className="text-2xl font-extrabold">{t.title}</h1>
      <p className="max-w-sm text-muted-foreground">{t.body}</p>

      <form
        action={`/${lang}/search`}
        method="get"
        role="search"
        className="flex w-full max-w-sm items-center gap-2"
      >
        <label htmlFor="nf-q" className="sr-only">
          {t.searchLabel}
        </label>
        <input
          id="nf-q"
          name="q"
          type="search"
          required
          enterKeyHint="search"
          placeholder={t.searchPlaceholder}
          className="h-11 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
        />
        <button
          type="submit"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Search aria-hidden className="h-4 w-4" />
          {t.searchSubmit}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href={`/${lang}`}
          className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-bold transition-colors hover:bg-surface-muted"
        >
          {t.home}
        </Link>
        <Link
          href={`/${lang}/explore`}
          className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-bold transition-colors hover:bg-surface-muted"
        >
          {t.explore}
        </Link>
      </div>

      {/* A dead link is often one somebody was GIVEN — a shop's card, a
          WhatsApp forward. A human can find the business; home cannot. */}
      <a
        href={supportHref}
        target="_blank"
        rel="noopener noreferrer"
        className="min-h-11 text-sm font-semibold text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-whatsapp"
      >
        {t.askUs}
      </a>
    </div>
  );
}
