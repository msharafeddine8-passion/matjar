// Builds the final curated directory: only businesses with a real presence.
//
//   node scripts/directory/final.mjs            -> data/final.json + data/final-logos.todo.json
//
// Tier 1: curated well-known names (data/curated).
// Tier 2: a curated Lebanese guide (BAM) with a social page or a website.
// Tier 3: OSM/web rows whose own website is alive and confirms a social account,
//         or that came with a social account, minus low-profile kinds of shop.
// One row per brand: same name, Instagram or website domain means same business.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data");
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const dir = (d) => (existsSync(d) ? readdirSync(d).filter((n) => n.endsWith(".json") && !n.endsWith(".todo.json")) : []);

const SECTORS = new Set(["retail", "services", "realEstate", "healthcare", "automotive", "food", "education", "beauty",
  "fitness", "sportsCourts", "events", "hospitality", "petCare", "professional", "contractors", "farm", "pharmacy"]);
const REGIONS = new Set(["beirut", "mountLebanon", "north", "south", "bekaa"]);
const clean = (s) => (s == null ? null : String(s).replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim() || null);
const validUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const norm = (s) => (s ?? "").toLowerCase().normalize("NFKC").replace(/[ًٌٍَُِّْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}]/gu, "");
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
// Hosts shared by unrelated businesses say nothing about identity.
const SHARED = /(facebook|instagram|wixsite|wordpress|blogspot|linktr|google|sites\.|booking|tripadvisor|bam\.agendaculturel|hilton|marriott|ihg|accor|radisson)/i;

// The owner's example: nobody wants a greengrocer or corner shop listed.
const LOW_NAME = /(خضار|خضرة|خضرا|خضروات|فواكه|فاكهة|greengrocer|vegetable|fruit ?market|دكان|سمانة|ميني ?ماركت|mini ?market|minimarket|كشك|kiosk|تبغ|دخان|غاز|ملحمة|لحوم طازجة|مسمكة|دواجن|بقالة|grocery)/i;
const pois = existsSync(join(DATA, ".cache/pois.json")) ? read(join(DATA, ".cache/pois.json")).elements : [];
const tags = new Map(pois.map((e) => [`osm:${e.type}/${e.id}`, e.tags]));
const LOW_SHOPS = new Set(["greengrocer", "convenience", "kiosk", "variety_store", "general", "butcher", "seafood", "water", "gas",
  "frozen_food", "dairy", "farm", "hardware", "doityourself", "second_hand", "charity", "supermarket"]);
// Curated rows that were themselves flagged as not fitting.
const DROP_CURATED = /(institut des finances)/i;

const verify = existsSync(join(DATA, "verify.json")) ? read(join(DATA, "verify.json")) : {};

const pool = [];
function add(raw, tier) {
  const r = { ...raw, tier };
  for (const k of ["name", "area", "address", "specialties", "description"]) r[k] = clean(r[k]);
  for (const k of ["website", "instagram", "facebook", "logo_url"]) { r[k] = clean(r[k]); if (r[k] && !validUrl(r[k])) r[k] = null; }
  for (const k of ["phone", "whatsapp"]) { r[k] = clean(r[k]); if (r[k] && !/^\+961 \d{7,8}$/.test(r[k])) r[k] = null; }
  if (!r.name || r.name.length < 2 || !SECTORS.has(r.sector) || !REGIONS.has(r.region)) return;
  if (!r.source_key || !r.source_url || !validUrl(r.source_url)) return;
  if (LOW_NAME.test(r.name)) return;
  pool.push(r);
}

for (const f of dir(join(DATA, "curated"))) {
  for (const r of read(join(DATA, "curated", f))) if (!DROP_CURATED.test(r.name ?? "")) add({ ...r, data_source: "web" }, 1);
}
for (const f of ["bam.json", "bam2.json"]) {
  const p = join(DATA, "web", f);
  if (!existsSync(p)) continue;
  for (const r of read(p)) if (r.instagram || r.facebook || r.website) add({ ...r, data_source: "web" }, 2);
}
const third = [];
for (const r of read(join(DATA, "presence.json"))) third.push(r);
for (const f of dir(join(DATA, "web")).filter((n) => !n.startsWith("bam"))) for (const r of read(join(DATA, "web", f))) third.push({ ...r, data_source: "web" });
for (const raw of third) {
  const r = { ...raw };
  const t = tags.get(r.source_key);
  if (t && LOW_SHOPS.has(t.shop) && !t.brand) continue;
  const v = verify[r.source_key];
  if (v) {
    if (!v.alive) r.website = null;
    else {
      r.instagram = r.instagram ?? v.instagram ?? null;
      r.facebook = r.facebook ?? v.facebook ?? null;
    }
  }
  // Tier 3 must have a social account: a bare website says little about standing.
  if (!r.instagram && !r.facebook) continue;
  add(r, 3);
}

// ── One row per brand, best tier first, fullest first ───────────────────────
const fullness = (r) => ["phone", "website", "instagram", "facebook", "logo_url", "description", "address"].filter((k) => r[k]).length;
pool.sort((a, b) => a.tier - b.tier || fullness(b) - fullness(a));
const seen = new Set();
const out = [];
for (const r of pool) {
  const keys = [`n:${norm(r.name)}`];
  if (r.instagram) keys.push(`i:${r.instagram.toLowerCase().replace(/\/+$/, "").split("?")[0]}`);
  const d = domain(r.website);
  if (d && !SHARED.test(d)) keys.push(`d:${d}`);
  if (keys.some((k) => seen.has(k))) continue;
  keys.forEach((k) => seen.add(k));
  const { tier, ...row } = r;
  out.push({ ...row, tier });
}

writeFileSync(join(DATA, "final.json"), JSON.stringify(out));
// Candidates for logos: what a curated row names, then what its own site offers.
writeFileSync(join(DATA, "final-logos.todo.json"), JSON.stringify(out.map((r) => ({
  source_key: r.source_key,
  logos: [r.logo_url, ...(verify[r.source_key]?.logos ?? [])].filter(Boolean),
  website: r.website,
}))));

const count = (k) => out.reduce((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
console.log({ total: out.length, pool: pool.length }, "by tier", count("tier"));
console.log("by sector", count("sector"));
console.log("by region", count("region"));
console.log({ phone: out.filter((r) => r.phone).length, social: out.filter((r) => r.instagram || r.facebook).length,
  website: out.filter((r) => r.website).length, logoCandidates: out.filter((r) => r.logo_url || verify[r.source_key]?.logos?.length).length });
for (const t of [1, 2, 3]) console.log(`tier ${t}:`, out.filter((r) => r.tier === t).sort(() => Math.random() - 0.5).slice(0, 18).map((r) => r.name).join(" | "));
