# 12 — ACCESSIBILITY, RTL, MOBILE (final QA, 2026-09-28)

Run against a local production build (`next build --webpack` + `next start`) of the branch.

| check | result |
|---|---|
| axe WCAG A/AA — home, explore, login, signup, a real storefront | 0 violations (e2e/accessibility.spec.ts) |
| RTL: `lang="ar"`, `dir="rtl"` on the document | pass |
| best-practice (reported, not enforced) | /ar/login and /ar/signup: landmark-one-main ×1, region ×8–10 |
| no horizontal scroll at 375 px | pass (e2e/mobile.spec.ts) |
| 17 routes × 6 widths (360–1440) | 102 × HTTP 200, 0 horizontal overflow (`shots/after/STATUS.md`) |
| smoke: Arabic search, empty state, login error, real 404s, no uncaught errors | 9 / 9 pass |
| store profile: retail leads with catalogue, clinic lists doctors, no analytics writes from tests | 3 / 3 pass |
| unit tests | 68 files, 1389 tests pass |

Found and fixed during QA: the home «تصفّح حسب التصنيف» grid left one tile alone on a second row at desktop; columns now follow the tile count.

Not verified: signed-in merchant and customer screens (no test account on production by design), printing, QR scanning and camera capture. These need a real phone and a real account.
