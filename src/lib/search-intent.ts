// ===========================================================================
// Search intent — what an Arabic / Lebanese / English / Arabizi query MEANS
// ===========================================================================
//
// Why this exists. On 2026-09-24, 10 of the last 12 searches on production
// returned nothing. The top zero-result words were «مطاعم» (three times), «ملابس»,
// «سوق الاحد», «قطة», «فول», «للرجال» and a brand. Every one of those except the
// brand had an answer on the platform: a restaurant, a clothing shop, the
// Sunday Market itself. The store search was an ILIKE of the whole typed string
// on name / description / area, so a CATEGORY word, a plural, a dialect word or
// a section's own name could never match — nobody names their shop «مطاعم».
//
// This module is the pure half of the fix: no IO, no Supabase, no React. It
// reads a query and says what it understood — a sector, a Sunday-Market / crafts
// / freelance / jobs section, a crafts trade, a medical specialty, a place — and
// what words are left over to search as text. src/lib/data/search.ts and
// searchStores() turn that into queries; the search page turns it into a line
// ("فهمنا إنك عم تدوّر على: …") and links into the filtered views.
//
// Rules this file keeps, and the tests enforce:
//   * normalizeArabic() is byte-for-byte the database's normalize_search(), so
//     what search_logs.q_norm records and what this code matches agree.
//   * Every sector is a real CategoryKey, every trade slug is one of the 47 rows
//     of public.trades, every area is one of the 45 rows of public.lb_areas. The
//     tests re-read the seed migration and fail on anything invented.
//   * Nothing is guessed from a brand name. «etumax» means nothing to this file,
//     and it says so (confidence 0) rather than pretending.
// ===========================================================================

import {
  categoryGroup,
  type CategoryKey,
  type GroupKey,
  type RegionKey,
} from "@/lib/catalog";

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * The database's `public.normalize_search(text)` (migration 0216), mirrored
 * exactly so the client and search_logs.q_norm fold a query the same way:
 *
 *   1. lower(btrim(q))           — btrim strips SPACES only, not tabs/newlines
 *   2. remove tashkeel U+064B–U+0652 and tatweel U+0640
 *   3. translate أ إ آ ٱ → ا  and  ى → ي
 *   4. collapse runs of whitespace ([[:space:]]+) to one space
 *   5. '' → null (returned here as '')
 *
 * NOTE — ة is NOT folded. The SQL reads `translate(…, 'أإآٱىة', 'ااااية')`: the
 * last character maps ة to ة. Verified against production on 2026-09-24
 * (`normalize_search('مَدْرَسَةٌ')` → `مدرسة`). Matching folds ة→ه separately in
 * foldArabic() below, so the parity here is kept deliberately.
 */
export function normalizeArabic(q: string | null | undefined): string {
  const s = (q ?? "").replace(/^ +| +$/g, "").toLowerCase();
  return s
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ \t\n\r\v\f]+/g, " ");
}

/** Characters that separate words but are not letters: Latin and Arabic
 *  punctuation, quotes, brackets, slashes. They become spaces. */
const PUNCT = /[.,،؛;:!?؟"'`«»“”‘’()[\]{}\-_/\\|+*&^%$#@~<>=]/g;

/**
 * The folding used for MATCHING (never for logging): normalizeArabic, then
 * ة→ه, Arabic-Indic digits → Western, punctuation → space, trimmed.
 *
 * ة→ه is what makes «منقوشة» and «منقوشه» the same word, which Lebanese typing
 * does not reliably distinguish.
 */
export function foldArabic(q: string | null | undefined): string {
  return normalizeArabic(q)
    .replace(/ة/g, "ه")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ARABIC = /[\u0600-\u06FF]/;

// ---------------------------------------------------------------------------
// Stemming — light and conservative
// ---------------------------------------------------------------------------
//
// Not a morphological analyser. It strips the handful of affixes that decide
// whether a search matches at all, and only while at least three letters stay:
//
//   prefixes  وال بال فال كال لل ال  (article + clitic), then a bare و
//   suffixes  ات (→ also +ه), ين, ون, يه (ية), ه (ة)
//
// Every result is a VARIANT, never a replacement: the word as typed is always
// first, so «ورد» still means flowers even though «و» is a conjunction.

const PREFIXES = ["وال", "بال", "فال", "كال", "لل", "ال"];
const SUFFIXES = ["ات", "ين", "ون", "يه", "ه"];
const MIN_STEM = 3;

/** The word with a leading article / clitic removed, or the word itself. */
export function stripArticle(word: string): string {
  for (const p of PREFIXES) {
    if (word.startsWith(p) && word.length - p.length >= 2) {
      return word.slice(p.length);
    }
  }
  return word;
}

function stripSuffixes(word: string): string[] {
  const out: string[] = [];
  for (const s of SUFFIXES) {
    if (word.endsWith(s) && word.length - s.length >= MIN_STEM) {
      const stem = word.slice(0, -s.length);
      out.push(stem);
      // عيادات → عياد → عياده: the singular a shop actually writes.
      if (s === "ات") out.push(`${stem}ه`);
      break;
    }
  }
  return out;
}

/**
 * Variants of ONE folded word, the word itself first. Arabic words get the
 * affix treatment above; Latin words lose a plural -s (cars → car).
 */
export function stemVariants(word: string): string[] {
  const w = word.trim();
  if (!w) return [];
  const out = [w];
  if (ARABIC.test(w)) {
    let bare = w;
    for (const p of PREFIXES) {
      if (w.startsWith(p) && w.length - p.length >= MIN_STEM) {
        bare = w.slice(p.length);
        break;
      }
    }
    if (bare === w && w.startsWith("و") && w.length - 1 >= MIN_STEM) {
      bare = w.slice(1);
    }
    if (bare !== w) out.push(bare);
    out.push(...stripSuffixes(w));
    if (bare !== w) out.push(...stripSuffixes(bare));
  } else if (/^[a-z]+$/.test(w) && w.length > 3 && w.endsWith("s")) {
    out.push(w.slice(0, -1));
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------
// Reference data — copied from the seed, verified against production
// ---------------------------------------------------------------------------

export type SectionKey = "market" | "crafts" | "freelance" | "jobs";

/**
 * The 47 crafts trades. Source: supabase/migrations/0236_seed_lebanese_trades_
 * and_areas.sql, and an anon read of public.trades on 2026-09-24 returned the
 * same 47 slugs. Copied rather than fetched because the parser is pure and the
 * search page is not worth a round trip for a list this small; the test
 * `search-intent.test.ts` re-parses the migration and fails if they drift.
 */
export const TRADES: { slug: string; ar: string; en: string }[] = [
  { slug: "electrician", ar: "كهربائي", en: "Electrician" },
  { slug: "plumber", ar: "سبّاك", en: "Plumber" },
  { slug: "carpenter", ar: "نجّار", en: "Carpenter" },
  { slug: "painter", ar: "دهّان", en: "Painter" },
  { slug: "tiler", ar: "مبلّط", en: "Tiler" },
  { slug: "plasterer", ar: "جبصين وديكور", en: "Plaster & decor" },
  { slug: "blacksmith", ar: "حدّاد", en: "Blacksmith" },
  { slug: "aluminium", ar: "ألومينيوم", en: "Aluminium" },
  { slug: "glazier", ar: "زجاج", en: "Glass" },
  { slug: "doors-windows", ar: "أبواب وشبابيك", en: "Doors & windows" },
  { slug: "waterproofing", ar: "عزل ورطوبة", en: "Waterproofing" },
  { slug: "ac-install", ar: "تركيب مكيفات", en: "AC installation" },
  { slug: "ac-service", ar: "صيانة مكيفات", en: "AC service" },
  { slug: "fridge-repair", ar: "تصليح برادات", en: "Fridge repair" },
  { slug: "cold-rooms", ar: "غرف تبريد", en: "Cold rooms" },
  { slug: "washer-repair", ar: "غسالات ونشافات", en: "Washers & dryers" },
  { slug: "dishwasher-repair", ar: "جلايات", en: "Dishwashers" },
  { slug: "oven-repair", ar: "أفران وغاز", en: "Ovens & gas" },
  { slug: "heater-repair", ar: "سخانات وشوفاج", en: "Heaters" },
  { slug: "appliance-general", ar: "أجهزة منزلية", en: "Home appliances" },
  { slug: "generator", ar: "مولّدات", en: "Generators" },
  { slug: "solar", ar: "طاقة شمسية", en: "Solar" },
  { slug: "inverter", ar: "إنفرتر وبطاريات", en: "Inverter & batteries" },
  { slug: "water-pump", ar: "مضخات مياه", en: "Water pumps" },
  { slug: "water-tank", ar: "خزانات مياه", en: "Water tanks" },
  { slug: "satellite-net", ar: "ستلايت وإنترنت", en: "Satellite & internet" },
  { slug: "mechanic", ar: "ميكانيكي", en: "Mechanic" },
  { slug: "auto-electric", ar: "كهربا سيارات", en: "Auto electrics" },
  { slug: "tyres", ar: "دواليب وبناشر", en: "Tyres" },
  { slug: "car-battery", ar: "بطاريات سيارات", en: "Car batteries" },
  { slug: "car-glass", ar: "زجاج سيارات", en: "Car glass" },
  { slug: "car-wash", ar: "غسيل وتلميع", en: "Wash & polish" },
  { slug: "towing", ar: "سحب سيارات", en: "Towing" },
  { slug: "home-cleaning", ar: "تنظيف بيوت", en: "Home cleaning" },
  { slug: "office-cleaning", ar: "تنظيف مكاتب", en: "Office cleaning" },
  { slug: "post-construction", ar: "تنظيف بعد البناء", en: "After-build cleaning" },
  { slug: "sofa-carpet", ar: "تنظيف سجاد وكنب", en: "Carpet & sofa" },
  { slug: "pest-control", ar: "مكافحة حشرات", en: "Pest control" },
  { slug: "furniture-moving", ar: "نقل أثاث", en: "Furniture moving" },
  { slug: "goods-transport", ar: "نقل بضائع", en: "Goods transport" },
  { slug: "furniture-assembly", ar: "فك وتركيب أثاث", en: "Assembly" },
  { slug: "landscaping", ar: "تنسيق حدائق", en: "Landscaping" },
  { slug: "tree-cutting", ar: "قص وتقليم أشجار", en: "Tree cutting" },
  { slug: "irrigation", ar: "ري وشبكات", en: "Irrigation" },
  { slug: "construction", ar: "أعمال بناء", en: "Construction" },
  { slug: "renovation", ar: "ترميم وتشطيب", en: "Renovation" },
  { slug: "contracting", ar: "مقاولات", en: "Contracting" },
];

export const TRADE_SLUGS: ReadonlySet<string> = new Set(TRADES.map((t) => t.slug));

export type LbArea = {
  slug: string;
  region: RegionKey;
  ar: string;
  en: string;
  /** Extra spellings people type, beyond name_ar / name_en. Real variants
   *  only — several are spelt this way in production `stores.area` values
   *  («ابو سمرا», «ابي سمراء»). */
  aliases?: string[];
  /** A word that is also an everyday noun. Resolved as a place only in
   *  Latin script (see «صور» = "pictures"). */
  ambiguousAr?: boolean;
  /** Resolve the Arabic name only as written WITH its article: without it the
   *  word is ordinary speech («شوف» = look, «حمرا» = red, «كورة» = ball,
   *  «مزرعة» = farm, which is also a sector). */
  exactOnly?: boolean;
};

/**
 * The 45 areas of public.lb_areas. Source: migration 0236; an anon read on
 * 2026-09-24 returned the same 45 rows. Small, static, and needed by a pure
 * parser — hence in code, with the test re-reading the migration.
 */
export const LB_AREAS: LbArea[] = [
  { slug: "beirut-city", region: "beirut", ar: "بيروت", en: "Beirut", aliases: ["bayrut", "beyrouth"] },
  { slug: "achrafieh", region: "beirut", ar: "الأشرفية", en: "Achrafieh", aliases: ["ashrafieh", "ashrafiyeh", "achrafiye"] },
  { slug: "hamra", region: "beirut", ar: "الحمرا", en: "Hamra", aliases: ["الحمراء"], exactOnly: true },
  { slug: "mazraa", region: "beirut", ar: "المزرعة", en: "Mazraa", exactOnly: true },
  { slug: "ras-beirut", region: "beirut", ar: "رأس بيروت", en: "Ras Beirut" },
  { slug: "badaro", region: "beirut", ar: "بدارو", en: "Badaro" },
  { slug: "tripoli", region: "north", ar: "طرابلس", en: "Tripoli", aliases: ["طرابلوس", "trablos", "trablous", "tarablos", "طرابلس الشام"] },
  { slug: "mina", region: "north", ar: "الميناء", en: "El Mina", aliases: ["mina", "الميناء طرابلس"] },
  { slug: "abi-samra", region: "north", ar: "أبي سمراء", en: "Abi Samra", aliases: ["ابو سمرا", "ابو سمراء", "ابي سمرا", "abu samra"] },
  { slug: "qalamoun", region: "north", ar: "القلمون", en: "Qalamoun" },
  { slug: "zgharta", region: "north", ar: "زغرتا", en: "Zgharta" },
  { slug: "koura", region: "north", ar: "الكورة", en: "Koura", exactOnly: true },
  { slug: "batroun", region: "north", ar: "البترون", en: "Batroun" },
  { slug: "bcharre", region: "north", ar: "بشري", en: "Bcharre" },
  { slug: "akkar", region: "north", ar: "عكار", en: "Akkar" },
  { slug: "halba", region: "north", ar: "حلبا", en: "Halba" },
  { slug: "minieh", region: "north", ar: "المنية", en: "Minieh" },
  { slug: "dinnieh", region: "north", ar: "الضنية", en: "Dinnieh", aliases: ["الضنيه", "dennieh"] },
  { slug: "jounieh", region: "mountLebanon", ar: "جونية", en: "Jounieh", aliases: ["jounie"] },
  { slug: "zouk", region: "mountLebanon", ar: "ذوق مصبح", en: "Zouk Mosbeh", aliases: ["zouk"] },
  { slug: "jbeil", region: "mountLebanon", ar: "جبيل", en: "Jbeil", aliases: ["byblos"] },
  { slug: "baabda", region: "mountLebanon", ar: "بعبدا", en: "Baabda" },
  { slug: "aley", region: "mountLebanon", ar: "عاليه", en: "Aley" },
  { slug: "chouf", region: "mountLebanon", ar: "الشوف", en: "Chouf", exactOnly: true },
  { slug: "metn", region: "mountLebanon", ar: "المتن", en: "Metn" },
  { slug: "brummana", region: "mountLebanon", ar: "برمانا", en: "Brummana" },
  { slug: "dbayeh", region: "mountLebanon", ar: "ضبية", en: "Dbayeh" },
  { slug: "antelias", region: "mountLebanon", ar: "أنطلياس", en: "Antelias" },
  { slug: "hazmieh", region: "mountLebanon", ar: "الحازمية", en: "Hazmieh" },
  { slug: "bikfaya", region: "mountLebanon", ar: "بكفيا", en: "Bikfaya" },
  { slug: "khalde", region: "mountLebanon", ar: "خلدة", en: "Khalde" },
  { slug: "saida", region: "south", ar: "صيدا", en: "Saida", aliases: ["sidon"] },
  // «صور» is also the everyday plural of «صورة». Resolving it as Tyre would
  // filter «صور عرس» to the South; only the Latin spellings resolve.
  { slug: "tyre", region: "south", ar: "صور", en: "Tyre", aliases: ["sour"], ambiguousAr: true },
  { slug: "nabatieh", region: "south", ar: "النبطية", en: "Nabatieh" },
  { slug: "jezzine", region: "south", ar: "جزين", en: "Jezzine" },
  { slug: "bint-jbeil", region: "south", ar: "بنت جبيل", en: "Bint Jbeil" },
  { slug: "marjeyoun", region: "south", ar: "مرجعيون", en: "Marjeyoun" },
  { slug: "zahrani", region: "south", ar: "الزهراني", en: "Zahrani" },
  { slug: "zahle", region: "bekaa", ar: "زحلة", en: "Zahle", aliases: ["zahleh"] },
  { slug: "baalbek", region: "bekaa", ar: "بعلبك", en: "Baalbek" },
  { slug: "chtaura", region: "bekaa", ar: "شتورا", en: "Chtaura", aliases: ["شتورة", "chtoura"] },
  { slug: "rayak", region: "bekaa", ar: "رياق", en: "Rayak" },
  { slug: "hermel", region: "bekaa", ar: "الهرمل", en: "Hermel" },
  { slug: "rachaya", region: "bekaa", ar: "راشيا", en: "Rachaya" },
  { slug: "west-bekaa", region: "bekaa", ar: "البقاع الغربي", en: "West Bekaa" },
];

export const AREA_BY_SLUG: ReadonlyMap<string, LbArea> = new Map(
  LB_AREAS.map((a) => [a.slug, a]),
);

/** Region words — the five keys of `regions` in catalog.ts. */
const REGION_TERMS: { region: RegionKey; terms: string[] }[] = [
  { region: "beirut", terms: ["بيروت الكبرى"] },
  // Not «الجبل» alone: «جبل محسن» is a Tripoli neighbourhood.
  { region: "mountLebanon", terms: ["جبل لبنان", "mount lebanon"] },
  { region: "north", terms: ["الشمال", "شمال", "north", "north lebanon"] },
  { region: "south", terms: ["الجنوب", "جنوب", "south", "south lebanon"] },
  { region: "bekaa", terms: ["البقاع", "بقاع", "bekaa", "beqaa", "bekaa valley"] },
];

// ---------------------------------------------------------------------------
// Specialties — what a clinic's doctors and description actually say
// ---------------------------------------------------------------------------

export const SPECIALTY_KEYS = [
  "ophthalmology",
  "dentistry",
  "dermatology",
  "gynecology",
  "pediatrics",
  "cardiology",
  "orthopedics",
  "ent",
  "urology",
  "psychology",
  "pulmonology",
  "radiology",
  "laboratory",
] as const;
export type SpecialtyKey = (typeof SPECIALTY_KEYS)[number];

/** Words searched in doctors.specialty, stores.specialties and descriptions
 *  when a specialty is understood. Taken from how production writes them
 *  («أخصائي طب و جراحة عيون», «عيادة عيون فحص نظر», «الأمراض الجلدية»). */
export const SPECIALTY_TERMS: Record<SpecialtyKey, string[]> = {
  ophthalmology: ["عيون", "نظر", "ophthalm", "eye"],
  dentistry: ["اسنان", "سنان", "dent"],
  dermatology: ["جلد", "derma", "skin"],
  gynecology: ["نسائي", "توليد", "gyn"],
  pediatrics: ["اطفال", "pediatr"],
  cardiology: ["قلب", "cardio"],
  orthopedics: ["عظم", "ortho"],
  ent: ["انف", "اذن", "حنجر"],
  urology: ["مسالك", "بولي", "urolog"],
  psychology: ["نفسي", "سلوكي", "psych"],
  pulmonology: ["تنفسي", "رئ", "صدر", "pulmon"],
  radiology: ["اشعه", "ايكو", "radio", "x-ray"],
  laboratory: ["مختبر", "تحاليل", "lab"],
};

// ---------------------------------------------------------------------------
// The lexicon
// ---------------------------------------------------------------------------

export type IntentMeaning = {
  sector?: CategoryKey;
  group?: GroupKey;
  section?: SectionKey;
  trade?: string;
  specialty?: SpecialtyKey;
  deal?: "rent" | "sale";
};

export type Concept = {
  id: string;
  /** Words and phrases (any script) that mean this. Matched after foldArabic,
   *  so hamza / tashkeel / ة-ه spellings need not be listed twice. */
  triggers: string[];
  meaning: IntentMeaning;
  /** Words a shop of this kind actually writes about itself, searched as text
   *  when the concept fires («مطاعم» → a description saying «المشاوي»). */
  related?: string[];
  /** The triggers are one thing spelt in two scripts («iphone» / «ايفون»), so
   *  a listing title in either script is the same answer. Only tight synonym
   *  sets carry this; «برغر» must not go looking for «pizza». */
  pairable?: boolean;
  /** A slice of its sector, not the sector: «ملابس» is some retailers, «مطاعم»
   *  is every food business. See the precision rule in rankStores(). */
  subtopic?: boolean;
};

const FOOD_RELATED = ["مطعم", "مأكولات", "مشاوي", "وجبات", "اكل", "restaurant", "food"];
const ELECTRONICS_RELATED = ["الكترونيات", "كمبيوتر", "computer", "electronic", "موبايل", "هواتف"];
const CLINIC_RELATED = ["عياده", "طبي", "دكتور", "طبيب", "clinic", "medical"];

const trade = (
  id: string,
  slug: string,
  triggers: string[],
  sector: CategoryKey = "contractors",
): Concept => ({
  id,
  triggers,
  meaning: { section: "crafts", trade: slug, sector, group: categoryGroup[sector] },
  subtopic: true,
});

/**
 * Every entry names a real CategoryKey / trade slug / section. Order matters
 * only for ties: the first concept to claim a sector wins the headline.
 */
export const LEXICON: Concept[] = [
  // ── food ──────────────────────────────────────────────────────────────────
  {
    id: "food",
    triggers: [
      "مطعم", "مطاعم", "اكل", "اكلات", "مأكولات", "ماكولات", "وجبات", "وجبة",
      "برغر", "برجر", "بيرغر", "همبرغر", "burger", "burgers",
      "بيتزا", "pizza", "شاورما", "شورما", "shawarma", "فلافل", "falafel",
      "فول", "فول مدمس", "منقوشة", "مناقيش", "منقوشه", "manouche", "manakish",
      "سندويش", "سندويشة", "سندويشات", "ساندويش", "sandwich", "sandwiches",
      "مشاوي", "مشاوى", "grill", "سوشي", "sushi", "حلويات", "كنافة", "كنافه",
      "كافيه", "كافيهات", "مقهى", "قهوة", "cafe", "coffee", "restaurant", "restaurants",
      "food", "delivery food", "دليفري اكل", "ترويقة", "فطور",
    ],
    meaning: { sector: "food" },
    related: FOOD_RELATED,
  },
  // ── healthcare + specialties ─────────────────────────────────────────────
  {
    id: "clinic",
    triggers: [
      "دكتور", "دكتورة", "دكاترة", "طبيب", "طبيبة", "اطباء", "حكيم", "حكيمة",
      "عيادة", "عيادات", "مستوصف", "مستوصفات", "مستشفى", "مستشفيات",
      "مركز طبي", "مراكز طبية", "طبي", "doctor", "doctors", "dr", "clinic",
      "clinics", "hospital", "medical center", "medical",
    ],
    meaning: { sector: "healthcare" },
    related: CLINIC_RELATED,
  },
  { id: "ophthalmology", triggers: ["عيون", "دكتور عيون", "طبيب عيون", "عيادة عيون", "ophthalmologist", "eye doctor", "optometrist", "لايزك", "lasik"], meaning: { sector: "healthcare", specialty: "ophthalmology" } },
  { id: "dentistry", triggers: ["اسنان", "سنان", "دكتور اسنان", "طبيب اسنان", "dentist", "dental"], meaning: { sector: "healthcare", specialty: "dentistry" } },
  // Not «جلدية» alone: «ملابس جلدية» is leather clothing.
  { id: "dermatology", triggers: ["امراض جلدية", "دكتور جلد", "طبيب جلد", "دكتور جلدية", "dermatologist", "dermatology"], meaning: { sector: "healthcare", specialty: "dermatology" } },
  { id: "gynecology", triggers: ["نسائية وتوليد", "نسائي وتوليد", "توليد", "دكتور نسائي", "دكتورة نسائية", "gynecologist", "obgyn"], meaning: { sector: "healthcare", specialty: "gynecology" } },
  { id: "pediatrics", triggers: ["طب اطفال", "دكتور اطفال", "طبيب اطفال", "pediatrician"], meaning: { sector: "healthcare", specialty: "pediatrics" } },
  { id: "cardiology", triggers: ["دكتور قلب", "طبيب قلب", "cardiologist"], meaning: { sector: "healthcare", specialty: "cardiology" } },
  { id: "orthopedics", triggers: ["دكتور عظم", "دكتور عظام", "طبيب عظام", "orthopedic"], meaning: { sector: "healthcare", specialty: "orthopedics" } },
  { id: "ent", triggers: ["انف اذن حنجرة", "انف واذن وحنجرة", "ent"], meaning: { sector: "healthcare", specialty: "ent" } },
  { id: "urology", triggers: ["مسالك بولية", "مسالك", "urologist"], meaning: { sector: "healthcare", specialty: "urology" } },
  { id: "psychology", triggers: ["طبيب نفسي", "معالج نفسي", "دكتور نفسي", "psychologist", "therapist"], meaning: { sector: "healthcare", specialty: "psychology" } },
  { id: "radiology", triggers: ["اشعة", "صورة اشعة", "ايكو", "x-ray", "xray"], meaning: { sector: "healthcare", specialty: "radiology" } },
  { id: "laboratory", triggers: ["مختبر", "تحاليل", "فحص دم", "lab test"], meaning: { sector: "healthcare", specialty: "laboratory" } },
  // ── pharmacy ─────────────────────────────────────────────────────────────
  {
    id: "pharmacy",
    triggers: ["صيدلية", "صيدليات", "صيدلي", "فارمسي", "pharmacy", "دوا", "دواء", "ادوية"],
    meaning: { sector: "pharmacy" },
    related: ["صيدليه", "pharmacy"],
  },
  // ── retail ───────────────────────────────────────────────────────────────
  {
    id: "clothing",
    subtopic: true,
    triggers: [
      "ملابس", "تياب", "ثياب", "البسة", "لبس", "اواعي", "فساتين", "فستان",
      "احذية", "حذاء", "صبابيط", "سكربينة", "كنادر", "جزادين", "شنط",
      "clothes", "clothing", "fashion", "shoes", "dress", "dresses",
    ],
    meaning: { sector: "retail" },
    related: ["ملابس", "البسه", "احذيه", "ازياء", "بوتيك", "fashion"],
  },
  {
    id: "iphone",
    subtopic: true,
    triggers: ["iphone", "iphones", "ايفون", "ايفونات"],
    meaning: { sector: "retail" },
    related: ELECTRONICS_RELATED,
    pairable: true,
  },
  {
    id: "samsung",
    subtopic: true,
    triggers: ["samsung", "سامسونج", "سامسونغ"],
    meaning: { sector: "retail" },
    related: ELECTRONICS_RELATED,
    pairable: true,
  },
  {
    id: "electronics",
    subtopic: true,
    triggers: [
      "موبايل", "موبايلات", "تلفون", "تلفونات", "هاتف", "هواتف",
      "لابتوب", "لابتوبات", "laptop", "كمبيوتر", "كومبيوتر", "computer",
      "الكترونيات", "electronics", "phone", "phones", "mobile",
    ],
    meaning: { sector: "retail" },
    related: ELECTRONICS_RELATED,
  },
  {
    id: "furniture",
    subtopic: true,
    triggers: ["مفروشات", "اثاث", "موبيليا", "كنب", "furniture", "sofa"],
    meaning: { sector: "retail" },
    related: ["مفروشات", "اثاث", "furniture"],
  },
  {
    id: "supermarket",
    subtopic: true,
    triggers: ["سوبرماركت", "سوبر ماركت", "ميني ماركت", "supermarket", "grocery", "دكانة", "بقالة"],
    meaning: { sector: "retail" },
    related: ["سوبر ماركت", "سوبرماركت", "supermarket"],
  },
  // ── beauty ───────────────────────────────────────────────────────────────
  {
    id: "beauty",
    triggers: [
      "صالون", "صالونات", "حلاق", "حلاقة", "كوافير", "كوافيرة", "تجميل",
      "مكياج", "ميكاب", "makeup", "اظافر", "مانيكير", "باديكير", "nails",
      "salon", "barber", "beauty", "عطر", "عطور", "perfume", "perfumes",
    ],
    meaning: { sector: "beauty" },
    related: ["صالون", "تجميل", "عطور", "عطر", "beauty", "salon"],
  },
  // ── pet care ─────────────────────────────────────────────────────────────
  {
    id: "petCare",
    triggers: [
      "قطة", "قطط", "بسة", "بسينة", "كلب", "كلاب", "بيطري", "طبيب بيطري",
      "دكتور بيطري", "حيوانات", "حيوانات اليفة", "pet", "pets", "vet", "cat",
      "cats", "dog", "dogs",
    ],
    meaning: { sector: "petCare" },
    related: ["بيطري", "حيوانات", "pet", "vet"],
  },
  // ── real estate (+ the deal modifiers, which are not a sector on their own:
  //    «سيارة للايجار» is a car, «ايفون للبيع» is a phone) ────────────────────
  {
    id: "realEstate",
    triggers: [
      "شقة", "شقق", "عقار", "عقارات", "ارض", "اراضي", "فيلا", "فلل", "بيت للبيع",
      "بيت للايجار", "بيوت للبيع", "apartment", "apartments", "real estate",
      "property", "villa",
    ],
    meaning: { sector: "realEstate" },
    related: ["عقارات", "شقق", "real estate"],
  },
  { id: "rent", triggers: ["ايجار", "للايجار", "اجار", "للاجار", "rent", "for rent"], meaning: { deal: "rent" } },
  { id: "sale", triggers: ["للبيع", "for sale"], meaning: { deal: "sale" } },
  // ── automotive ───────────────────────────────────────────────────────────
  {
    id: "automotive",
    triggers: [
      "سيارة", "سيارات", "اوتو", "اوتوموبيل", "كاراج", "كراج", "قطع سيارات",
      "قطع غيار", "car", "cars", "auto", "garage",
    ],
    meaning: { sector: "automotive" },
    related: ["سيارات", "كراج", "auto"],
  },
  // ── other store sectors ──────────────────────────────────────────────────
  { id: "education", triggers: ["دورة", "دورات", "كورس", "كورسات", "دروس خصوصية", "معهد", "تعليم", "course", "courses", "tutor"], meaning: { sector: "education" } },
  { id: "fitness", triggers: ["جيم", "نادي رياضي", "لياقة", "gym", "fitness"], meaning: { sector: "fitness" } },
  { id: "sportsCourts", triggers: ["ملعب", "ملاعب", "بادل", "padel", "ملعب فوتبول", "football pitch"], meaning: { sector: "sportsCourts" } },
  { id: "events", triggers: ["قاعة", "قاعات", "صالة افراح", "افراح", "عرس", "اعراس", "wedding", "events"], meaning: { sector: "events" } },
  { id: "hospitality", triggers: ["فندق", "فنادق", "شاليه", "شاليهات", "hotel", "chalet"], meaning: { sector: "hospitality" } },
  { id: "professional", triggers: ["محامي", "محامية", "محاماة", "محاسب", "lawyer", "accountant"], meaning: { sector: "professional" } },
  { id: "farm", triggers: ["مزرعة", "مزارع", "farm"], meaning: { sector: "farm" } },
  {
    id: "services",
    triggers: ["تاكسي", "taxi", "سفر", "سياحة", "travel", "حج", "عمرة", "تسويق", "marketing"],
    meaning: { sector: "services" },
  },
  { id: "sports", triggers: ["رياضة", "sports"], meaning: { group: "sports" } },
  // ── sections ─────────────────────────────────────────────────────────────
  {
    id: "market",
    triggers: [
      "سوق الاحد", "سوق احد", "السوق الاحد", "سوق الأحد", "مستعمل", "مستعملة",
      "مستعملين", "مستعملات", "second hand", "secondhand", "used", "sunday market",
      "souk el ahad",
    ],
    meaning: { section: "market" },
  },
  {
    id: "crafts",
    triggers: [
      "حرفي", "حرفيين", "حرفيون", "صنايعي", "صنايعية", "تصليح", "تصليحات",
      "مصلح", "صيانة", "handyman", "repair", "technician",
    ],
    meaning: { section: "crafts" },
  },
  {
    id: "freelance",
    triggers: ["فريلانس", "فريلانسر", "مستقل", "مستقلين", "عمل حر", "freelance", "freelancer", "freelancers"],
    meaning: { section: "freelance" },
  },
  {
    id: "jobs",
    triggers: ["وظيفة", "وظائف", "وظايف", "توظيف", "فرصة عمل", "فرص عمل", "مطلوب موظف", "job", "jobs", "hiring", "vacancy"],
    meaning: { section: "jobs" },
  },
  // ── crafts trades (slugs from public.trades) ─────────────────────────────
  trade("electrician", "electrician", ["كهربجي", "كهربائي", "كهربجية", "كهربا", "كهرباء", "فيوز", "electrician"]),
  trade("plumber", "plumber", ["سنكري", "سباك", "مواسرجي", "تسريب مي", "plumber"]),
  trade("carpenter", "carpenter", ["نجار", "نجارة", "carpenter"]),
  trade("painter", "painter", ["دهان", "دهين", "بويا", "painter"]),
  trade("tiler", "tiler", ["مبلط", "بلاط", "تبليط", "سيراميك", "tiler"]),
  trade("plasterer", "plasterer", ["جبصين", "جبس", "ديكور جبس"]),
  trade("blacksmith", "blacksmith", ["حداد", "حدادة", "blacksmith"]),
  trade("aluminium", "aluminium", ["المنيوم", "ألمنيوم", "aluminium", "aluminum"]),
  trade("glazier", "glazier", ["زجاج", "زجاجي", "قزاز", "سيكوريت"]),
  trade("doors-windows", "doors-windows", ["اقفال", "مفاتيحي", "locksmith"]),
  trade("waterproofing", "waterproofing", ["عزل", "رطوبة", "نش", "عزل سطح", "waterproofing"]),
  trade("ac-install", "ac-install", ["تركيب مكيف", "تركيب مكيفات", "تركيب اسبليت", "ac installation"]),
  trade("ac-service", "ac-service", [
    "مكيف", "مكيفات", "مكيف ما عم يبرد", "المكيف ما عم يبرد", "ما عم يبرد",
    "صيانة مكيف", "صيانة مكيفات", "تكييف", "تكيف", "اسبليت", "air conditioner",
    "ac repair", "ac service", "aircon",
  ]),
  trade("fridge-repair", "fridge-repair", ["براد", "برادات", "تلاجة", "ثلاجة", "فريزر", "البراد ما عم يبرد", "fridge", "refrigerator"]),
  trade("cold-rooms", "cold-rooms", ["غرفة تبريد", "غرف تبريد", "cold room"]),
  trade("washer-repair", "washer-repair", ["غسالة", "غسالات", "نشافة", "washing machine"]),
  trade("dishwasher-repair", "dishwasher-repair", ["جلاية", "جلايات", "dishwasher"]),
  trade("oven-repair", "oven-repair", ["تصليح فرن", "بوتاجاز", "غاز طبخ"]),
  trade("heater-repair", "heater-repair", ["سخان", "سخانات", "شوفاج", "heater"]),
  trade("appliance-general", "appliance-general", ["اجهزة منزلية", "كهربائيات"]),
  trade("generator", "generator", ["مولد", "مولدات", "مولدة", "اشتراك موتور", "generator"]),
  trade("solar", "solar", ["طاقة شمسية", "سولار", "الواح شمسية", "solar"]),
  trade("inverter", "inverter", ["انفرتر", "انفيرتر", "inverter", "ups"]),
  trade("water-pump", "water-pump", ["طرمبة", "طرنبة", "مضخة", "مضخات", "water pump"]),
  trade("water-tank", "water-tank", ["خزان مي", "خزانات مي", "تنك مي", "water tank"]),
  trade("satellite-net", "satellite-net", ["ستلايت", "دش", "صحن ستلايت", "satellite"]),
  trade("mechanic", "mechanic", ["ميكانيكي", "ميكانيك", "mechanic"], "automotive"),
  trade("auto-electric", "auto-electric", ["كهربا سيارات", "كهربجي سيارات"], "automotive"),
  trade("tyres", "tyres", ["بنشر", "بنشري", "كوشوك", "دواليب", "دولاب", "tyres", "tires"], "automotive"),
  trade("car-battery", "car-battery", ["بطارية سيارة", "بطاريات سيارات", "car battery"], "automotive"),
  trade("car-glass", "car-glass", ["زجاج سيارات", "جام سيارة", "car glass"], "automotive"),
  trade("car-wash", "car-wash", ["غسيل سيارات", "غسيل سيارة", "تلميع سيارات", "car wash"], "automotive"),
  trade("towing", "towing", ["ونش", "سحب سيارات", "towing", "tow truck"], "automotive"),
  trade("home-cleaning", "home-cleaning", ["تنظيف بيوت", "تنظيف بيت", "تنظيف منازل", "home cleaning"]),
  trade("office-cleaning", "office-cleaning", ["تنظيف مكاتب", "تنظيف مكتب", "office cleaning"]),
  trade("post-construction", "post-construction", ["تنظيف بعد البناء", "تنظيف ورشة"]),
  trade("sofa-carpet", "sofa-carpet", ["تنظيف سجاد", "تنظيف كنب", "شامبو سجاد", "carpet cleaning"]),
  trade("pest-control", "pest-control", ["رش حشرات", "مكافحة حشرات", "صراصير", "فئران", "pest control"]),
  trade("furniture-moving", "furniture-moving", ["نقل عفش", "عفش", "نقليات", "نقل اثاث", "movers"]),
  trade("goods-transport", "goods-transport", ["نقل بضائع", "شحن بضاعة", "كاميون"]),
  trade("furniture-assembly", "furniture-assembly", ["فك وتركيب", "تركيب اثاث", "furniture assembly"]),
  trade("landscaping", "landscaping", ["تنسيق حدائق", "جنينة", "حديقة", "landscaping", "gardener"]),
  trade("tree-cutting", "tree-cutting", ["قص شجر", "تقليم شجر", "tree cutting"]),
  trade("irrigation", "irrigation", ["شبكة ري", "رشاشات", "irrigation"]),
  trade("construction", "construction", ["باطون", "بناء", "construction"]),
  trade("renovation", "renovation", ["ترميم", "تشطيب", "renovation"]),
  trade("contracting", "contracting", ["مقاول", "مقاولات", "contractor"]),
];

/** Words that carry no search meaning in Lebanese / Arabic / English queries.
 *  Removed from the residual, never from the text as logged. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  [
    "ما", "عم", "في", "فيه", "فيها", "بدي", "بدنا", "بدك", "عندي", "شي", "حدا",
    "قريب", "قريبه", "مني", "من", "على", "علي", "عند", "او", "و", "مع", "ع",
    "عل", "يا", "هون", "هيك", "كتير", "اللي", "يلي", "الي", "انا", "لي",
    "افضل", "احسن", "ارخص", "منيح", "منيحه", "بس", "كمان", "لل", "ل", "ب",
    "near", "me", "in", "the", "a", "an", "for", "best", "cheap", "of", "and",
    "to", "at", "with", "my",
  ].map((w) => foldArabic(w)),
);

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

type Hit =
  | { kind: "concept"; concept: Concept }
  | { kind: "area"; area: LbArea }
  | { kind: "region"; region: RegionKey };

type Index = { map: Map<string, Hit[]>; maxWords: number };

function indexKeys(term: string, exactOnly = false): string[] {
  const folded = foldArabic(term);
  if (!folded) return [];
  const bare = folded.split(" ").map(stripArticle).join(" ");
  return bare === folded || exactOnly ? [folded] : [folded, bare];
}

let INDEX: Index | null = null;

function buildIndex(): Index {
  const map = new Map<string, Hit[]>();
  let maxWords = 1;
  const add = (term: string, hit: Hit, exactOnly = false) => {
    for (const key of indexKeys(term, exactOnly)) {
      const list = map.get(key) ?? [];
      list.push(hit);
      map.set(key, list);
      maxWords = Math.max(maxWords, key.split(" ").length);
    }
  };
  for (const concept of LEXICON) {
    for (const t of concept.triggers) add(t, { kind: "concept", concept });
  }
  for (const area of LB_AREAS) {
    if (!area.ambiguousAr) add(area.ar, { kind: "area", area }, area.exactOnly);
    add(area.en, { kind: "area", area });
    for (const a of area.aliases ?? []) add(a, { kind: "area", area }, area.exactOnly);
  }
  for (const r of REGION_TERMS) {
    for (const t of r.terms) add(t, { kind: "region", region: r.region });
  }
  return { map, maxWords };
}

function index(): Index {
  if (!INDEX) INDEX = buildIndex();
  return INDEX;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type SearchIntent = {
  raw: string;
  /** normalizeArabic(raw) — the same string search_logs.q_norm stores. */
  normalized: string;
  /** Folded words of the query, stopwords removed. */
  terms: string[];
  /** The words left after the understood ones (intent, place, stopwords)
   *  were taken out, space-joined, folded. */
  residual: string;
  sector?: CategoryKey;
  group?: GroupKey;
  section?: SectionKey;
  trade?: string;
  specialty?: SpecialtyKey;
  deal?: "rent" | "sale";
  region?: RegionKey;
  /** An lb_areas slug. */
  area?: string;
  /** Every sector a matched concept named, headline first. */
  sectors: CategoryKey[];
  /** Ids of the matched concepts, in query order. */
  concepts: string[];
  /** The folded words that triggered a STORE concept (one naming a sector),
   *  as typed. Section, deal and place words are understood but not searched
   *  as store text: «سوق الاحد» must not match a supermarket «للتسوق». */
  intentWords: string[];
  /** 0 when nothing was understood; 0.9 for an exact word / phrase; 0.8 for
   *  a match after removing the article; 0.7 for a match after stemming. */
  confidence: number;
};

type Match = { start: number; len: number; hits: Hit[]; score: number };

function lookup(words: string[], i: number, idx: Index): Match | null {
  for (let n = Math.min(idx.maxWords, words.length - i); n >= 1; n--) {
    const slice = words.slice(i, i + n);
    const exact = idx.map.get(slice.join(" "));
    if (exact) return { start: i, len: n, hits: exact, score: 0.9 };
    const bare = idx.map.get(slice.map(stripArticle).join(" "));
    if (bare) return { start: i, len: n, hits: bare, score: 0.8 };
  }
  // One word, stemmed. The word as typed has already failed above, so only
  // the variants after it are tried.
  for (const v of stemVariants(words[i]).slice(1)) {
    const hit = idx.map.get(v) ?? idx.map.get(stripArticle(v));
    if (hit) return { start: i, len: 1, hits: hit, score: 0.7 };
  }
  return null;
}

export function parseSearchIntent(q: string | null | undefined): SearchIntent {
  const raw = (q ?? "").trim().slice(0, 100);
  const normalized = normalizeArabic(raw);
  const words = foldArabic(raw).split(" ").filter(Boolean);
  const idx = index();

  const consumed = new Array<boolean>(words.length).fill(false);
  const concepts: Concept[] = [];
  const intentWords: string[] = [];
  let region: RegionKey | undefined;
  let area: LbArea | undefined;
  let confidence = 0;

  for (let i = 0; i < words.length; ) {
    // Phrases first: «ما عم يبرد» opens with two stopwords and still means
    // "the AC is not cooling". A stopword that starts no phrase matches
    // nothing below and simply falls through.
    const m = lookup(words, i, idx);
    if (!m) {
      i++;
      continue;
    }
    let used = false;
    for (const h of m.hits) {
      if (h.kind === "concept") {
        if (!concepts.includes(h.concept)) concepts.push(h.concept);
        used = true;
      } else if (h.kind === "area" && !area) {
        area = h.area;
        region = region ?? h.area.region;
        used = true;
      } else if (h.kind === "region" && !region) {
        region = h.region;
        used = true;
      }
    }
    if (used) {
      for (let k = m.start; k < m.start + m.len; k++) consumed[k] = true;
      if (m.hits.some((h) => h.kind === "concept" && h.concept.meaning.sector)) {
        intentWords.push(words.slice(m.start, m.start + m.len).join(" "));
      }
      confidence = Math.max(confidence, m.score);
    }
    i += m.len;
  }

  const terms = words.filter((w) => !STOPWORDS.has(w));
  const residual = words
    .filter((w, k) => !consumed[k] && !STOPWORDS.has(w))
    .join(" ");

  // Headline meaning. A trade beats a specialty beats a plain sector, because
  // the more specific word is the one the buyer chose on purpose.
  const withTrade = concepts.find((c) => c.meaning.trade);
  const withSpecialty = concepts.find((c) => c.meaning.specialty);
  const withSector = concepts.find((c) => c.meaning.sector);
  const withSection =
    withTrade ?? concepts.find((c) => c.meaning.section && !c.meaning.trade);
  const headline = withTrade ?? withSpecialty ?? withSector;
  const sector = headline?.meaning.sector;
  const sectors: CategoryKey[] = [];
  if (sector) sectors.push(sector);
  for (const c of concepts) {
    const s = c.meaning.sector;
    if (s && !sectors.includes(s)) sectors.push(s);
  }
  const group =
    concepts.find((c) => c.meaning.group && !c.meaning.sector)?.meaning.group ??
    (sector ? categoryGroup[sector] : undefined);

  const out: SearchIntent = {
    raw,
    normalized,
    terms,
    residual,
    sectors,
    concepts: concepts.map((c) => c.id),
    intentWords,
    confidence,
  };
  if (sector) out.sector = sector;
  if (group) out.group = group;
  if (withSection?.meaning.section) out.section = withSection.meaning.section;
  if (withTrade?.meaning.trade) out.trade = withTrade.meaning.trade;
  if (withSpecialty?.meaning.specialty) out.specialty = withSpecialty.meaning.specialty;
  const deal = concepts.find((c) => c.meaning.deal)?.meaning.deal;
  if (deal) out.deal = deal;
  if (region) out.region = region;
  if (area) out.area = area.slug;
  return out;
}

/** Whether the intent says anything worth drawing on the page. */
export function hasIntent(i: SearchIntent): boolean {
  return Boolean(
    i.sector || i.group || i.section || i.trade || i.specialty || i.region,
  );
}

// ---------------------------------------------------------------------------
// Turning an intent into a store search
// ---------------------------------------------------------------------------

export type StoreSearchPlan = {
  /** The query as typed — always searched, so a store NAMED «Qabass Computers»
   *  is still found by its whole name. */
  raw: string;
  /** Folded residual words and their stems. Rank first. */
  residualTerms: string[];
  /** Folded intent words, their stems, and the concepts' related words. */
  intentTerms: string[];
  specialtyTerms: string[];
  /** Sectors whose stores are returned even when no word matches. */
  sectors: CategoryKey[];
  /** Every sector concept matched was a SUBTOPIC (clothing, electronics, a
   *  trade): members of the sector that match no word are not answers when
   *  some member does. */
  narrow: boolean;
  region?: RegionKey;
  /** Folded spellings of the understood area, matched against stores.area. */
  areaTerms: string[];
  /** A place and nothing else was typed: every store of that region is an
   *  answer, with the ones whose area names the place first. */
  pullRegion: boolean;
  /** ILIKE patterns for the PostgREST or= filter, most important first. */
  patterns: string[];
};

/** Hard ceiling on patterns: each becomes four or= clauses in a GET URL. */
export const MAX_PATTERNS = 12;

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Spellings of an area, folded, for matching the free-text stores.area. */
export function areaTerms(slug: string | undefined): string[] {
  const a = slug ? AREA_BY_SLUG.get(slug) : undefined;
  if (!a) return [];
  return uniq(
    [a.ar, a.en, ...(a.aliases ?? [])].map((t) => stripArticle(foldArabic(t))),
  );
}

/**
 * A value that is safe inside a PostgREST or= list, turned into an ILIKE body
 * that tolerates the spellings the database does not normalise:
 *
 *   * the user's own % and _ are escaped (a search for "50%" is literal);
 *   * `, ( ) . : *` are PostgREST syntax and become spaces (the same rule as
 *     escapeForOr in data/discovery.ts);
 *   * each alef-family letter becomes `_` (one-character wildcard) so «اشرفية»
 *     finds «الأشرفية», and a final ه becomes `_` so «منقوشه» finds «منقوشة».
 *     Neither applies to words under four letters, where one wildcard is a
 *     quarter of the word and «اكل» would find «شكل».
 */
export function ilikeBody(term: string): string {
  const safe = term
    .replace(/[%_\\]/g, (m) => `\\${m}`)
    .replace(/[(),.:*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!safe) return "";
  if (!ARABIC.test(safe) || safe.replace(/\s/g, "").length < 4) return safe;
  return safe.replace(/[اأإآٱ]/g, "_").replace(/[هة](?=\s|$)/g, "_");
}

export function planStoreSearch(intent: SearchIntent): StoreSearchPlan {
  const byId = new Map(LEXICON.map((c) => [c.id, c]));
  const residualTerms = uniq(
    intent.residual
      .split(" ")
      .flatMap((w) => stemVariants(w))
      .filter((w) => w.length >= 2),
  );
  const matched = intent.concepts.map((id) => byId.get(id)!).filter(Boolean);
  const intentTerms = uniq([
    ...intent.intentWords
      .flatMap((w) => w.split(" "))
      .filter((w) => !STOPWORDS.has(w))
      .flatMap((w) => stemVariants(w)),
    ...matched.flatMap((c) => (c.related ?? []).map((r) => foldArabic(r))),
  ]).filter((w) => w.length >= 2);
  const specialtyTerms = intent.specialty
    ? SPECIALTY_TERMS[intent.specialty].map((t) => foldArabic(t))
    : [];
  const areas = areaTerms(intent.area);
  const pullRegion = Boolean(
    intent.region && !intent.sectors.length && !intent.residual && !intent.section,
  );
  const sectorConcepts = matched.filter((c) => c.meaning.sector);
  const narrow =
    sectorConcepts.length > 0 && sectorConcepts.every((c) => c.subtopic);

  const rawBody = ilikeBody(intent.raw);
  const patterns = uniq(
    [
      rawBody,
      ...residualTerms.map(ilikeBody),
      ...specialtyTerms.map(ilikeBody),
      ...intentTerms.map(ilikeBody),
      ...(pullRegion ? areas.map(ilikeBody) : []),
    ].filter((p) => p.replace(/[\\_\s]/g, "").length >= 2),
  ).slice(0, MAX_PATTERNS);

  return {
    raw: intent.raw,
    residualTerms,
    intentTerms,
    specialtyTerms,
    sectors: intent.sectors,
    narrow,
    region: intent.region,
    areaTerms: areas,
    pullRegion,
    patterns,
  };
}

/** The or= filter over the four text columns of a store. */
export function storeTextOrClause(plan: StoreSearchPlan): string {
  return plan.patterns
    .flatMap((p) => [
      `name.ilike.%${p}%`,
      `description.ilike.%${p}%`,
      `area.ilike.%${p}%`,
      `specialties.ilike.%${p}%`,
    ])
    .join(",");
}

/** The or= filter over doctors.specialty for the understood specialty. */
export function doctorSpecialtyOrClause(plan: StoreSearchPlan): string {
  return plan.specialtyTerms
    .map(ilikeBody)
    .filter(Boolean)
    .map((p) => `specialty.ilike.%${p}%`)
    .join(",");
}

// ---------------------------------------------------------------------------
// Ranking — pure, over the rows the queries returned
// ---------------------------------------------------------------------------

export type RankableStore = {
  id: string;
  name: string;
  description?: string | null;
  area?: string | null;
  specialties?: string | null;
  region?: string | null;
  sector: CategoryKey;
  rating?: number;
  reviews?: number;
};

export type StoreRank = {
  keep: boolean;
  residual: number;
  intent: number;
  specialty: boolean;
  sector: boolean;
  area: boolean;
  region: boolean;
};

function fieldScore(
  terms: string[],
  f: { name: string; text: string; area: string },
  weights: [number, number, number],
): number {
  let total = 0;
  for (const t of terms) {
    if (f.name.includes(t)) total += weights[0];
    else if (f.text.includes(t)) total += weights[1];
    else if (f.area.includes(t)) total += weights[2];
  }
  return total;
}

export function rankStore(
  s: RankableStore,
  plan: StoreSearchPlan,
  doctorStoreIds: ReadonlySet<string> = new Set(),
): StoreRank {
  const f = {
    name: foldArabic(s.name),
    text: `${foldArabic(s.description)} ${foldArabic(s.specialties)}`,
    area: foldArabic(s.area),
  };
  const rawFolded = foldArabic(plan.raw);
  const rawHit =
    rawFolded.length >= 2 &&
    (f.name.includes(rawFolded) || f.text.includes(rawFolded) || f.area.includes(rawFolded));
  const residual =
    fieldScore(plan.residualTerms, f, [3, 2, 1]) + (rawHit ? 3 : 0);
  const sector = plan.sectors.includes(s.sector);
  // The intent words and their related vocabulary rank stores INSIDE the
  // understood sector only. Outside it they are too loose to be an answer:
  // «صيانة سيارة» must not return a taxi firm because its blurb says «السيارات».
  // A store outside the sector still comes back on the residual / raw words.
  const intent = sector ? fieldScore(plan.intentTerms, f, [2, 1, 0]) : 0;
  const specialty =
    doctorStoreIds.has(s.id) ||
    plan.specialtyTerms.some((t) => f.text.includes(t) || f.name.includes(t));
  const area = plan.areaTerms.some((t) => f.area.includes(t));
  const region = Boolean(plan.region && s.region === plan.region);
  // A store that states a DIFFERENT region is out; one that states none is
  // kept, because an empty column is not evidence it is elsewhere.
  const conflict = Boolean(plan.region && s.region && s.region !== plan.region);
  const keep =
    !conflict &&
    (residual > 0 ||
      intent > 0 ||
      specialty ||
      sector ||
      (plan.pullRegion && (region || area)));
  return { keep, residual, intent, specialty, sector, area, region };
}

/**
 * Rank and filter. Order: residual text match, then intent/specialty match,
 * then the understood place, then sector membership, then rating.
 *
 * Precision rule for SUBTOPIC pulls (plan.narrow): when some store of the
 * sector also matches the words, sector members that match nothing are
 * dropped — «ملابس» should show the clothing shop, not every retailer. When
 * none matches, the sector is the answer. A sector-wide word («مطاعم») keeps
 * every member: a restaurant that never writes «مطعم» is still a restaurant.
 */
export function rankStores<T extends RankableStore>(
  rows: T[],
  plan: StoreSearchPlan,
  doctorStoreIds: ReadonlySet<string> = new Set(),
): T[] {
  const scored = rows
    .map((row) => ({ row, r: rankStore(row, plan, doctorStoreIds) }))
    .filter((x) => x.r.keep);
  // A specialty is a precise ask. «اسنان» on a platform with no dentist is an
  // empty answer, not an eye clinic: only a store whose own text or doctors
  // name the specialty (or that matches the leftover words) survives.
  const pool = plan.specialtyTerms.length
    ? scored.filter((x) => x.r.specialty || x.r.residual > 0)
    : scored;
  const textual = (r: StoreRank) => r.residual > 0 || r.intent > 0 || r.specialty;
  const sectorHasText =
    plan.narrow && pool.some((x) => x.r.sector && textual(x.r));
  const kept = sectorHasText
    ? pool.filter(
        (x) =>
          textual(x.r) ||
          !x.r.sector ||
          (plan.pullRegion && (x.r.region || x.r.area)),
      )
    : pool;
  const key = (x: (typeof kept)[number]): number[] => [
    x.r.residual,
    x.r.intent + (x.r.specialty ? 3 : 0),
    x.r.area ? 1 : 0,
    x.r.region ? 1 : 0,
    x.r.sector ? 1 : 0,
    x.row.rating ?? 0,
    x.row.reviews ?? 0,
  ];
  kept.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i];
    return 0;
  });
  return kept.map((x) => x.row);
}

// ---------------------------------------------------------------------------
// Other search inputs derived from the intent
// ---------------------------------------------------------------------------

/**
 * The terms the product RPC is called with, at most three: the query as typed,
 * the residual if it differs, and — for a one-word query — its stem
 * («المطاعم» → «مطاعم»). The RPC is trigram-backed and a round trip each, so
 * this stays small.
 */
export function productSearchTerms(intent: SearchIntent): string[] {
  const out = [intent.raw];
  if (intent.residual && intent.residual !== foldArabic(intent.raw)) {
    out.push(intent.residual);
  }
  const words = foldArabic(intent.raw).split(" ").filter(Boolean);
  if (words.length === 1) {
    const stem = stemVariants(words[0])[1];
    if (stem) out.push(stem);
  }
  return uniq(out.map((t) => t.trim()).filter((t) => t.length >= 2)).slice(0, 3);
}

/**
 * Sunday-Market title searches: the query as typed, plus the same concept in
 * the other script when one word was typed in one script and the lexicon lists
 * the other («iphone» also looks for «ايفون», which is how the one active
 * phone listing is titled). `null` means "no text filter" — the section itself
 * was asked for («سوق الاحد») and its latest listings are the answer.
 */
export function listingSearchTerms(intent: SearchIntent): (string | null)[] {
  if (intent.section === "market" && !intent.residual) return [null];
  const out: string[] = [intent.raw];
  const words = foldArabic(intent.raw).split(" ").filter(Boolean);
  if (words.length === 1 && intent.concepts.length) {
    const typedArabic = ARABIC.test(words[0]);
    const concept = LEXICON.find((c) => c.id === intent.concepts[0]);
    const other = !concept?.pairable
      ? undefined
      : concept.triggers.find(
      (t) => ARABIC.test(t) !== typedArabic && !t.includes(" "),
    );
    if (other) out.push(other);
  }
  return uniq(out).slice(0, 2);
}

// ---------------------------------------------------------------------------
// Where the understood intent leads
// ---------------------------------------------------------------------------

export type IntentLink =
  | { kind: "stores"; href: string; sector?: CategoryKey; group?: GroupKey; region?: RegionKey; area?: string }
  | { kind: "section"; href: string; section: SectionKey; trade?: string; area?: string };

/**
 * The filtered views an intent points at, as locale-prefixed hrefs:
 *   stores   → /{lang}/explore?sector=…|group=…[&region=…]  (parseDiscoveryQuery)
 *   crafts   → /{lang}/crafts/<trade>[?area=<lb_areas slug>] or /{lang}/crafts
 *   market / freelance / jobs → their own section root
 * `sectorHasStores` lets the caller drop a store link that would open onto an
 * empty sector — a link is a promise that something is behind it.
 */
export function intentLinks(
  intent: SearchIntent,
  lang: string,
  sectorHasStores: (s: CategoryKey) => boolean = () => true,
): IntentLink[] {
  const out: IntentLink[] = [];
  const region = intent.region;
  if (intent.sector && !intent.trade) {
    if (sectorHasStores(intent.sector)) {
      const p = new URLSearchParams({ sector: intent.sector });
      if (region) p.set("region", region);
      out.push({
        kind: "stores",
        href: `/${lang}/explore?${p.toString()}`,
        sector: intent.sector,
        region,
        area: intent.area,
      });
    }
  } else if (intent.group && !intent.sector) {
    const p = new URLSearchParams({ group: intent.group });
    if (region) p.set("region", region);
    out.push({ kind: "stores", href: `/${lang}/explore?${p.toString()}`, group: intent.group, region });
  } else if (region && !intent.section) {
    out.push({
      kind: "stores",
      href: `/${lang}/explore?${new URLSearchParams({ region }).toString()}`,
      region,
      area: intent.area,
    });
  }
  if (intent.section) {
    if (intent.section === "crafts") {
      const base = intent.trade && TRADE_SLUGS.has(intent.trade)
        ? `/${lang}/crafts/${intent.trade}`
        : `/${lang}/crafts`;
      const href =
        intent.trade && intent.area ? `${base}?area=${encodeURIComponent(intent.area)}` : base;
      out.push({ kind: "section", href, section: "crafts", trade: intent.trade, area: intent.area });
    } else {
      out.push({ kind: "section", href: `/${lang}/${intent.section}`, section: intent.section });
    }
  }
  return out;
}
