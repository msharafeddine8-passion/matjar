// Shared catalog metadata for the 6 business modules, plus demo stores and
// products used across the public pages until real data is wired from Supabase.

import type { StorePlan } from "@/lib/plan-tiers";

export const categoryKeys = [
  "food",
  "retail",
  "services",
  "healthcare",
  "realEstate",
  "automotive",
  "beauty",
  "fitness",
  "sportsCourts",
  "education",
  "events",
  "hospitality",
  "pharmacy",
  "petCare",
  "professional",
  "contractors",
  "farm",
] as const;

export type CategoryKey = (typeof categoryKeys)[number];

const CATEGORY_KEY_SET: ReadonlySet<string> = new Set<string>(categoryKeys);

/** Whether an arbitrary value is one of the sectors the code actually knows.
 *
 *  Every sector behaviour — transaction model, CTA, module bundle, profile
 *  order, team label — is keyed on this union, and the value that reaches it is
 *  a `business_types.slug`, a string an admin types. The call sites narrowed it
 *  with a bare `as CategoryKey`, which is an assertion the compiler cannot
 *  check: an unrecognised slug travelled on WITH the type of a known sector and
 *  every registry lookup downstream of it quietly returned undefined. */
export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && CATEGORY_KEY_SET.has(value);
}

/** The same narrowing with the fallback the call sites were already writing by
 *  hand, and the one thing they were not doing: saying so.
 *
 *  Unknown slugs land on `retail` — the generic bundle every existing fallback
 *  in this codebase already picks — so a drifted row renders a plain shop
 *  instead of throwing on a public page. The warning is what turns that from a
 *  silent default into a reported one; a default nobody ever hears about is
 *  indistinguishable from a decision, and stays wrong for as long as nobody
 *  happens to notice. `context` names the caller so the log line is actionable.
 */
export function toCategoryKey(slug: unknown, context?: string): CategoryKey {
  if (isCategoryKey(slug)) return slug;
  if (slug != null && slug !== "") {
    console.warn(
      `[matjar:sectors] business type slug ${JSON.stringify(slug)}` +
        `${context ? ` (${context})` : ""} is not a known sector — rendering it ` +
        `as "retail". Add it to categoryKeys in src/lib/catalog.ts, or rename ` +
        `the business_types row to a supported slug.`,
    );
  }
  return "retail";
}

export type Bilingual = { ar: string; en: string };

// ===== Sector colour identity =====
// One slot per sector on the seven-slot categorical ramp defined in
// globals.css (--tint-1 … --tint-7). Read the comment above those tokens for why
// there are seven slots and not seventeen — short version: the 17 hand-picked
// hues this replaced were only 13 distinct colours, four pairs were byte-
// identical, and this file and src/lib/sectors.ts disagreed about which hue a
// sector owned, so a sector changed colour between the directory and its own
// dashboard. The mapping lives HERE, next to categoryGroup, and sectors.ts
// imports it, so there is exactly one answer to "what colour is this sector".
//
// Slots follow the nine navigation groups below, with realEstate+automotive
// folded together (both are listings/leads sectors, neither transacts) and
// fitness+sportsCourts+education together (all three run on the same
// memberships/classes/courses modules).
export type TintSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const SECTOR_TINT: Record<CategoryKey, TintSlot> = {
  food: 2, // amber
  retail: 6, // blue
  services: 7, // violet
  healthcare: 4, // green
  realEstate: 3, // olive
  automotive: 3,
  beauty: 4,
  fitness: 5, // cyan
  sportsCourts: 5,
  education: 5,
  events: 1, // rose
  hospitality: 1,
  pharmacy: 4,
  petCare: 4,
  professional: 7,
  contractors: 7,
  farm: 6,
};

// Full Tailwind class strings (literal so the scanner keeps them). `cover` is
// the placeholder wash behind a missing store/product image; `iconWrap` is the
// sector icon badge — the same fill/ink pair sectors.ts uses for iconTint, so a
// sector's badge is identical wherever it appears.
export const categoryStyles: Record<
  CategoryKey,
  { cover: string; iconWrap: string }
> = {
  food: { cover: "from-tint-2-soft to-tint-2/15", iconWrap: "bg-tint-2-soft text-tint-2" },
  retail: { cover: "from-tint-6-soft to-tint-6/15", iconWrap: "bg-tint-6-soft text-tint-6" },
  services: { cover: "from-tint-7-soft to-tint-7/15", iconWrap: "bg-tint-7-soft text-tint-7" },
  healthcare: { cover: "from-tint-4-soft to-tint-4/15", iconWrap: "bg-tint-4-soft text-tint-4" },
  realEstate: { cover: "from-tint-3-soft to-tint-3/15", iconWrap: "bg-tint-3-soft text-tint-3" },
  automotive: { cover: "from-tint-3-soft to-tint-3/15", iconWrap: "bg-tint-3-soft text-tint-3" },
  beauty: { cover: "from-tint-4-soft to-tint-4/15", iconWrap: "bg-tint-4-soft text-tint-4" },
  fitness: { cover: "from-tint-5-soft to-tint-5/15", iconWrap: "bg-tint-5-soft text-tint-5" },
  sportsCourts: { cover: "from-tint-5-soft to-tint-5/15", iconWrap: "bg-tint-5-soft text-tint-5" },
  education: { cover: "from-tint-5-soft to-tint-5/15", iconWrap: "bg-tint-5-soft text-tint-5" },
  events: { cover: "from-tint-1-soft to-tint-1/15", iconWrap: "bg-tint-1-soft text-tint-1" },
  hospitality: { cover: "from-tint-1-soft to-tint-1/15", iconWrap: "bg-tint-1-soft text-tint-1" },
  pharmacy: { cover: "from-tint-4-soft to-tint-4/15", iconWrap: "bg-tint-4-soft text-tint-4" },
  petCare: { cover: "from-tint-4-soft to-tint-4/15", iconWrap: "bg-tint-4-soft text-tint-4" },
  professional: { cover: "from-tint-7-soft to-tint-7/15", iconWrap: "bg-tint-7-soft text-tint-7" },
  contractors: { cover: "from-tint-7-soft to-tint-7/15", iconWrap: "bg-tint-7-soft text-tint-7" },
  farm: { cover: "from-tint-6-soft to-tint-6/15", iconWrap: "bg-tint-6-soft text-tint-6" },
};

// ===== Top-level groups: what customers browse. A group bundles several
// business-type sectors (Shopping = retail + farm; Health & beauty = clinics +
// beauty + pet care + pharmacy). Sectors stay granular (each drives its own
// tailored experience via its module bundle); groups are the clean navigation
// layer above them so discovery shows ~9 tabs, not 17.
export const groupKeys = [
  "shopping",
  "food",
  "services",
  "health",
  "sports",
  "bookings",
  "realEstate",
  "automotive",
  "education",
] as const;

export type GroupKey = (typeof groupKeys)[number];

export const categoryGroup: Record<CategoryKey, GroupKey> = {
  food: "food",
  retail: "shopping",
  farm: "shopping",
  services: "services",
  contractors: "services",
  professional: "services",
  healthcare: "health",
  beauty: "health",
  petCare: "health",
  pharmacy: "health",
  fitness: "sports",
  sportsCourts: "sports",
  events: "bookings",
  hospitality: "bookings",
  realEstate: "realEstate",
  automotive: "automotive",
  education: "education",
};

/** The sectors that belong to a group, in categoryKeys order. */
export function groupCategories(group: GroupKey): CategoryKey[] {
  return categoryKeys.filter((c) => categoryGroup[c] === group);
}

export type RegionKey =
  | "beirut"
  | "mountLebanon"
  | "north"
  | "south"
  | "bekaa";

export const regions: { key: RegionKey; name: Bilingual }[] = [
  { key: "beirut", name: { ar: "بيروت", en: "Beirut" } },
  { key: "mountLebanon", name: { ar: "جبل لبنان", en: "Mount Lebanon" } },
  { key: "north", name: { ar: "الشمال", en: "North" } },
  { key: "south", name: { ar: "الجنوب", en: "South" } },
  { key: "bekaa", name: { ar: "البقاع", en: "Bekaa" } },
];

export type Store = {
  id: string;
  name: Bilingual;
  area: Bilingual;
  region?: RegionKey;
  category: CategoryKey;
  rating?: number;
  reviews?: number;
  isOpen: boolean;
  /** Subscription tier in force. Compare with hasPlan(), never `=== "pro"` —
   *  Business ranks ABOVE Pro and must not read as unsubscribed. */
  plan?: StorePlan;
  verified?: boolean;
  registered?: boolean;
  featured?: boolean;
  favorited?: boolean;
  /** No owner yet (0338): a directory listing, labelled unconfirmed. */
  unclaimed?: boolean;
  /** Display only (0338): no orders or bookings through Matjar. */
  showcase?: boolean;
  logoUrl?: string | null;
  coverUrl?: string | null;
  /** Vertical focal point of the banner, 0-100 (see stores.cover_position). */
  coverPosition?: number;
  lat?: number | null;
  lng?: number | null;
  // Active branch locations (multi-branch stores). "Near me" ranks by the
  // closest one and the map draws a pin per branch; absent on demo stores.
  locations?: {
    id: string;
    name: string | null;
    area: string | null;
    lat: number | null;
    lng: number | null;
  }[];
  distanceKm?: number;
  tag?: Bilingual;
  description?: Bilingual;
};

// Kept for back-compat with the StoreCard component prop type.
export type FeaturedStore = Store;

export const stores: Store[] = [
  {
    id: "1",
    name: { ar: "مطعم بيت الزيتون", en: "Beit El Zeitoun" },
    area: { ar: "الأشرفية، بيروت", en: "Achrafieh, Beirut" },
    region: "beirut",
    category: "food",
    rating: 4.8,
    reviews: 326,
    isOpen: true,
    tag: { ar: "توصيل مجاني", en: "Free delivery" },
    description: {
      ar: "مأكولات لبنانية أصيلة، محضّرة طازة يومياً من قلب الأشرفية.",
      en: "Authentic Lebanese cuisine, freshly prepared daily in the heart of Achrafieh.",
    },
  },
  {
    id: "2",
    name: { ar: "متجر نون للإلكترونيات", en: "Noon Electronics" },
    area: { ar: "جونية، كسروان", en: "Jounieh, Keserwan" },
    region: "mountLebanon",
    category: "retail",
    rating: 4.6,
    reviews: 184,
    isOpen: true,
    description: {
      ar: "أحدث الهواتف والإلكترونيات بأسعار منافسة وضمان رسمي.",
      en: "The latest phones and electronics at competitive prices with official warranty.",
    },
  },
  {
    id: "3",
    name: { ar: "عيادة د. سارة حداد", en: "Dr. Sara Haddad Clinic" },
    area: { ar: "صيدا، الجنوب", en: "Saida, South" },
    region: "south",
    category: "healthcare",
    rating: 4.9,
    reviews: 97,
    isOpen: false,
    description: {
      ar: "عيادة جلدية وتجميل، حجز مواعيد أونلاين بكل سهولة.",
      en: "Dermatology and aesthetics clinic with easy online appointment booking.",
    },
  },
  {
    id: "4",
    name: { ar: "كراج الأمين للصيانة", en: "Al Amin Auto Care" },
    area: { ar: "طرابلس، الشمال", en: "Tripoli, North" },
    region: "north",
    category: "automotive",
    rating: 4.7,
    reviews: 142,
    isOpen: true,
    tag: { ar: "حجز موعد", en: "Book a slot" },
    description: {
      ar: "صيانة شاملة لكل أنواع السيارات على يد فنّيين خبراء.",
      en: "Complete maintenance for all car types by expert technicians.",
    },
  },
  {
    id: "5",
    name: { ar: "حلويات الصفا", en: "Al Safa Sweets" },
    area: { ar: "زحلة، البقاع", en: "Zahle, Bekaa" },
    region: "bekaa",
    category: "food",
    rating: 4.9,
    reviews: 411,
    isOpen: true,
    tag: { ar: "الأكثر مبيعاً", en: "Bestseller" },
  },
  {
    id: "6",
    name: { ar: "بوتيك لمى للأزياء", en: "Lama Fashion Boutique" },
    area: { ar: "الحمرا، بيروت", en: "Hamra, Beirut" },
    region: "beirut",
    category: "retail",
    rating: 4.5,
    reviews: 128,
    isOpen: true,
  },
  {
    id: "7",
    name: { ar: "مكتب الإعمار العقاري", en: "Al Imar Real Estate" },
    area: { ar: "بعبدا، جبل لبنان", en: "Baabda, Mount Lebanon" },
    region: "mountLebanon",
    category: "realEstate",
    rating: 4.4,
    reviews: 73,
    isOpen: true,
    tag: { ar: "شقق وأراضٍ", en: "Apartments & land" },
  },
  {
    id: "8",
    name: { ar: "شركة النظافة المثالية", en: "Perfect Cleaning Co." },
    area: { ar: "جبيل، جبل لبنان", en: "Byblos, Mount Lebanon" },
    region: "mountLebanon",
    category: "services",
    rating: 4.7,
    reviews: 156,
    isOpen: false,
    tag: { ar: "حجز خدمة", en: "Book service" },
  },
];

export const featuredStores: Store[] = stores.slice(0, 4);

// Show the demo/sample stores alongside real ones while the platform fills up.
// Off for launch: only real, approved stores are shown. Flip to true locally if
// you want the sample catalog back while developing.
export const SHOW_DEMO_STORES = false;

export function getStoreById(id: string): Store | undefined {
  return stores.find((store) => store.id === id);
}

export type Product = { name: Bilingual; price: number };

// Demo products/services shown on a store page, by business module.
export const sampleProducts: Record<CategoryKey, Product[]> = {
  food: [
    { name: { ar: "وجبة مشاوي مشكّلة", en: "Mixed grill plate" }, price: 14 },
    { name: { ar: "تبّولة طازة", en: "Fresh tabbouleh" }, price: 6 },
    { name: { ar: "حمّص باللحمة", en: "Hummus with meat" }, price: 8 },
    { name: { ar: "عصير ليمون بالنعنع", en: "Mint lemonade" }, price: 4 },
  ],
  retail: [
    { name: { ar: "سمّاعات لاسلكية", en: "Wireless earbuds" }, price: 45 },
    { name: { ar: "شاحن سريع 65W", en: "65W fast charger" }, price: 22 },
    { name: { ar: "غطاء حماية للهاتف", en: "Protective phone case" }, price: 12 },
    { name: { ar: "ساعة ذكية", en: "Smart watch" }, price: 89 },
  ],
  services: [
    { name: { ar: "تنظيف منزل كامل", en: "Full home cleaning" }, price: 60 },
    { name: { ar: "تنظيف مكتب", en: "Office cleaning" }, price: 80 },
    { name: { ar: "تنظيف بعد الترميم", en: "Post-renovation cleaning" }, price: 120 },
  ],
  healthcare: [
    { name: { ar: "استشارة جلدية", en: "Dermatology consultation" }, price: 40 },
    { name: { ar: "جلسة تنظيف بشرة", en: "Facial treatment" }, price: 55 },
    { name: { ar: "فحص شامل", en: "Full check-up" }, price: 70 },
  ],
  realEstate: [
    { name: { ar: "شقة 140م² للبيع", en: "140m² apartment for sale" }, price: 165000 },
    { name: { ar: "شقة 90م² للإيجار", en: "90m² apartment for rent" }, price: 650 },
  ],
  automotive: [
    { name: { ar: "تغيير زيت وفلتر", en: "Oil and filter change" }, price: 35 },
    { name: { ar: "فحص ميكانيكي شامل", en: "Full mechanical check" }, price: 25 },
    { name: { ar: "تبديل إطارات", en: "Tire replacement" }, price: 90 },
  ],
  beauty: [
    { name: { ar: "قصّة شعر وتصفيف", en: "Haircut & styling" }, price: 20 },
    { name: { ar: "جلسة عناية بالوجه", en: "Facial session" }, price: 35 },
    { name: { ar: "مانيكير وباديكير", en: "Manicure & pedicure" }, price: 25 },
  ],
  fitness: [
    { name: { ar: "اشتراك شهري", en: "Monthly membership" }, price: 40 },
    { name: { ar: "حصّة تدريب شخصي", en: "Personal training session" }, price: 25 },
    { name: { ar: "حصّة جماعية", en: "Group class" }, price: 10 },
  ],
  sportsCourts: [
    { name: { ar: "حجز ملعب بادل / ساعة", en: "Padel court / hour" }, price: 30 },
    { name: { ar: "حجز ملعب كرة قدم / ساعة", en: "Football pitch / hour" }, price: 50 },
  ],
  education: [
    { name: { ar: "دورة لغة إنجليزية", en: "English course" }, price: 120 },
    { name: { ar: "درس خصوصي / ساعة", en: "Private lesson / hour" }, price: 15 },
    { name: { ar: "دورة برمجة للمبتدئين", en: "Beginner coding course" }, price: 150 },
  ],
  events: [
    { name: { ar: "حجز قاعة أفراح", en: "Wedding hall booking" }, price: 2000 },
    { name: { ar: "تنظيم مناسبة", en: "Event planning" }, price: 800 },
  ],
  hospitality: [
    { name: { ar: "ليلة بشاليه", en: "Chalet night" }, price: 120 },
    { name: { ar: "غرفة فندقية / ليلة", en: "Hotel room / night" }, price: 90 },
  ],
  // No lab test here. A blood test is an appointment with preparation
  // instructions and a result that arrives later, and this sector sells stock
  // off a shelf through a cart with a quantity selector — listing one as a $25
  // line item is the conflation MJ-009 is about, written into the registry's
  // own sample data. Labs belong to the clinic sector until they get one of
  // their own (see the note above `pharmacy` in sectors.ts).
  pharmacy: [
    { name: { ar: "دواء بوصفة", en: "Prescription medicine" }, price: 10 },
    { name: { ar: "مستلزمات عناية", en: "Personal care supplies" }, price: 8 },
    { name: { ar: "فيتامينات ومكمّلات", en: "Vitamins & supplements" }, price: 15 },
  ],
  petCare: [
    { name: { ar: "فحص بيطري", en: "Vet checkup" }, price: 30 },
    { name: { ar: "تنظيف وقصّ", en: "Grooming" }, price: 25 },
    { name: { ar: "تطعيم", en: "Vaccination" }, price: 20 },
  ],
  professional: [
    { name: { ar: "استشارة قانونية", en: "Legal consultation" }, price: 50 },
    { name: { ar: "تدقيق حسابات", en: "Accounting audit" }, price: 150 },
  ],
  contractors: [
    { name: { ar: "تشطيب شقة", en: "Apartment finishing" }, price: 5000 },
    { name: { ar: "دهان كامل", en: "Full painting" }, price: 400 },
    { name: { ar: "تركيب سيراميك", en: "Tiling" }, price: 800 },
  ],
  farm: [
    { name: { ar: "صندوق خضار طازة", en: "Fresh veggie box" }, price: 15 },
    { name: { ar: "عسل طبيعي", en: "Natural honey" }, price: 20 },
    { name: { ar: "بيض بلدي", en: "Farm eggs" }, price: 6 },
  ],
};
