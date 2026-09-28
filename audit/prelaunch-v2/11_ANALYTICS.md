# 11 — ANALYTICS & RETENTION

Zero-cost, first-party: events live in Matjar's own Postgres (`product_events`, migration 0312, applied). No SaaS, no Vercel custom events, no personal data (ids and slug tokens only; admin-only read; 120 events/min per session; batch ≤ 20).

Event whitelist (§34): search_started, search_submitted, search_result_clicked, zero_result, business_viewed, offering_viewed, favorite_added, contact_clicked, add_to_cart, booking_started, service_request_created, checkout_started, transaction_completed, job_viewed, job_applied, project_posted.

Firing today: business_viewed, offering_viewed, contact_clicked, transaction_completed, favorite_added. Searches and zero results are logged server-side in `search_logs` (0216). The rest are whitelisted and documented as one-line hooks in `audit/zero-sub/F5-attribution-analytics.md`.

Funnels (§35):
- Retail: search → store → product → cart → checkout → order
- Healthcare: search → clinic → service → booking
- Crafts: search / problem → provider or request → response
- Freelance: search → professional → contact / brief

Customer source attribution (F5): every order and booking is tagged once (directory, search, map, Sunday Market, offers, Instagram, WhatsApp, Google, direct, unknown) within 15 minutes of placement; merchants cannot relabel. New vs returning is computed, never stored. Merchant card «متجر جابلك X زبون جديد هالشهر بقيمة $Y».

Retention (§31, Phase 6): «طلباتي» shows ten kinds of activity with type-aware cards; order-again checks today's price and stock and adds to the cart; book-again and hire-again link back; the badge counts only actionable items. Details: `_work/p6-activity.md`.
