# 13 — Public data quality gate

Generated 2026-09-24T13:26:55.515Z by `scripts/data-quality-report.mjs` — **read only**, anon key, public rows.
Nothing was updated or deleted. Every flagged record below is for the owner to review by hand.

## Rules

Validators: `src/lib/data-quality.ts`. Level = worst severity: any **block** → `blocked`; any **flag** → `incomplete`; none → `ok`.
`blocked` = not ranked in explore / search / home rails (still reachable by URL). `incomplete` = listed, flagged to merchant and admin.

| Rule | Applies to | Severity | Code |
| --- | --- | --- | --- |
| Name present after trim | all | block | name_missing |
| Name is not a placeholder (test/tst/demo/asd/qwe/xxx/lorem/تجربة/اختبار…) | all | block | name_placeholder |
| Name is not only digits | all | block | name_digits_only |
| Name has no leading/trailing whitespace | all | flag | name_untrimmed |
| Name has no leading/trailing punctuation (- _ . , ; : quotes, brackets) | all | flag | name_edge_punctuation |
| Name is not garbled (mojibake, U+FFFD, 5+ vowel-less Latin letters, 4× repeated letter) | all | flag | name_garbled |
| Business type present | stores | flag | category_missing |
| Location: `area` for shops; `area` or `service_area` for services/contractors/professional; skipped when the location module is off | stores | flag | location_missing |
| At least one dialable contact (≥7 digits) in phone/whatsapp | stores, crafts | block | contact_missing |
| A contact beside a usable one is too short | stores, crafts | flag | contact_invalid |
| Job has a way to apply (how_to_apply or apply_email) | jobs | block | contact_missing |
| Description present | stores, crafts, gigs, jobs, listings | flag | description_missing |
| Description is not a placeholder / under 3 letters | same | flag | description_placeholder |
| Logo or cover present (monogram fallback exists) | stores | flag | image_missing |
| Image present | products, gigs, listings | flag | image_missing |
| At least one offering where the sector sells from a list (commerce sectors + hospitality/events/automotive) | stores | flag | offerings_missing |
| Price is a finite non-negative number | products (null = block), gigs & listings (null = on request) | block | price_invalid |
| Price is not zero | products | flag | price_zero |
| Discount price lower than price | products | flag | discount_not_lower |
| item_kind fits the sector (no `service` in goods sectors, no `product` in booking sectors) | products | flag | kind_mismatch |
| Region or area present | crafts, jobs, listings | flag | location_missing |

## Counts per level

| Entity | Rows | ok | incomplete | blocked |
| --- | --- | --- | --- | --- |
| Stores (active) | 17 | 9 | 8 | 0 |
| Products (active, of any store) | 44 | 14 | 30 | 0 |
| Craft providers (active) | 0 | 0 | 0 | 0 |
| Gigs (active) | 3 | 3 | 0 | 0 |
| Job postings (active) | 2 | 2 | 0 | 0 |
| Market listings (active) | 3 | 1 | 2 | 0 |

Product image coverage: **17 / 44** products carry an image.

## Stores

| Name | Sector | Level | Issues |
| --- | --- | --- | --- |
| ألبسة نسائي ولادب | retail | incomplete | location_missing, image_missing, offerings_missing |
| شركة التوفيق للسياحة والسفر | services | ok | — |
| Qabass Computers - قبس كمبيوترز | retail | incomplete | offerings_missing |
| Aanab_perfumes | beauty | ok | — |
| مفروشات عبد الحفيظ عربس | professional | incomplete | image_missing |
| Alo sam taxi | services | incomplete | image_missing |
| ملحمة البركة | retail | ok | — |
| Passion Glow | services | ok | — |
| sleepy care | retail | ok | — |
| misk | retail | ok | — |
| خير و بركة | retail | ok | — |
| Mehras Chtoura | retail | incomplete | location_missing, offerings_missing |
| Let’s meat | food | incomplete | location_missing |
| Giggles Care Lebanon | retail | incomplete | location_missing |
| دكتور عمر الصمد | healthcare | ok | — |
| مركز الضنية الطبي  | healthcare | incomplete | name_untrimmed |
| Nazih Home | retail | ok | — |

## Products

| Name | Sector | Level | Store | Image | Issues |
| --- | --- | --- | --- | --- | --- |
| مسك الطهارة | beauty | incomplete | Aanab_perfumes | no | image_missing, kind_mismatch |
| مسك الطهارة | beauty | incomplete | Aanab_perfumes | no | image_missing, kind_mismatch |
| عطر  | beauty | incomplete | Aanab_perfumes | no | name_untrimmed, image_missing, kind_mismatch |
| صابون اكليل الجبل  | retail | incomplete | misk | no | name_untrimmed, image_missing |
| صابون سائل الياسمين  | retail | incomplete | misk | no | name_untrimmed, image_missing |
| صابون سائل عود  | retail | incomplete | misk | no | name_untrimmed, image_missing |
| صابون سائل كلاسيك  | retail | incomplete | misk | no | name_untrimmed, image_missing |
| صابون الشبة  | retail | incomplete | misk | no | name_untrimmed, image_missing |
| بابا غنوج | retail | incomplete | خير و بركة | no | image_missing |
| بابا غنوج  | retail | incomplete | خير و بركة | no | name_untrimmed, image_missing |
| ورق عنب ب زيت  | retail | incomplete | خير و بركة | no | name_untrimmed, image_missing |
| حمص مدقوق  | retail | incomplete | خير و بركة | no | name_untrimmed, image_missing |
| ادارة صفحات سوشيل ميديا | services | incomplete | Passion Glow | no | price_zero, image_missing, kind_mismatch |
| وايبس معطر  | retail | incomplete | sleepy care | no | name_untrimmed, image_missing |
| حفاضات لكبار السن كبير  L  | retail | incomplete | sleepy care | no | name_untrimmed, image_missing |
| صابون اكليل الجبل  | retail | incomplete | misk | no | name_untrimmed, image_missing |
| صابون الالوفيرا  | retail | incomplete | misk | no | name_untrimmed, image_missing |
| صابون العسل و اللوز  | retail | incomplete | misk | no | name_untrimmed, image_missing |
| صدر دجاج | retail | ok | ملحمة البركة | yes | — |
| شاورما دجاج | retail | ok | ملحمة البركة | yes | — |
| شاورما لحمة | retail | ok | ملحمة البركة | yes | — |
| سجق | retail | ok | ملحمة البركة | yes | — |
| مقانق | retail | ok | ملحمة البركة | yes | — |
| شرحات | retail | ok | ملحمة البركة | yes | — |
| شقف | retail | ok | ملحمة البركة | yes | — |
| كفتة | retail | ok | ملحمة البركة | yes | — |
| مفرومة | retail | ok | ملحمة البركة | yes | — |
| 3 كيلو فخاد | retail | incomplete | ملحمة البركة | no | image_missing |
| تصوير  | services | incomplete | Passion Glow | no | name_untrimmed, image_missing |
| حفاضات لكبار السن  xl | retail | incomplete | sleepy care | no | name_untrimmed, image_missing |
| صابون الكركم  | retail | incomplete | misk | yes | name_untrimmed |
| صابون زبدة الشيا  | retail | incomplete | misk | yes | name_untrimmed |
| صابون الجفتي  | retail | incomplete | misk | yes | name_untrimmed |
| تحاليل  | healthcare | incomplete | مركز الضنية الطبي  | no | name_untrimmed, image_missing |
| ايكو | healthcare | incomplete | مركز الضنية الطبي  | no | image_missing |
| أشعة | healthcare | incomplete | مركز الضنية الطبي  | no | image_missing |
| فحص للعملية | healthcare | incomplete | دكتور عمر الصمد | no | image_missing |
| مراجعة طبية | healthcare | incomplete | دكتور عمر الصمد | no | image_missing |
| كشفية فحص نظر | healthcare | incomplete | دكتور عمر الصمد | no | image_missing |
| رقاقات جبن | food | ok | Let’s meat | yes | — |
| بوبكورن دجاج | food | ok | Let’s meat | yes | — |
| ناغتس | food | ok | Let’s meat | yes | — |
| Giggles pure water wit wipes | retail | ok | Giggles Care Lebanon | yes | — |
| طقم كنب | retail | ok | Nazih Home | yes | — |

## Craft providers

_No public rows._

## Gigs

| Name | Sector | Level | Issues |
| --- | --- | --- | --- |
| تصميم بوستات احترافية | freelance | ok | — |
| تصوير احترافي | freelance | ok | — |
| ممثل او موديل | freelance | ok | — |

## Job postings

| Name | Sector | Level | Issues |
| --- | --- | --- | --- |
| مسؤول حسابات - سوشيل ميديا — passion | jobs | ok | — |
| مدير مكتب — الأمان للتامين | jobs | ok | — |

## Market listings

| Name | Sector | Level | Issues |
| --- | --- | --- | --- |
| ايفون 11 برو ماكس | market | ok | — |
| MARTADEL | market | incomplete | description_missing, location_missing, image_missing |
| 3 كيلو فخاد | market | incomplete | description_missing, location_missing, image_missing |

## Flagged for owner review

40 of 69 public records carry at least one issue. No record was changed. Issue frequency:

| Issue | Records |
| --- | --- |
| image_missing | 32 |
| name_untrimmed | 21 |
| location_missing | 6 |
| kind_mismatch | 4 |
| offerings_missing | 3 |
| description_missing | 2 |
| price_zero | 1 |

| Name | Kind | Level | Issues |
| --- | --- | --- | --- |
| ألبسة نسائي ولادب | retail | incomplete | location_missing, image_missing, offerings_missing |
| Qabass Computers - قبس كمبيوترز | retail | incomplete | offerings_missing |
| مفروشات عبد الحفيظ عربس | professional | incomplete | image_missing |
| Alo sam taxi | services | incomplete | image_missing |
| Mehras Chtoura | retail | incomplete | location_missing, offerings_missing |
| Let’s meat | food | incomplete | location_missing |
| Giggles Care Lebanon | retail | incomplete | location_missing |
| مركز الضنية الطبي  | healthcare | incomplete | name_untrimmed |
| مسك الطهارة | beauty | incomplete | image_missing, kind_mismatch |
| مسك الطهارة | beauty | incomplete | image_missing, kind_mismatch |
| عطر  | beauty | incomplete | name_untrimmed, image_missing, kind_mismatch |
| صابون اكليل الجبل  | retail | incomplete | name_untrimmed, image_missing |
| صابون سائل الياسمين  | retail | incomplete | name_untrimmed, image_missing |
| صابون سائل عود  | retail | incomplete | name_untrimmed, image_missing |
| صابون سائل كلاسيك  | retail | incomplete | name_untrimmed, image_missing |
| صابون الشبة  | retail | incomplete | name_untrimmed, image_missing |
| بابا غنوج | retail | incomplete | image_missing |
| بابا غنوج  | retail | incomplete | name_untrimmed, image_missing |
| ورق عنب ب زيت  | retail | incomplete | name_untrimmed, image_missing |
| حمص مدقوق  | retail | incomplete | name_untrimmed, image_missing |
| ادارة صفحات سوشيل ميديا | services | incomplete | price_zero, image_missing, kind_mismatch |
| وايبس معطر  | retail | incomplete | name_untrimmed, image_missing |
| حفاضات لكبار السن كبير  L  | retail | incomplete | name_untrimmed, image_missing |
| صابون اكليل الجبل  | retail | incomplete | name_untrimmed, image_missing |
| صابون الالوفيرا  | retail | incomplete | name_untrimmed, image_missing |
| صابون العسل و اللوز  | retail | incomplete | name_untrimmed, image_missing |
| 3 كيلو فخاد | retail | incomplete | image_missing |
| تصوير  | services | incomplete | name_untrimmed, image_missing |
| حفاضات لكبار السن  xl | retail | incomplete | name_untrimmed, image_missing |
| صابون الكركم  | retail | incomplete | name_untrimmed |
| صابون زبدة الشيا  | retail | incomplete | name_untrimmed |
| صابون الجفتي  | retail | incomplete | name_untrimmed |
| تحاليل  | healthcare | incomplete | name_untrimmed, image_missing |
| ايكو | healthcare | incomplete | image_missing |
| أشعة | healthcare | incomplete | image_missing |
| فحص للعملية | healthcare | incomplete | image_missing |
| مراجعة طبية | healthcare | incomplete | image_missing |
| كشفية فحص نظر | healthcare | incomplete | image_missing |
| MARTADEL | market | incomplete | description_missing, location_missing, image_missing |
| 3 كيلو فخاد | market | incomplete | description_missing, location_missing, image_missing |
