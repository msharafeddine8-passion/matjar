// Merges OSM + web research + enrichment into validated import batches.
//
//   node scripts/directory/build.mjs [--out public/directory-seed]
//
// Rejects anything that doesn't pass: a row needs a real sector and region, a
// name, a source_key and a source. Enrichment only ever adds a field that's
// empty; it never overwrites what a source stated.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data");
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? process.argv[outArg + 1] : join(DATA, "batches");
const BATCH = 800;

const SECTORS = new Set(["retail", "services", "realEstate", "healthcare", "automotive", "food", "education", "beauty",
  "fitness", "sportsCourts", "events", "hospitality", "petCare", "professional", "contractors", "farm", "pharmacy"]);
const REGIONS = new Set(["beirut", "mountLebanon", "north", "south", "bekaa"]);

const clean = (s) => (s == null ? null : String(s).replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim() || null);
const validPhone = (p) => /^\+961 \d{7,8}$/.test(p ?? "");
const validUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
const norm = (s) => (s ?? "").toLowerCase().normalize("NFKC").replace(/[ًٌٍَُِّْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}]/gu, "");

const issues = {};
const flag = (w) => (issues[w] = (issues[w] ?? 0) + 1);

function sanitize(r) {
  const row = { ...r };
  for (const k of ["name", "area", "address", "opening_hours", "specialties"]) row[k] = clean(row[k]);
  for (const k of ["phone", "whatsapp"]) {
    row[k] = clean(row[k]);
    if (row[k] && !validPhone(row[k])) { flag(`bad_${k}`); row[k] = null; }
  }
  for (const k of ["website", "instagram", "facebook"]) {
    row[k] = clean(row[k]);
    if (row[k] && !validUrl(row[k])) { flag(`bad_${k}`); row[k] = null; }
  }
  if (!row.name || row.name.length < 3) return flag("no_name"), null;
  if (!SECTORS.has(row.sector)) return flag("bad_sector"), null;
  if (!REGIONS.has(row.region)) return flag("bad_region"), null;
  if (!row.source_key || !row.source_url || !validUrl(row.source_url)) return flag("no_source"), null;
  // A web row needs a way to reach the business or at least a town to find it in.
  if (row.data_source === "web" && !(row.phone || row.website || row.instagram || row.facebook || row.address || row.area)) {
    return flag("web_no_contact"), null;
  }
  row.name = row.name.slice(0, 120);
  return row;
}

const osm = JSON.parse(readFileSync(join(DATA, "osm.json"), "utf8")).map(sanitize).filter(Boolean);
const byKey = new Map(osm.map((r) => [r.source_key, r]));

// ── Enrichment ──────────────────────────────────────────────────────────────
let enriched = 0;
const enrichDir = join(DATA, "enrich");
if (existsSync(enrichDir)) {
  for (const f of readdirSync(enrichDir).filter((n) => n.endsWith(".json") && !n.endsWith(".todo.json"))) {
    for (const e of JSON.parse(readFileSync(join(enrichDir, f), "utf8"))) {
      const row = byKey.get(e.source_key);
      if (!row) { flag("enrich_unknown_key"); continue; }
      if (!e.source_url || !validUrl(e.source_url)) { flag("enrich_no_source"); continue; }
      let touched = false;
      for (const k of ["phone", "whatsapp"]) if (!row[k] && validPhone(e[k])) { row[k] = e[k]; touched = true; }
      for (const k of ["website", "instagram", "facebook"]) if (!row[k] && e[k] && validUrl(e[k])) { row[k] = e[k]; touched = true; }
      if (touched) { row.data_source = "openstreetmap+web"; enriched++; }
    }
  }
}

// ── Web discovery, deduped against everything else ──────────────────────────
const nameArea = (r) => `${norm(r.name)}|${norm(r.area)}`;
const index = new Map();
const phoneIndex = new Map();
for (const r of osm) {
  index.set(nameArea(r), r);
  if (r.phone) phoneIndex.set(r.phone, r);
}
const web = [];
let merged = 0;
const webDir = join(DATA, "web");
if (existsSync(webDir)) {
  for (const f of readdirSync(webDir).filter((n) => n.endsWith(".json"))) {
    for (const raw of JSON.parse(readFileSync(join(webDir, f), "utf8"))) {
      const r = sanitize({ ...raw, data_source: "web" });
      if (!r) continue;
      const hit = index.get(nameArea(r)) ?? (r.phone && norm(phoneIndex.get(r.phone)?.name) === norm(r.name) ? phoneIndex.get(r.phone) : null);
      if (hit) {
        for (const k of ["phone", "whatsapp", "website", "instagram", "facebook", "address"]) if (!hit[k] && r[k]) hit[k] = r[k];
        merged++;
        continue;
      }
      index.set(nameArea(r), r);
      if (r.phone) phoneIndex.set(r.phone, r);
      web.push(r);
    }
  }
}

// ── Existing merchants are never shadowed by a directory row ────────────────
const existingFile = join(DATA, "existing.json");
const existing = existsSync(existingFile) ? JSON.parse(readFileSync(existingFile, "utf8")) : [];
const taken = new Set(existing.map((s) => norm(s.name)));
const all = [...osm, ...web].filter((r) => {
  if (taken.has(norm(r.name))) return flag("matches_existing_merchant"), false;
  return true;
});

// ── Batches, richest first so a partial import is still the best part ──────
const score = (r) => ["phone", "website", "instagram", "facebook", "address", "opening_hours"].filter((k) => r[k]).length;
all.sort((a, b) => score(b) - score(a));
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
let parts = 0;
for (let i = 0; i < all.length; i += BATCH) {
  writeFileSync(join(OUT, `part-${String(++parts).padStart(2, "0")}.json`), JSON.stringify(all.slice(i, i + BATCH)));
}

const count = (k) => all.reduce((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
console.log({ total: all.length, osm: osm.length, web: web.length, enriched, merged, parts });
console.log("by sector", count("sector"));
console.log("by region", count("region"));
console.log("contact", { phone: all.filter((r) => r.phone).length, website: all.filter((r) => r.website).length, social: all.filter((r) => r.instagram || r.facebook).length });
console.log("issues", issues);
