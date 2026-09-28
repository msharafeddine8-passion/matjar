# 04 — OFFERING RESOLVER

One resolver, `src/lib/offering.ts` → `resolveOffering({ category, itemKind, enabledModules })`, decides how every offering behaves on every surface. Phase 1 widened it from variant / CTA / noun to the facts each surface needs:

| fact | physical product | appointment service | menu item |
|---|---|---|---|
| CTA | add to cart | book (or contact when the store has no booking module) | add to order |
| shows stock | yes | no | no |
| quantity / options | yes / variants | no / no | yes / modifiers |
| duration | no | yes | no |
| related rail | products | services | dishes |
| JSON-LD | Product + Offer | Service (no fake 0 price) | MenuItem |
| addable to cart | yes (unless directory-only sector) | never | yes |

Guarantees:
- A service can never enter a cart: `assertAddableToCart` in the browser, and a BEFORE INSERT trigger on `order_items` in the database (migration 0304, applied).
- Restaurant cards say «أضف إلى الطلب», matching the sticky CTA (was «أضف للسلة»).
- The service page carries no cart words; the only «منتج» left on it is the site-wide search hint.
- The profile engine (03) reuses the resolver for the store's primary CTA: «اطلب الآن» only when ordering really works.

Tests: `src/lib/__tests__/offering.test.ts`.
