// استيراد من إكسل — products, customers and ledger opening balances, every
// plan. The screen itself lives in components/importer/import-page.tsx so the
// older products/import route renders the very same importer. A tab can be
// opened directly with a hash (…/import#ledger), read in the browser, so this
// page never reads searchParams.
import { ImportPage } from "@/components/importer/import-page";

export default function StoreImportPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  return <ImportPage params={params} initial="products" />;
}
