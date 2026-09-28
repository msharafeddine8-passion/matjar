import Image from "next/image";
import {
  Clock,
  MapPin,
  MessageCircle,
  Phone,
  Star,
  BadgeCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { StoreView } from "@/lib/data/store-view";
import { SITE_URL } from "@/lib/site";
import { waLink } from "@/lib/phone";
import { parseHours, isOpenNow, daySpan } from "@/lib/hours";
import { FollowButton } from "@/components/follow-button";
import { ShareButton } from "@/components/share-button";
import { MessageStoreButton } from "@/components/message-store-button";
import { PaidPlanBadge, TrustBadges } from "@/components/trust-badges";
import { resolvePaidStatus, resolveStoreTrust } from "@/lib/trust";
import {
  QUICK_ACTION_BASE,
  QUICK_ACTION_LABEL,
} from "@/components/quick-action";
import { StoreAbout } from "@/components/store/store-about";

export function StoreHeader({
  store,
  id,
  Icon,
  style,
  dict,
  lang,
  hasVerified,
  headerRating,
  headerCount,
  ordersFulfilled,
  isFollowing,
}: {
  store: StoreView;
  id: string;
  Icon: LucideIcon;
  style: { cover: string; iconWrap: string };
  dict: Dictionary;
  lang: Locale;
  hasVerified: boolean;
  headerRating: number | null;
  headerCount: number;
  ordersFulfilled: number;
  isFollowing: boolean;
}) {
  const cat = dict.catalog[store.category];
  // Instagram / Facebook / website — built from the merchant's own fields, so a
  // shop that filled in none of them gets no row at all rather than an empty
  // one. Listed once here because the phone and the desktop each render it in
  // the place that suits them.
  const elsewhere = [
    store.instagram && {
      href: store.instagram,
      label: dict.merchant.instagram,
    },
    store.facebook && { href: store.facebook, label: dict.merchant.facebook },
    store.website && { href: store.website, label: dict.merchant.website },
  ].filter(Boolean) as { href: string; label: string }[];
  // Trust and paid status resolved apart (lib/trust.ts). `hasVerified` is the
  // page's `verifications.some(v => v.status === "verified")`; the header only
  // has the boolean, so it is passed as such.
  const trust = resolveStoreTrust({
    commercialRegVerified: store.registered,
    hasVerifiedDocument: hasVerified,
  });
  const paid = resolvePaidStatus(store.plan);
  return (
    <div className="relative z-10 -mt-6 rounded-2xl border border-border bg-surface p-5 shadow-md sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface shadow-md ring-4 ring-surface">
            {store.logoUrl ? (
              <Image src={store.logoUrl} alt={store.name} width={64} height={64} className="h-full w-full object-cover" sizes="64px" />
            ) : (
              <span
                className={`flex h-full w-full items-center justify-center rounded-2xl ${style.iconWrap}`}
              >
                <Icon className="h-7 w-7" />
              </span>
            )}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {/* dir=auto keeps Latin names with trailing digits from
                  bidi-reordering inside the RTL document. */}
              <h1
                dir="auto"
                className="text-2xl font-extrabold tracking-tight sm:text-3xl"
              >
                {store.name}
              </h1>
              {/* The "مفتوح الآن" pill that used to sit here was reading
                  store.status === 'active' — platform approval, not opening
                  hours. It said open at 3am, next to the real hours badge a few
                  lines below saying closed. One of them had to go, and it was
                  never going to be the one that reads the clock. */}
              {paid.showsProMarker && (
                <PaidPlanBadge dict={dict} lang={lang} />
              )}
              <TrustBadges signals={trust} dict={dict} lang={lang} />
            </div>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{cat.name}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {headerRating != null && (
                <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1">
                  <Star className="h-4 w-4 fill-accent-foreground text-accent-foreground" />
                  <span className="font-bold">{headerRating.toFixed(1)}</span>
                  <span className="text-muted-foreground">
                    ({headerCount} {dict.featured.reviews})
                  </span>
                </span>
              )}
              {ordersFulfilled > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 font-semibold text-success">
                  <BadgeCheck className="h-4 w-4" />
                  {dict.store.ordersFulfilled.replace(
                    "{n}",
                    String(ordersFulfilled),
                  )}
                </span>
              )}
              {store.prepTime && store.acceptsDelivery && (
                <span className="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {dict.store.deliveryIn.replace("{t}", store.prepTime)}
                </span>
              )}
              {store.area && (
                <span className="flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {store.area}
                </span>
              )}
              {(() => {
                // Structured hours win: live open/closed + today's span.
                const wh = parseHours(store.hours);
                // Server render reads the clock once per request.
                const now = new Date();
                const open = isOpenNow(wh, now);
                const span = daySpan(wh, now);
                if (open != null) {
                  return (
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          open
                            ? "bg-success-soft text-success"
                            : "bg-danger-soft text-danger"
                        }`}
                      >
                        {open
                          ? dict.os.hours.openNow
                          : dict.os.hours.closedNow}
                      </span>
                      {span && (
                        <span
                          className="text-muted-foreground"
                          dir="ltr"
                        >
                          {span.open}–{span.close}
                        </span>
                      )}
                    </span>
                  );
                }
                // No grid, nothing to say. The free-text fallback that used to
                // live here is retired (0244) — every store that relied on it
                // had its sentence folded into the grid, and the box is gone
                // from the merchant form, so this can no longer be reached by
                // anything but stale data.
                return null;
              })()}
            </div>
          </div>
        </div>

        {/* Quick actions (§17). Below `lg` this is one row of icon-only 44px
            targets — save, share, message, call, WhatsApp — because that is
            what "what can I do" needs to be on a phone. It used to be seven
            labelled pills that wrapped over three rows, cost 130px of an 844px
            screen, and were 38px tall to the last one. From `lg` up every pill
            is back with its word, in the same order, unchanged. */}
        <div className="flex flex-wrap gap-1.5 lg:gap-2">
          {store.isReal && (
            <FollowButton
              compact
              storeId={id}
              following={isFollowing}
              lang={lang}
              dict={dict}
            />
          )}
          <ShareButton
            compact
            title={store.name}
            dict={dict}
            url={
              store.slug
                ? `${SITE_URL}/${lang}/${store.slug}`
                : `${SITE_URL}/${lang}/store/${id}`
            }
          />
          {store.isReal && (
            <MessageStoreButton compact storeId={id} lang={lang} dict={dict} />
          )}
          {store.phone && (
            <a
              href={`tel:${store.phone}`}
              aria-label={dict.store.call}
              className={`flex items-center gap-1.5 rounded-xl border border-border text-sm font-semibold transition-colors hover:bg-surface-muted ${QUICK_ACTION_BASE}`}
            >
              <Phone className="h-4 w-4" />
              <span className={QUICK_ACTION_LABEL}>{dict.store.call}</span>
            </a>
          )}
          {store.whatsapp && (
            <a
              href={waLink(store.whatsapp) ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={dict.store.whatsapp}
              className={`flex items-center gap-1.5 rounded-xl bg-whatsapp text-sm font-semibold text-whatsapp-foreground transition-colors hover:bg-whatsapp-hover ${QUICK_ACTION_BASE}`}
            >
              <MessageCircle className="h-4 w-4" />
              <span className={QUICK_ACTION_LABEL}>{dict.store.whatsapp}</span>
            </a>
          )}
          {/* The merchant's other homes. They are links AWAY from the profile,
              so on a phone they do not compete with the actions above: from
              `lg` up they stay exactly where they were, and below `lg` the same
              three render once more under the description (see `elsewhere`).
              Two copies of a plain anchor, one of them always display:none —
              cheaper than moving the desktop cluster and calling it a fix. */}
          {elsewhere.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center rounded-xl border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted lg:flex"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>

      {store.description && (
        <StoreAbout
          text={store.description}
          more={dict.store.readMore}
          less={dict.store.readLess}
        />
      )}

      {elsewhere.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 lg:hidden">
          {elsewhere.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="relative inline-flex h-11 items-center text-sm font-semibold text-primary underline underline-offset-4"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
