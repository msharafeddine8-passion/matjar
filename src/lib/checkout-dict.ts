// The dictionary the checkout subtree reads — CheckoutForm, OrderPlaced and
// the gift-card field — built once on the server for both entry points
// (StoreProducts on the storefront, ProductOrder on the product page).
//
// It used to be eight whole namespaces, `os` (~33K characters) among them,
// for the one `os.track` block the confirmation screen prints. Every
// storefront and product page paid for it in its HTML.

import type { Dictionary } from "@/i18n/get-dictionary";
import { dictSlice, subDict } from "@/lib/dict-slice";

export function checkoutDict(dict: Dictionary) {
  return {
    ...dictSlice(dict, ["store"]),
    ...subDict(dict, "account", ["address"]),
    ...subDict(dict, "auth", ["errorGeneric"]),
    ...subDict(dict, "loyaltyCards", ["checkout", "gift"]),
    ...subDict(dict, "orders", ["nextPending"]),
    ...subDict(dict, "os", ["track"]),
  };
}

export type CheckoutDict = ReturnType<typeof checkoutDict>;
