// Builds the OpenStreetMap part of the directory: real Lebanese businesses with
// the facts OSM states about them, mapped onto Matjar's sectors and regions.
//
//   node scripts/directory/osm.mjs          -> scripts/directory/data/osm.json
//
// OSM data is © OpenStreetMap contributors, ODbL. Every row keeps its source_url
// and the store page shows the attribution. Facts only: nothing here invents a
// description, rating or photo. Businesses are imported as `unconfirmed`.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data");
const CACHE = join(DATA, ".cache");
mkdirSync(CACHE, { recursive: true });

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const UA = "Matjar-directory/1.0 (matjarlb.com)";

async function overpass(name, query) {
  const file = join(CACHE, `${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  // Public Overpass servers shed load with 429/502/504: try the next one.
  let j = null, last = "";
  for (let attempt = 0; attempt < 8 && !j; attempt++) {
    const endpoint = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
      });
      if (res.ok) j = await res.json();
      else last = `${endpoint} ${res.status}`;
    } catch (err) { last = `${endpoint} ${err.message}`; }
    if (!j) await new Promise((r) => setTimeout(r, 15000));
  }
  if (!j) throw new Error(`overpass ${name}: ${last}`);
  writeFileSync(file, JSON.stringify(j));
  return j;
}

const AREA = `area["ISO3166-1"="LB"][admin_level=2]->.lb;`;

const pois = await overpass(
  "pois",
  `[out:json][timeout:170];${AREA}(
  nwr["shop"]["name"](area.lb);
  nwr["amenity"~"^(restaurant|cafe|fast_food|ice_cream|pharmacy|clinic|doctors|dentist|hospital|veterinary|car_rental|car_wash|driving_school|language_school|kindergarten|school|college|university|events_venue|conference_centre)$"]["name"](area.lb);
  nwr["tourism"~"^(hotel|guest_house|hostel|motel|chalet|apartment|resort)$"]["name"](area.lb);
  nwr["leisure"~"^(fitness_centre|sports_centre|pitch|swimming_pool)$"]["name"](area.lb);
  nwr["craft"]["name"](area.lb);
  nwr["office"~"^(lawyer|accountant|architect|engineer|estate_agent|insurance|it|consulting|notary|travel_agent|tax_advisor)$"]["name"](area.lb);
  nwr["healthcare"]["name"](area.lb);
);out center tags;`,
);
const govs = await overpass(
  "governorates",
  `[out:json][timeout:170];${AREA}rel["boundary"="administrative"]["admin_level"="4"](area.lb);out geom;`,
);
const places = await overpass(
  "places",
  `[out:json][timeout:170];${AREA}node["place"~"^(city|town|village|suburb|neighbourhood|quarter|hamlet)$"]["name"](area.lb);out body;`,
);

// ── Region: which governorate polygon the point falls in ────────────────────
// Eight governorates fold into Matjar's five regions.
function regionFor(tags) {
  const n = `${tags["name:en"] ?? ""} ${tags.name ?? ""}`.toLowerCase();
  if (/beirut|بيروت/.test(n)) return "beirut";
  if (/mount|جبل/.test(n)) return "mountLebanon";
  if (/keserwan|jbeil|كسروان|جبيل/.test(n)) return "mountLebanon";
  if (/akkar|north|عكار|الشمال/.test(n)) return "north";
  if (/nabat|south|النبطية|الجنوب/.test(n)) return "south";
  if (/baalbek|hermel|bekaa|beqaa|بعلبك|البقاع/.test(n)) return "bekaa";
  return null;
}
const polygons = [];
for (const g of govs.elements) {
  const region = regionFor(g.tags ?? {});
  if (!region) { console.warn("unmapped governorate", g.tags?.name); continue; }
  // Stitch outer ways into rings: ways share endpoints, in any order/direction.
  const ways = (g.members ?? []).filter((m) => m.type === "way" && m.role !== "inner" && m.geometry)
    .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  const key = (p) => `${p[0]},${p[1]}`;
  while (ways.length) {
    let ring = ways.shift();
    for (let grew = true; grew && key(ring[0]) !== key(ring[ring.length - 1]); ) {
      grew = false;
      for (let i = 0; i < ways.length; i++) {
        const w = ways[i];
        const end = key(ring[ring.length - 1]);
        if (key(w[0]) === end) ring = ring.concat(w.slice(1));
        else if (key(w[w.length - 1]) === end) ring = ring.concat([...w].reverse().slice(1));
        else continue;
        ways.splice(i, 1);
        grew = true;
        break;
      }
    }
    polygons.push({ region, ring });
  }
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const regionAt = (lat, lng) => polygons.find((p) => inRing(lng, lat, p.ring))?.region ?? null;

// ── Area: the nearest named place ───────────────────────────────────────────
const placeList = places.elements
  .filter((p) => p.lat && p.lon)
  .map((p) => ({ lat: p.lat, lon: p.lon, name: p.tags["name:ar"] ?? p.tags.name, kind: p.tags.place }));
function km(aLat, aLon, bLat, bLon) {
  const dx = (aLon - bLon) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  const dy = (aLat - bLat) * 110.57;
  return Math.hypot(dx, dy);
}
function areaAt(lat, lng) {
  let best = null, bestD = 8;
  for (const p of placeList) {
    if (Math.abs(p.lat - lat) > 0.08 || Math.abs(p.lon - lng) > 0.1) continue;
    const d = km(lat, lng, p.lat, p.lon);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best?.name ?? null;
}

// ── Sector mapping ──────────────────────────────────────────────────────────
const SKIP_SHOPS = new Set(["vacant", "no", "lottery", "money_lender", "pawnbroker", "weapons", "erotic",
  "tobacco", "e-cigarette", "cannabis", "funeral_directors", "bookmaker", "gas", "fuel", "yes;no"]);
const FOOD_SHOPS = new Set(["bakery", "pastry", "butcher", "greengrocer", "seafood", "confectionery", "coffee",
  "deli", "beverages", "cheese", "chocolate", "dairy", "frozen_food", "nuts", "spices", "tea", "water", "food"]);
const BEAUTY_SHOPS = new Set(["beauty", "hairdresser", "cosmetics", "perfumery", "massage", "tattoo", "nails", "hairdresser_supply"]);
const HEALTH_SHOPS = new Set(["optician", "hearing_aids", "medical_supply", "nutrition_supplements"]);
const AUTO_SHOPS = new Set(["car", "car_repair", "car_parts", "tyres", "motorcycle", "motorcycle_repair", "truck", "caravan"]);
const SERVICE_SHOPS = new Set(["laundry", "dry_cleaning", "copyshop", "tailor", "shoe_repair", "mobile_phone_repair",
  "computer_repair", "printing", "photo", "storage_rental", "repair", "locksmith", "key_cutter", "pest_control", "rental"]);
const CONTRACTOR_CRAFTS = new Set(["electrician", "plumber", "carpenter", "builder", "hvac", "painter", "metal_construction",
  "tiler", "roofer", "glaziery", "plasterer", "stonemason", "insulation", "floorer", "gardener", "blacksmith", "welder"]);
const FARM = new Set(["farm", "agrarian", "garden_centre"]);

function sectorFor(t) {
  const a = t.amenity, s = t.shop;
  if (a === "pharmacy" || s === "pharmacy") return "pharmacy";
  if (["restaurant", "cafe", "fast_food", "ice_cream"].includes(a) || FOOD_SHOPS.has(s)) return "food";
  if (["hospital", "clinic", "doctors", "dentist"].includes(a) || t.healthcare || HEALTH_SHOPS.has(s)) return "healthcare";
  if (BEAUTY_SHOPS.has(s) || t.craft === "beautician") return "beauty";
  if (a === "veterinary" || s === "pet") return "petCare";
  if (t.tourism) return "hospitality";
  if (t.leisure === "fitness_centre") return "fitness";
  if (t.leisure) return "sportsCourts";
  if (["car_rental", "car_wash"].includes(a) || AUTO_SHOPS.has(s)) return "automotive";
  if (["school", "college", "university", "kindergarten", "language_school", "driving_school"].includes(a)) return "education";
  if (t.office === "estate_agent" || s === "estate_agent") return "realEstate";
  if (t.office || s === "travel_agency") return "professional";
  if (["events_venue", "conference_centre"].includes(a) || s === "party" || t.craft === "caterer") return "events";
  if (FARM.has(s)) return "farm";
  if (CONTRACTOR_CRAFTS.has(t.craft)) return "contractors";
  if (t.craft || SERVICE_SHOPS.has(s)) return "services";
  if (s) return "retail";
  return null;
}

// A generic shop tag says little; the business's own name often says more.
const NAME_SECTORS = [
  [/صيدلية|pharmac/i, "pharmacy"],
  [/مطعم|restaurant|bakery|فرن|ملحمة|حلويات|سناك|snack|pizza|shawarma|شاورما|butcher|sweets|patisserie/i, "food"],
  [/beauty|salon|صالون|تجميل|coiffure|barber|حلاق|nails|\bspa\b/i, "beauty"],
  [/عقار|real ?estate|immobili/i, "realEstate"],
  [/ميكانيك|مرآب|كاراج|garage|auto ?(parts|service)|سيارات|car (service|wash)|rent a car/i, "automotive"],
  [/مكتب المحامي|محامي|lawyer|law firm|avocat|محاسب|accounting|insurance|تأمين|travel|سياحة وسفر/i, "professional"],
  [/رخام|غرانيت|marble|granite|مقاول|contracting|نجار|حدّاد|حداد|سنكري|كهربائي|electric(al)? (works|contract)/i, "contractors"],
  [/عيادة|clinic|dental|مختبر|laboratory|optic|نظارات/i, "healthcare"],
  [/مزرعة|\bfarm\b|مشتل|nursery|زراعي/i, "farm"],
  [/pet ?shop|بيطر|veterinar/i, "petCare"],
];
function refine(sector, name) {
  if (sector !== "retail" && sector !== "services") return sector;
  for (const [re, to] of NAME_SECTORS) if (re.test(name)) return to;
  return sector;
}

// Charities and orphanages aren't businesses; a directory shouldn't list them as one.
const NOT_A_BUSINESS = /(أيتام|ايتام|orphan|جمعية|association|مسجد|mosque|كنيسة|church|بلدية|municipality|وزارة|ministry)/i;

// Bidi marks and stray spacing come through from editors' keyboards.
const clean = (s) => String(s).replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();

// ── Quality gate ────────────────────────────────────────────────────────────
const GENERIC = /^(pharmacy|restaurant|cafe|caf[eé]|coffee|shop|store|market|mini ?market|supermarket|bakery|snack|school|hospital|clinic|hotel|gym|garage|atm|salon|barber|butcher|mosque|church|صيدلية|مطعم|مقهى|قهوة|محل|سوبرماركت|سوبر ماركت|ميني ماركت|فرن|مدرسة|مستشفى|عيادة|فندق|حلاق|ملحمة|دكان|كافيه|سناك|ملعب)$/i;
const PUBLIC_SCHOOL = /(رسمية|الرسمي|public school|official school|ecole officielle|école officielle|مهنية رسمية)/i;

const digits = (s) => s.replace(/[^0-9]/g, "");
/** A Lebanese number in a canonical readable form, or null. */
function phoneOf(raw) {
  if (!raw) return null;
  let d = digits(String(raw).split(/[;,/]/)[0]);
  if (d.startsWith("00961")) d = d.slice(5);
  else if (d.startsWith("961")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length < 7 || d.length > 8) return null;
  return `+961 ${d}`;
}
const url = (v) => {
  if (!v) return null;
  const s = String(v).split(";")[0].trim();
  if (!s) return null;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { new URL(u); return u; } catch { return null; }
};
const handle = (v, host) => {
  if (!v) return null;
  const s = String(v).split(";")[0].trim();
  return /^https?:\/\//i.test(s) ? s : `https://${host}/${s.replace(/^@/, "")}`;
};

const rows = [];
const dropped = {};
const drop = (why) => (dropped[why] = (dropped[why] ?? 0) + 1);

for (const e of pois.elements) {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  const name = clean(t.name ?? "");
  if (!lat || !lng) { drop("no_position"); continue; }
  if (name.length < 3 || /^[0-9\s.-]+$/.test(name) || GENERIC.test(name)) { drop("generic_name"); continue; }
  if (Object.keys(t).some((k) => /^(disused|abandoned|demolished|razed|was):/.test(k)) || t.opening_hours === "closed") { drop("closed"); continue; }
  if (NOT_A_BUSINESS.test(name)) { drop("not_a_business"); continue; }
  if (SKIP_SHOPS.has(t.shop)) { drop("excluded_kind"); continue; }
  if (t.amenity === "school" && (PUBLIC_SCHOOL.test(name) || /public|government/.test(t["operator:type"] ?? ""))) { drop("public_school"); continue; }
  const base = sectorFor(t);
  if (!base) { drop("no_sector"); continue; }
  const sector = refine(base, name);
  const region = regionAt(lat, lng);
  if (!region) { drop("outside_regions"); continue; }
  const area = t["addr:city"] && /[؀-ۿ]/.test(t["addr:city"]) ? t["addr:city"] : areaAt(lat, lng);
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  rows.push({
    name: name.slice(0, 120),
    sector,
    region,
    area: clean(area ?? t["addr:city"] ?? "") || null,
    address: clean(street) || null,
    phone: phoneOf(t.phone ?? t["contact:phone"] ?? t["contact:mobile"] ?? t.mobile),
    whatsapp: phoneOf(t["contact:whatsapp"]),
    website: url(t.website ?? t["contact:website"]),
    instagram: handle(t["contact:instagram"] ?? t.instagram, "instagram.com"),
    facebook: handle(t["contact:facebook"] ?? t.facebook, "facebook.com"),
    lat: +lat.toFixed(6),
    lng: +lng.toFixed(6),
    opening_hours: t.opening_hours ?? null,
    specialties: t.cuisine ? t.cuisine.replace(/;/g, "، ").replace(/_/g, " ") : null,
    data_source: "openstreetmap",
    source_url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    source_key: `osm:${e.type}/${e.id}`,
  });
}

// Same name within ~120 m is the same place mapped twice: keep the fuller one.
const richness = (r) => ["phone", "website", "address", "area", "opening_hours", "instagram", "facebook"].filter((k) => r[k]).length;
const seen = new Map();
const out = [];
for (const r of [...rows].sort((a, b) => richness(b) - richness(a))) {
  const k = r.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const near = (seen.get(k) ?? []).some((o) => km(o.lat, o.lng, r.lat, r.lng) < 0.12);
  if (near) { drop("duplicate"); continue; }
  seen.set(k, [...(seen.get(k) ?? []), r]);
  out.push(r);
}

writeFileSync(join(DATA, "osm.json"), JSON.stringify(out));

const count = (k) => out.reduce((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
console.log("rows", out.length, "of", pois.elements.length);
console.log("by sector", count("sector"));
console.log("by region", count("region"));
console.log("with phone", out.filter((r) => r.phone).length, "website", out.filter((r) => r.website).length,
  "area", out.filter((r) => r.area).length, "address", out.filter((r) => r.address).length);
console.log("dropped", dropped);
console.log("polygons", polygons.length, [...new Set(polygons.map((p) => p.region))]);
