# 14 — MERCHANT ADMIN & SUPER ADMIN IMPACT

Shared sources of truth now used by the dashboards:
- Pricing and limits: plan-tiers.ts via plan-copy.ts (subscription page, items limit gate, product form).
- Entitlements and feature status: the feature-availability.ts registry (module locks follow the enforced plan floor).
- Trust: lib/trust.ts; the admin plan dropdown no longer sets is_verified.
- Data quality: the admin stores list shows ok / incomplete / blocked with issues; blocked stores cannot be approved; merchants see their gaps in the checklist.

New merchant screens (on the branch, not yet deployed): ledger, abandoned carts, WhatsApp templates, Google feed, loyalty, gift cards, importer, quick panel «المساعد الذكي», Matjar summary report.

New admin screens: /admin/demand (unmet searches), /admin/market/queue (moderation queue with seller history).

Open (documented, not redesigned): a generic is_verified toggle still exists in admin and sets a column nothing reads (P0-TRUST-09, now P2); the POS "today" total counts gift-card-paid amounts as cash (F4 report).
