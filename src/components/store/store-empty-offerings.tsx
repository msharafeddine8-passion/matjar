import { PackageOpen } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { FollowButton } from "@/components/follow-button";
import { MessageStoreButton } from "@/components/message-store-button";
import { dictSlice } from "@/lib/dict-slice";

/**
 * What a real store's page says where its offerings would be, while it has
 * none yet.
 *
 * 9 of the 21 live stores had no product or service, and their page went from
 * the header straight to the footer — or, worse, to delivery and pickup terms
 * for nothing that could be ordered. The profile engine omits an empty
 * catalogue (rightly: no dashed «no products» box on a store that HAS a
 * catalogue somewhere else on the page), so this is the one place that says
 * the plain truth instead: nothing is listed yet, and here is how to hear when
 * it is. The two actions are the header's own, non-compact.
 */
export function StoreEmptyOfferings({
  storeId,
  lang,
  dict,
  isFollowing,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  isFollowing: boolean;
}) {
  const t = dict.store.emptyOfferings;
  return (
    <section
      aria-labelledby="store-empty-offerings"
      className="mt-8 rounded-2xl border border-dashed border-border px-5 py-10 text-center sm:py-14"
    >
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <PackageOpen aria-hidden className="h-7 w-7" />
      </span>
      <h2 id="store-empty-offerings" className="mt-4 text-lg font-bold">
        {t.title}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {t.body}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <FollowButton
          storeId={storeId}
          following={isFollowing}
          lang={lang}
          dict={dictSlice(dict, ["store"])}
        />
        <MessageStoreButton storeId={storeId} lang={lang} dict={dictSlice(dict, ["messages"])} />
      </div>
    </section>
  );
}
