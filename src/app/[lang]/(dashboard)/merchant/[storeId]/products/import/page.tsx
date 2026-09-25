// Bulk product import — now the products tab of the one importer
// (components/importer). Kept at this address because the catalogue screen's
// «استيراد من إكسل» button and merchants' bookmarks point here.
//
// The product rules are the ones import_products() enforces in the database
// (0214, generalised by 0311): the plan's product cap, all-or-nothing, code
// match with an exact-name fallback. What the screen shows is the explanation;
// the database is the gate.
import { ImportPage } from "@/components/importer/import-page";

export default function ProductImportPage({
  params,
}: {
  params: Promise<{ lang: string; storeId: string }>;
}) {
  return <ImportPage params={params} initial="products" />;
}
