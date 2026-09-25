import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categoryKeys, groupKeys, regions } from "@/lib/catalog";
import {
  AREA_BY_SLUG,
  LB_AREAS,
  LEXICON,
  SPECIALTY_KEYS,
  TRADES,
  TRADE_SLUGS,
  foldArabic,
  ilikeBody,
  intentLinks,
  listingSearchTerms,
  normalizeArabic,
  parseSearchIntent,
  planStoreSearch,
  productSearchTerms,
  rankStores,
  stemVariants,
  storeTextOrClause,
  type RankableStore,
} from "@/lib/search-intent";

// ---------------------------------------------------------------------------
// 1. normalizeArabic is the database's normalize_search, not an approximation
// ---------------------------------------------------------------------------
//
// Every pair below was produced by calling public.normalize_search on
// production (anon RPC, 2026-09-25). The one surprise is documented rather than
// "fixed": ة is NOT folded to ه by the SQL — translate('أإآٱىة','ااااية') maps
// ة to itself — so parity means keeping ة here too. foldArabic() does the ة→ه
// fold for matching only.

const DB_NORMALIZE_SEARCH: [string, string | null][] = [
  ["مَدْرَسَةٌ", "مدرسة"],
  ["إلى البيت", "الي البيت"],
  ["آخر", "اخر"],
  ["ٱلعالم", "العالم"],
  ["مصطفى", "مصطفي"],
  ["  Hello   WORLD  ", "hello world"],
  ["طـــرابلس", "طرابلس"],
  ["tab\tand\nnewline", "tab and newline"],
  ["سوق الأحد", "سوق الاحد"],
  ["قطّة", "قطة"],
  ["  ", null],
  ["iPhone 15", "iphone 15"],
  ["الأشرفيّة", "الاشرفية"],
  ["مَطاعِم", "مطاعم"],
  // btrim() strips spaces only: a leading TAB survives as one space.
  ["\tlead", " lead"],
];

describe("normalizeArabic ≡ public.normalize_search", () => {
  it.each(DB_NORMALIZE_SEARCH)("%j → %j", (input, db) => {
    expect(normalizeArabic(input)).toBe(db ?? "");
  });

  it("documents the mapping: tashkeel/tatweel out, أإآٱ→ا, ى→ي, ة kept", () => {
    expect(normalizeArabic("\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0640")).toBe("");
    expect(normalizeArabic("أإآٱ")).toBe("اااا");
    expect(normalizeArabic("ى")).toBe("ي");
    expect(normalizeArabic("ة")).toBe("ة");
  });

  it("the migration still says what this mirrors", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0216_platform_instrumentation.sql"),
      "utf8",
    );
    expect(sql).toContain("'أإآٱىة', 'ااااية'");
    expect(sql).toContain("[ًٌٍَُِّْـ]");
  });

  it("foldArabic additionally folds ة→ه, digits and punctuation, for matching only", () => {
    expect(foldArabic("منقوشة")).toBe(foldArabic("منقوشه"));
    expect(foldArabic("٣ كيلو")).toBe("3 كيلو");
    expect(foldArabic("«سوق الأحد»!")).toBe("سوق الاحد");
  });
});

// ---------------------------------------------------------------------------
// 2. Stemming — conservative variants, the word as typed first
// ---------------------------------------------------------------------------

describe("stemVariants", () => {
  it("keeps the word itself first", () => {
    expect(stemVariants("مطاعم")[0]).toBe("مطاعم");
  });
  it("strips the article and clitic prefixes", () => {
    expect(stemVariants("المطاعم")).toContain("مطاعم");
    expect(stemVariants("للرجال")).toContain("رجال");
    expect(stemVariants("بالحمرا")).toContain("حمرا");
    expect(stemVariants("والصيدليات")).toContain("صيدليات");
  });
  it("strips plural and feminine endings, re-adding ة (as ه) after ات", () => {
    expect(stemVariants(foldArabic("عيادات"))).toEqual(
      expect.arrayContaining(["عياد", "عياده"]),
    );
    expect(stemVariants("مصلحين")).toContain("مصلح");
    expect(stemVariants(foldArabic("منقوشة"))).toContain("منقوش");
    expect(stemVariants(foldArabic("الرجالية"))).toContain("رجال");
  });
  it("never leaves fewer than three letters", () => {
    expect(stemVariants("ورد")).toEqual(["ورد"]);
    expect(stemVariants(foldArabic("شقة"))).toEqual(["شقه"]);
    expect(stemVariants("الي")).toEqual(["الي"]);
  });
  it("drops a Latin plural -s", () => {
    expect(stemVariants("cars")).toContain("car");
    expect(stemVariants("bus")).toEqual(["bus"]);
  });
});

// ---------------------------------------------------------------------------
// 3. The brief's five examples
// ---------------------------------------------------------------------------

describe("the brief's examples", () => {
  it("«دكتور عيون طرابلس» → healthcare + ophthalmology + Tripoli (north)", () => {
    const i = parseSearchIntent("دكتور عيون طرابلس");
    expect(i.sector).toBe("healthcare");
    expect(i.group).toBe("health");
    expect(i.specialty).toBe("ophthalmology");
    expect(i.area).toBe("tripoli");
    expect(i.region).toBe("north");
    expect(i.residual).toBe("");
    expect(i.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("«مكيف ما عم يبرد» → crafts / AC service, in the services group", () => {
    const i = parseSearchIntent("مكيف ما عم يبرد");
    expect(i.section).toBe("crafts");
    expect(i.trade).toBe("ac-service");
    expect(i.group).toBe("services");
    expect(i.residual).toBe("");
  });

  it("«شقة للايجار» → real estate, rent", () => {
    const i = parseSearchIntent("شقة للايجار");
    expect(i.sector).toBe("realEstate");
    expect(i.deal).toBe("rent");
  });

  it("«برغر» → food", () => {
    expect(parseSearchIntent("برغر").sector).toBe("food");
  });

  it("«iphone» → retail", () => {
    expect(parseSearchIntent("iphone").sector).toBe("retail");
    expect(parseSearchIntent("iPhone").sector).toBe("retail");
    expect(parseSearchIntent("ايفون").sector).toBe("retail");
  });
});

// ---------------------------------------------------------------------------
// 4. The real zero-result queries from production search_logs (2026-09-24)
// ---------------------------------------------------------------------------

describe("the zero-result queries now mean something", () => {
  it("«مطاعم» → food", () => {
    expect(parseSearchIntent("مطاعم").sector).toBe("food");
    expect(parseSearchIntent("المطاعم").sector).toBe("food");
  });
  it("«ملابس» → retail, searching the clothing words shops really write", () => {
    const i = parseSearchIntent("ملابس");
    expect(i.sector).toBe("retail");
    // «ألبسة نسائي ولادب» is the production store: its words must be searched.
    expect(planStoreSearch(i).intentTerms).toContain(foldArabic("ألبسة"));
  });
  it("«سوق الاحد» / «سوق الأحد» → the Sunday Market section", () => {
    expect(parseSearchIntent("سوق الاحد").section).toBe("market");
    expect(parseSearchIntent("سوق الأحد").section).toBe("market");
    expect(listingSearchTerms(parseSearchIntent("سوق الاحد"))).toEqual([null]);
  });
  it("«قطة» → pet care", () => {
    expect(parseSearchIntent("قطة").sector).toBe("petCare");
    expect(parseSearchIntent("قطط").sector).toBe("petCare");
  });
  it("«فول» → food", () => {
    expect(parseSearchIntent("فول").sector).toBe("food");
  });
  it("«للرجال» → no sector (it is an audience), but stems to «رجال» for text", () => {
    const i = parseSearchIntent("للرجال");
    expect(i.sector).toBeUndefined();
    expect(i.residual).toBe("للرجال");
    expect(planStoreSearch(i).residualTerms).toContain("رجال");
  });
  it("«ايتوماكس» / «etumax» → a brand: nothing understood, and nothing invented", () => {
    for (const q of ["ايتوماكس", "etumax"]) {
      const i = parseSearchIntent(q);
      expect(i.confidence).toBe(0);
      expect(i.sector).toBeUndefined();
      expect(i.section).toBeUndefined();
      expect(i.residual).toBe(foldArabic(q));
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Location
// ---------------------------------------------------------------------------

describe("location extraction", () => {
  it.each([
    ["طرابلس", "tripoli", "north"],
    ["طرابلوس", "tripoli", "north"],
    ["Tripoli", "tripoli", "north"],
    ["trablos", "tripoli", "north"],
    ["بيروت", "beirut-city", "beirut"],
    ["الأشرفية", "achrafieh", "beirut"],
    ["اشرفية", "achrafieh", "beirut"],
    ["الحمرا", "hamra", "beirut"],
    ["Hamra", "hamra", "beirut"],
    ["ابو سمرا", "abi-samra", "north"],
    ["زحلة", "zahle", "bekaa"],
    ["صيدا", "saida", "south"],
  ])("%s → %s (%s)", (q, area, region) => {
    const i = parseSearchIntent(q);
    expect(i.area).toBe(area);
    expect(i.region).toBe(region);
  });

  it("resolves a region word without an area", () => {
    const i = parseSearchIntent("مطعم بالشمال");
    expect(i.region).toBe("north");
    expect(i.area).toBeUndefined();
    expect(i.sector).toBe("food");
  });

  it("does not read everyday words as places", () => {
    expect(parseSearchIntent("صور عرس").region).toBeUndefined(); // صور = pictures
    expect(parseSearchIntent("فساتين حمرا").area).toBeUndefined(); // حمرا = red
    expect(parseSearchIntent("شوف مطاعم").area).toBeUndefined(); // شوف = look
    expect(parseSearchIntent("جبل محسن").region).toBeUndefined();
  });

  it("an understood area can be matched against the free-text stores.area", () => {
    const plan = planStoreSearch(parseSearchIntent("طرابلس"));
    expect(plan.pullRegion).toBe(true);
    expect(plan.areaTerms).toContain("طرابلس");
    expect(storeTextOrClause(plan)).toContain("area.ilike.%طر_بلس%");
  });
});

// ---------------------------------------------------------------------------
// 6. No fabricated slug, sector, region or area
// ---------------------------------------------------------------------------

const SEED = readFileSync(
  join(process.cwd(), "supabase/migrations/0236_seed_lebanese_trades_and_areas.sql"),
  "utf8",
);

function seedRows(table: string): string[][] {
  const start = SEED.indexOf(`insert into public.${table} `);
  const end = SEED.indexOf("on conflict", start);
  const body = SEED.slice(start, end);
  return [...body.matchAll(/\('([^']+)','([^']+)','([^']+)','([^']+)'/g)].map((m) =>
    m.slice(1),
  );
}

describe("no fabricated slug", () => {
  const seedTrades = seedRows("trades").map((r) => r[0]);
  const seedAreas = seedRows("lb_areas");

  it("reads the seed at all (guards the parser)", () => {
    expect(seedTrades).toHaveLength(47);
    expect(seedAreas).toHaveLength(45);
  });

  it("TRADES is exactly the 47 seeded trades", () => {
    expect([...TRADE_SLUGS].sort()).toEqual([...seedTrades].sort());
    expect(TRADES).toHaveLength(47);
  });

  it("every trade slug the lexicon names exists in public.trades", () => {
    const named = LEXICON.map((c) => c.meaning.trade).filter(Boolean) as string[];
    expect(named.length).toBeGreaterThan(40);
    for (const slug of named) expect(seedTrades).toContain(slug);
  });

  it("LB_AREAS is exactly the 45 seeded areas, same region and names", () => {
    expect(LB_AREAS).toHaveLength(45);
    for (const [slug, region, ar, en] of seedAreas) {
      const a = AREA_BY_SLUG.get(slug);
      expect(a, slug).toBeTruthy();
      expect(a!.region).toBe(region);
      expect(a!.ar).toBe(ar);
      expect(a!.en).toBe(en);
    }
  });

  it("every sector / group / region / specialty is a real key", () => {
    const regionKeys = regions.map((r) => r.key as string);
    for (const c of LEXICON) {
      if (c.meaning.sector) expect(categoryKeys).toContain(c.meaning.sector);
      if (c.meaning.group) expect(groupKeys).toContain(c.meaning.group);
      if (c.meaning.specialty) expect(SPECIALTY_KEYS).toContain(c.meaning.specialty);
    }
    for (const a of LB_AREAS) expect(regionKeys).toContain(a.region);
  });

  it("concept ids are unique", () => {
    const ids = LEXICON.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// 7. Query building and ranking
// ---------------------------------------------------------------------------

describe("ilikeBody", () => {
  it("escapes the buyer's wildcards and PostgREST syntax", () => {
    expect(ilikeBody("50%")).toBe("50\\%");
    expect(ilikeBody("a,b(c)")).toBe("a b c");
  });
  it("tolerates alef and final ة/ه spellings on words of four letters or more", () => {
    expect(ilikeBody("اشرفيه")).toBe("_شرفي_");
    expect(ilikeBody("اكل")).toBe("اكل");
  });
});

const store = (over: Partial<RankableStore> & { id: string }): RankableStore => ({
  name: "",
  description: null,
  area: null,
  specialties: null,
  region: null,
  sector: "retail",
  ...over,
});

describe("rankStores", () => {
  // Shapes of real production rows (2026-09-24), trimmed to what ranking reads.
  const omar = store({ id: "omar", name: "دكتور عمر الصمد", description: "عيادة عيون فحص نظر و عمليات لايزر و لايزك", area: "طرابلس اشارة الميتين", region: "north", sector: "healthcare", rating: 0 });
  const dinnieh = store({ id: "dinnieh", name: "مركز الضنية الطبي", description: "مركز طبي يتضمن كافة الخدمات الطبية", area: "الضنية مراح السراج", region: "north", sector: "healthcare" });
  const letsMeat = store({ id: "meat", name: "Let’s meat", description: "وجهتك للحوم الطازجة والمشاوي الشهية", region: "north", sector: "food" });
  const albisa = store({ id: "albisa", name: "ألبسة نسائي ولادب", description: "ألبسة نسائي وأحذية", sector: "retail" });
  const nazih = store({ id: "nazih", name: "Nazih Home", description: "مفروشات", area: "طرابلس - التربيعة", region: "north", sector: "retail", rating: 5 });
  const qabass = store({ id: "qabass", name: "Qabass Computers - قبس كمبيوترز", description: "offers electronic products", area: "طرابلس البولفار", region: "north", sector: "retail" });
  const aanab = store({ id: "aanab", name: "Aanab_perfumes", description: "أشهر الروائح الرجالية", area: "عكار", region: "north", sector: "beauty" });
  const beirutShop = store({ id: "beirut", name: "Beirut Burger", region: "beirut", sector: "food" });
  const all = [omar, dinnieh, letsMeat, albisa, nazih, qabass, aanab, beirutShop];

  const run = (q: string, doctors: string[] = []) =>
    rankStores(all, planStoreSearch(parseSearchIntent(q)), new Set(doctors)).map((s) => s.id);

  it("«مطاعم» returns the restaurant that never writes the word", () => {
    expect(run("مطاعم")).toEqual(["meat", "beirut"]);
  });
  it("«ملابس» returns the clothing shop, not every retailer", () => {
    expect(run("ملابس")).toEqual(["albisa"]);
  });
  it("«iphone» returns the electronics shop", () => {
    expect(run("iphone")).toEqual(["qabass"]);
  });
  it("«للرجال» finds the store whose description says «الرجالية»", () => {
    expect(run("للرجال")).toEqual(["aanab"]);
  });
  it("«دكتور عيون طرابلس» ranks the eye clinic first and keeps the centre whose doctor is an ophthalmologist", () => {
    expect(run("دكتور عيون طرابلس", ["dinnieh"])).toEqual(["omar", "dinnieh"]);
  });
  it("a specialty with no match is an empty answer, not another clinic", () => {
    expect(run("دكتور اسنان")).toEqual([]);
  });
  it("a stated region drops stores that state a different one", () => {
    expect(run("مطعم طرابلس")).toEqual(["meat"]);
  });
  it("a place alone returns that region, the named area first", () => {
    const ids = run("طرابلس");
    expect(ids.slice(0, 3).sort()).toEqual(["nazih", "omar", "qabass"].sort());
    expect(ids).not.toContain("beirut");
  });
  it("intent vocabulary does not pull stores from another sector", () => {
    const taxi = store({ id: "taxi", name: "Alo sam taxi", description: "بإحراق أنواع السيارات المريحة", region: "north", sector: "services" });
    const plan = planStoreSearch(parseSearchIntent("صيانة سيارة"));
    expect(rankStores([taxi], plan).map((s) => s.id)).toEqual([]);
  });
  it("an unknown brand matches only literal text", () => {
    expect(run("etumax")).toEqual([]);
  });
});

describe("product and listing search terms", () => {
  it("adds the residual and a single word's stem, never more than three", () => {
    expect(productSearchTerms(parseSearchIntent("المطاعم"))).toEqual(["المطاعم", "مطاعم"]);
    expect(productSearchTerms(parseSearchIntent("برغر"))).toEqual(["برغر"]);
    expect(productSearchTerms(parseSearchIntent("شاورما لحمة طرابلس")).length).toBeLessThanOrEqual(3);
  });
  it("looks for «iphone» in Arabic too (the live listing is titled «ايفون 11 برو ماكس»)", () => {
    expect(listingSearchTerms(parseSearchIntent("iphone"))).toEqual(["iphone", "ايفون"]);
  });
  it("does not cross scripts for a loose concept", () => {
    expect(listingSearchTerms(parseSearchIntent("بيتزا"))).toEqual(["بيتزا"]);
  });
});

describe("intentLinks — the real discovery / section URLs", () => {
  it("sector + region → /explore?sector=…&region=…", () => {
    const links = intentLinks(parseSearchIntent("دكتور عيون طرابلس"), "ar");
    expect(links).toEqual([
      expect.objectContaining({ kind: "stores", href: "/ar/explore?sector=healthcare&region=north" }),
    ]);
  });
  it("a crafts trade → /crafts/<trade>, with the area when one was named", () => {
    expect(intentLinks(parseSearchIntent("مكيف ما عم يبرد"), "ar")).toEqual([
      expect.objectContaining({ kind: "section", href: "/ar/crafts/ac-service" }),
    ]);
    expect(intentLinks(parseSearchIntent("كهربجي طرابلس"), "en")).toEqual([
      expect.objectContaining({ href: "/en/crafts/electrician?area=tripoli" }),
    ]);
  });
  it("sections link to their own roots", () => {
    expect(intentLinks(parseSearchIntent("سوق الاحد"), "ar")[0].href).toBe("/ar/market");
    expect(intentLinks(parseSearchIntent("وظايف"), "ar")[0].href).toBe("/ar/jobs");
    expect(intentLinks(parseSearchIntent("freelance"), "en")[0].href).toBe("/en/freelance");
  });
  it("drops a store link onto an empty sector", () => {
    expect(intentLinks(parseSearchIntent("قطة"), "ar", () => false)).toEqual([]);
  });
});
