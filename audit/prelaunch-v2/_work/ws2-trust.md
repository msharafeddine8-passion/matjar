# WS2 — PRO IS NOT VERIFIED (P0 trust model)

Branch `feat/matjar-prelaunch-foundation`, working tree only. Nothing committed, nothing pushed, no build, no DB change.

## Files changed

- `src/lib/trust.ts` — NEW. The single trust resolver: `TrustKind`, `TrustSignal`, `resolveStoreTrust`, `resolveProfessionalTrust`, `resolvePaidStatus` (separate type, never a signal), `trustAnchor`, `paidAnchor`, `TRUST_KINDS`.
- `src/components/trust-badges.tsx` — NEW. `<TrustBadges>` (one icon per kind, one success tone, `title`/`aria-label` naming what was checked, each pill links to `/{lang}/trust#{kind}`; `variant="mark"` for cards that are themselves a link) and `<PaidPlanBadge>` (Crown + accent, `title`="اشتراك مدفوع"/"Paid plan", links to `/trust#paid`).
- `src/lib/__tests__/trust.test.ts` — NEW. 17 tests (see below).
- `src/components/store-card.tsx` — ad-hoc verified/registered pills and `ProBadge` replaced by `<PaidPlanBadge>` + `<TrustBadges>`; dict Pick gains `"trust"`.
- `src/components/store/store-header.tsx` — same replacement; the two BadgeCheck pills with two meanings are gone.
- `src/app/[lang]/(site)/trust/page.tsx` — new "شو يعني كل شارة" section: one `<article id={kind}>` per TrustKind (`#registration`, `#documents`, `#identity`) plus `#paid`, each with "what we checked" / "what it does not mean".
- `src/i18n/dictionaries/ar.json`, `en.json` — new top-level `trust` namespace (one Edit each); plus `professional.trust.identity` / `identityWhy` reworded from "ID verified / we checked their ID" to "reviewed by the Matjar team" (the app collects no ID document — see below). Both files still parse, CRLF intact (5018 CR = 5018 LF).
- `src/components/gig-card.tsx`, `src/app/[lang]/(site)/freelance/[id]/page.tsx` — the bare blue `BadgeCheck` with aria "هويّة موثّقة من متجر" replaced by `<TrustBadges variant="mark">` fed by `resolveProfessionalTrust({ identityVerified })`.
- `src/components/admin-stores-client.tsx` — the plan `<select>` no longer writes `is_verified: true` when a paid plan is assigned (root cause of PRO = VERIFIED at the data level). One-line patch, comment explains.
- `src/components/explore-client.tsx`, `src/components/discovery-page.tsx`, `src/components/for-you-strip.tsx`, `src/app/[lang]/(site)/page.tsx` — `"trust"` added to the dictionary slices that feed `StoreCard` across a client boundary (type-required; ~1.5KB extra per island).
- `src/components/pro-badge.tsx` — untouched, now unused (both callers moved to `PaidPlanBadge`). Safe to delete in a follow-up.

## What each trust kind means and which column backs it

| kind | column | admin flow that writes it | customer copy claims |
|---|---|---|---|
| `registration` | `stores.commercial_reg_verified` | admin/stores overflow menu "وثّق السجل" (`admin-stores-client.tsx`), shown only when `commercial_reg_no` is set. Admin sees the number and toggles. No registry API call anywhere. | The merchant typed a registration number; a team member reviewed it by hand and confirmed. Explicitly: manual review, not an official-registry lookup; the number is not shown; no quality guarantee. |
| `documents` | `store_verifications.status = 'verified'` | admin/verifications queue (`admin-verification-actions.tsx`): admin sees kind (license/certificate/accreditation/award), issuer, number, dates, the uploaded doc and `verify_url`, clicks approve/reject. `submitted` and `rejected` never count. | The merchant uploaded a document; the team opened it, followed its verification link when there was one, and approved it. Explicitly: we review the document, we do not contact the issuer; expired docs are marked. |
| `identity` | `craft_providers.verified` (+`verified_at`, `admin-craft-actions.tsx`) and `profiles.freelancer_verified` (`set_freelancer_verified` RPC, super admin only, `freelancer-verify-list.tsx`) | A hand toggle on the provider/freelancer after looking at the profile and listings. No ID document exists anywhere in the join forms or the admin screens. | "موثّق من فريق متجر / Reviewed by Matjar": a team member reviewed the account by hand. Explicitly: the app does not collect an official ID, so this is a team review, not a government identity check. |

Paid status (`stores.plan`) is resolved by `resolvePaidStatus()` into a `PaidStatus` type that shares no field with `TrustSignal`; the test suite asserts it never appears in a trust array. The Pro marker stays visible to customers (business decision kept) but is now Crown + accent, titled "اشتراك مدفوعة", and links to `/trust#paid` whose copy says "الاشتراك ما بيعطي ولا شارة توثيق".

## What `stores.is_verified` turned out to mean

Two writers, neither of which records a dimension:
1. `admin-stores-client.tsx` — a generic "verify / unverify" overflow action (BadgeCheck icon) with no note, no document, no field.
2. `admin-stores-client.tsx` plan `<select>` — wrote `is_verified: true` for ANY paid tier ("Any paid plan implies an active/verified store"). `admin-subs-client.tsx` had already removed the same coupling from the payment-recording path, but the plan dropdown still had it.

So `is_verified = true` meant "an admin clicked a button, or the store was given a paid plan" — a badge whose subject can buy it. It cannot be mapped to any honest customer sentence, so **`resolveStoreTrust` accepts it and ignores it** (tested), no surface renders it, and writer #2 is removed. The column stays for admin bookkeeping; `feature-availability.ts` (not mine) still cites it as evidence for `verifiedBadge` — the real evidence is now `store_verifications`, worth a one-word fix by that file's owner.

## Deliberately left unrendered / unchanged

- `stores.is_verified` — see above. Reported, not rendered.
- `ProfessionalTrust.phoneVerified` / `credentialVerified` — the type has the fields; no flow in the repo sets them (no OTP, no credential upload). `TrustKind` excludes `phone`/`credential` so the /trust page cannot describe a check nobody performs. `professional.trust.phone*/credential*/business*` dictionary keys remain, dead.
- `src/components/professional/professional-trust-badges.tsx` and `professional-card.tsx` — left on their existing per-fact `<details>` model (already the right shape); only their identity copy was corrected. Rewiring them to `TrustBadges` would force `"trust"` into every `dictSlice(dict, ["professional"])` caller (3 sites) for no customer-visible gain.
- `src/components/hub/leaders-directory.tsx:275` — renders `t.verified` ("موثّق") on EVERY leader card unconditionally, from a label prop, with no data field behind it. Out of my territory and I could not establish what backs hub leaders; flagged as P0-TRUST-07 for the hub owner.
- `trustPage.customer[1].d` (existing copy "ولساتها ما انعطت لحدا") and `pricing.featureNotes.verifiedBadge` — left as they are; both are still true today and consistent with the model. `trust.nobodyYet` was added as a key but is not rendered (a live-data claim belongs next to a count, not in static copy).
- Old keys `featured.verified`, `featured.registered`, `discovery.verified`, `discovery.registered`, `verifications.verifiedBadge`, `freelance.verifiedTitle` — now unused by customer surfaces (`discovery.registered/verified` may still feed facet counts in `discovery.ts`, not a badge). Left in place as instructed.
- `store-verifications.tsx` (public certificates section) — still uses `verifications.verifiedDoc`/`selfDeclared` per row, which is per-document status, not a store badge; consistent with the model, untouched.

## CSV

issue_id|priority|area|route|sector|problem|root_cause|fix|file|status|before|after|notes
P0-TRUST-01|P0|trust|/[lang]/store/[id], /[lang]/explore, /[lang]/search, /[lang]/favorites, home rails|all|Admin plan dropdown wrote is_verified=true for any paid tier, so buying Pro/Basic/Business set a trust column|Coupling in the plan <select> patch ("Any paid plan implies an active/verified store")|Patch sends {plan} only; verification moves through its own toggles and store_verifications|src/components/admin-stores-client.tsx|fixed|assigning a paid plan flipped is_verified to true|plan changes touch plan only|admin-subs-client had already removed the same coupling on the payment path; this was the remaining writer
P0-TRUST-02|P0|trust|/[lang]/store/[id], store cards everywhere|all|Generic "موثّق" pill rendered from stores.is_verified with no statement of what was verified|is_verified is a dimensionless admin toggle and was also written by plan changes (01)|resolveStoreTrust ignores is_verified; no surface renders a badge from it|src/lib/trust.ts, src/components/store-card.tsx|fixed|BadgeCheck "موثّق" pill when is_verified|nothing; column kept for admin bookkeeping|all 15 stores are false today, so no visible change; the model is now correct before the first grant
P0-TRUST-03|P0|trust|/[lang]/store/[id]|all|Store header used the same BadgeCheck icon for "registered" and "has a verified document" — two meanings, one glyph, both bare "موثّق"-style pills|Ad-hoc markup per surface, no shared resolver|<TrustBadges>: Landmark=registration, FileCheck2=documents, UserCheck=identity; one tone; title/aria names the check; links to /trust#kind|src/components/store/store-header.tsx, src/components/trust-badges.tsx|fixed|two BadgeCheck pills "سجل تجاري موثّق" + "موثّق"|"سجل تجاري مؤكّد" + "مستند موثّق", each a link with an explanatory title|
P0-TRUST-04|P0|trust|store cards + header|all|Pro badge sat in the same row, same shape as trust pills with no title, readable as a verification tick|ProBadge had no semantics beyond Crown|PaidPlanBadge: Crown + accent tone, title="اشتراك مدفوع"/"Paid plan", aria "Pro — paid plan", links to /trust#paid|src/components/trust-badges.tsx, store-card.tsx, store-header.tsx|fixed|<Badge accent><Crown/>Pro</Badge> with no title|same look, titled and linked to the paragraph that says a plan buys no verification|pro-badge.tsx now unused; delete in follow-up
P0-TRUST-05|P0|trust|/[lang]/freelance, /[lang]/freelance/[id], /[lang]/crafts/p/[id]|freelance, crafts|Customer copy said "هويّة موثّقة / ID verified — we checked their ID" but no ID document exists in any join form or admin screen; the flag is a hand toggle|Copy written for a check that was never built|Relabelled "موثّق من فريق متجر / Reviewed by Matjar" with an explanation that names the hand review and says it is not a government identity check; gig-card + freelance page marks now come from resolveProfessionalTrust|ar.json, en.json (professional.trust.identity/identityWhy), src/components/gig-card.tsx, src/app/[lang]/(site)/freelance/[id]/page.tsx|fixed|"هويّة موثّقة من متجر" blue tick, no explanation|green UserCheck mark, aria "حساب راجعو فريق متجر يدويًا"|professional-trust-badges.tsx keeps its <details> model, only its copy changed
P0-TRUST-06|P1|trust|/[lang]/trust|all|Nowhere told a customer what a badge meant; "registered" was worded three different ways (featured.registered vs discovery.registered vs header)|No trust namespace; copy per surface|New `trust` namespace (ar+en) with label/aria/heading/body/limits per kind + paid; /trust gains anchored sections #registration #documents #identity #paid; every badge links there|src/i18n/dictionaries/*.json, src/app/[lang]/(site)/trust/page.tsx|fixed|/trust had no per-badge explanation|one section per kind, "شو راجعنا" + "شو ما بتعني"|copy describes only the admin flows that exist; no registry lookup, no issuer contact, no ID check claimed
P0-TRUST-07|P0|trust|/[lang]/hub/leaders|hub|Every leader card renders a "موثّق" BadgeCheck footer unconditionally — a label prop, no data field|Hard-coded footer in the card markup|Render only from a real admin-set column, or drop the word "موثّق" (e.g. "من اختيار متجر" if leaders are curated)|src/components/hub/leaders-directory.tsx:275|open|"موثّق" on all leaders|—|outside WS2 territory; needs the hub owner to say what backs a leader
P0-TRUST-08|P2|trust|admin|all|feature-availability.ts cites "admin/stores is_verified toggle" as the evidence for verifiedBadge; the real pipeline is store_verifications|Stale evidence string|Change the evidence string to "store_verifications admin queue; zero rows verified in production"|src/lib/feature-availability.ts:561|open|—|—|file owned by another agent; text-only change
P0-TRUST-09|P2|trust|admin/stores|all|The generic is_verified "verify/unverify" admin action still exists and sets a column no customer surface reads|Toggle predates the verification queue|Either remove the action or rename it in admin copy to make clear it is internal|src/components/admin-stores-client.tsx:321|open|—|—|not removed here to keep the admin change minimal; harmless now that nothing renders it

## Gates

`npx tsc --noEmit` — 3 errors, all in `src/components/product-mini-card.tsx` (lines 69, 72, 124: `cardBadge`, `durationShort`, `priceOnConsult` missing from the dictionary type). That file is another agent's in-flight work; none of my files error. Before my dictionary edits the same file already failed the same way.

`npx vitest run src/lib/__tests__/trust.test.ts`
```
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Duration  276ms
```

`npx vitest run` (whole suite)
```
 Test Files  2 failed | 46 passed (48)
      Tests  3 failed | 754 passed (757)
```
Failures, none in my territory:
- `data-contracts.test.ts › bounds every select` — `search.ts:39 → products` unbounded (`src/lib/data/search.ts` is modified by another agent).
- `data-quality.test.ts` ×2 — `src/lib/data-quality.ts` and its test are untracked files from another agent.

`npx eslint` on all 13 touched files — exit 0, no warnings (including `matjar/no-raw-directional-icon` and `matjar/no-raw-palette`).

Dictionaries: `JSON.parse` OK for ar and en; CR count = LF count = 5018 in both (CRLF preserved).

Not visually verified: the port-3000 server is a production build of the pre-change tree, and I was told not to run `next build`; the change is server-rendered with no client state, and today's data (0 verified rows, 0 registered, 0 Pro shown for verified) means the only visible delta before launch is the new /trust section.
