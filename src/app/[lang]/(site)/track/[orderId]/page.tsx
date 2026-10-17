import { notFound } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { subDict } from "@/lib/dict-slice";
import { Container } from "@/components/ui/container";
import { GuestOrderTracker } from "@/components/guest-order-tracker";

// Guest order tracking page. Reached from the order confirmation link; the
// order id is in the URL, the guest confirms with their phone.
export default async function TrackOrderPage({
  params,
}: {
  params: Promise<{ lang: string; orderId: string }>;
}) {
  const { lang, orderId } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.os.track;

  return (
    <div className="py-12">
      <Container className="max-w-lg">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <PackageSearch className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
            {t.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <GuestOrderTracker orderId={orderId} lang={lang as Locale} dict={{ ...subDict(dict, "orders", ["status"]), ...subDict(dict, "os", ["track"]) }} />
      </Container>
    </div>
  );
}
