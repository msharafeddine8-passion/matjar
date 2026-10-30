// Merges the researched Tripoli rows with what the directory already lists.
//
//   node --env-file=.env.local scripts/directory/tripoli.mjs
//
// A researched row that matches a live row by name, Instagram or website domain
// updates that row (fresher fields win, missing ones keep the old value) instead of
// creating a second page for the same business.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data");
const FILES = ["tripoli_food", "tripoli_retail", "tripoli_services"];

// Not in Tripoli proper, or already better covered by the curated row.
const DROP = /(lyc[eé]e franco)/i;
const IN_TRIPOLI = /(طرابلس|tripoli|الميناء|mina|القبة|البداوي|beddawi)/i;
// Found dead, parked or taken over while researching.
const DEAD_SITE = /(roubamoukadem\.com|minime\.com\.lb|minjara\.com)/i;
const GENERIC =/\b(tripoli|mina|el|al|the|hotel|restaurant|sweets|lebanon|leb|university|hospital)\b|طرابلس|الميناء/gi;
const SHARED = /(facebook|instagram|wixsite|wordpress|blogspot|linktr|google|sites\.|booking|tripadvisor|bam\.agendaculturel)/i;
const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(GENERIC, " ")
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}]/gu, "");
const ig = (u) => (u ? u.toLowerCase().split("?")[0].replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "") : null);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const COLS = "id,name,region,area,phone,whatsapp,website,instagram,facebook,logo_url,description,specialties,lat,lng,data_source,source_url,owner_id,business_types(slug)";
const live = [];
for (let from = 0; ; from += 1000) {
  const res = await fetch(`${base}/rest/v1/stores?select=${COLS}&deleted_at=is.null&order=id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const page = await res.json();
  live.push(...page);
  if (page.length < 1000) break;
}

const index = new Map();
for (const s of live) {
  for (const k of [`n:${norm(s.name)}`, s.instagram && `i:${ig(s.instagram)}`, s.website && !SHARED.test(host(s.website) ?? "") && `d:${host(s.website)}`]) {
    if (k && k !== "n:") index.set(k, s);
  }
}

const seen = new Set();
const added = [], updated = [], skipped = [];
for (const f of FILES) {
  for (const r of JSON.parse(readFileSync(join(DATA, "curated", `${f}.json`), "utf8"))) {
    if (DROP.test(r.name)) { skipped.push(`${r.name}: dropped`); continue; }
    if (!r.phone || !/^\+961 \d{7,8}$/.test(r.phone)) r.phone = null;
    if (!r.whatsapp || !/^\+961 \d{7,8}$/.test(r.whatsapp)) r.whatsapp = null;
    const keys = [`n:${norm(r.name)}`, r.instagram && `i:${ig(r.instagram)}`, r.website && !SHARED.test(host(r.website) ?? "") && `d:${host(r.website)}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) { skipped.push(`${r.name}: duplicate in research`); continue; }
    keys.forEach((k) => seen.add(k));
    const hit = keys.map((k) => index.get(k)).find(Boolean);
    if (hit?.owner_id) { skipped.push(`${r.name}: a real merchant owns ${hit.name}`); continue; }
    // Same brand listed for another town: Tripoli gets its own branch page.
    if (hit && !IN_TRIPOLI.test(hit.area ?? "")) { added.push({ ...r, data_source: "web", brand_logo: hit.logo_url }); continue; }
    if (hit) {
      if (DEAD_SITE.test(hit.website ?? "")) hit.website = null;
      updated.push({
        ...r,
        name: hit.name, id: hit.id, source_key: `existing:${hit.id}`, sector: hit.business_types?.slug ?? r.sector,
        area: hit.area ?? r.area, phone: r.phone ?? hit.phone, whatsapp: r.whatsapp ?? hit.whatsapp,
        website: r.website ?? hit.website, instagram: hit.instagram ?? r.instagram, facebook: hit.facebook ?? r.facebook,
        logo_url: hit.logo_url ?? r.logo_url, description: r.description ?? hit.description, specialties: r.specialties ?? hit.specialties,
        lat: hit.lat, lng: hit.lng, data_source: hit.data_source ?? "web", source_url: hit.source_url ?? r.source_url,
      });
    } else {
      added.push({ ...r, data_source: "web" });
    }
  }
}

// Listed, but its website now serves spam. The research skipped it, so clear it here.
const minjara = live.find((s) => s.name === "Minjara");
if (minjara) updated.push({ ...minjara, website: null, source_key: `existing:${minjara.id}`, sector: minjara.business_types?.slug, owner_id: undefined, business_types: undefined });

writeFileSync(join(DATA, "tripoli-merged.json"), JSON.stringify([...added, ...updated]));
writeFileSync(join(DATA, "tripoli-logos.todo.json"), JSON.stringify([...added, ...updated]
  .filter((r) => r.logo_url && !r.logo_url.startsWith("/"))
  .map((r) => ({ source_key: r.source_key, logos: [r.logo_url], website: r.website }))));
console.log({ live: live.length, added: added.length, updated: updated.length, skipped });
console.log("ADDED", added.map((r) => `${r.name} [${r.sector}]`).join(" | "));
console.log("UPDATED", updated.map((r) => r.name).join(" | "));
