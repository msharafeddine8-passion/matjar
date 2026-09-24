#!/usr/bin/env node
// ===========================================================================
// Public data quality report — READ ONLY.
// ===========================================================================
//
// Runs the validators in src/lib/data-quality.ts over every PUBLIC row the
// anon key can see (stores, products, craft providers, gigs, job postings,
// market listings) and writes audit/prelaunch-v2/13_DATA_QUALITY.md.
//
// It never writes to the database. It never prints a key. It uses the anon
// key from .env.local, which RLS limits to public rows — exactly the audience
// whose experience this report is about. A service-role key is deliberately
// NOT read even if one is present in the same file.
//
// The validators are TypeScript and this is plain Node: rather than keep a
// second copy of the rules in JavaScript (which is how two rule sets drift),
// the script registers a resolve hook so Node's built-in type stripping can
// load `src/lib/data-quality.ts` and its two pure imports. No bundler, no
// dependency, one source of truth.
//
// Run:  node scripts/data-quality-report.mjs
// ---------------------------------------------------------------------------

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "audit/prelaunch-v2/13_DATA_QUALITY.md");

// ---- env: read two names, print neither -----------------------------------
function readEnv() {
  const text = readFileSync(resolve(ROOT, ".env.local"), "utf8");
  const vars = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    vars[k] = v;
  }
  const url = vars.NEXT_PUBLIC_SUPABASE_URL;
  const anon = vars.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env.local");
    process.exit(1);
  }
  return { url, anon };
}

// ---- load the TypeScript validators through Node's type stripping ----------
register(pathToFileURL(resolve(ROOT, "scripts/_ts-resolve-hook.mjs")));
const dq = await import(pathToFileURL(resolve(ROOT, "src/lib/data-quality.ts")).href);
const { categoryKeys } = await import(pathToFileURL(resolve(ROOT, "src/lib/catalog.ts")).href);
const KNOWN = new Set(categoryKeys);
const sectorOf = (slug) => (slug && KNOWN.has(slug) ? slug : "retail");

// ---- PostgREST, anon, GET only ---------------------------------------------
const { url, anon } = readEnv();
async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path.split("?")[0]} → HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** A table the anon role cannot read is reported, not fatal. */
async function tryGet(path) {
  try {
    return { rows: await get(path), error: null };
  } catch (e) {
    return { rows: [], error: String(e.message ?? e) };
  }
}

const LIMIT = 2000;

const stores = await tryGet(
  `stores?select=id,name,area,service_area,region,phone,whatsapp,description,logo_url,cover_url,status,business_types(slug,name_en)&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=${LIMIT}`,
);
const products = await tryGet(
  `products?select=id,store_id,name,price,discount_price,image_url,item_kind,status,is_available&status=eq.active&deleted_at=is.null&order=created_at.desc&limit=${LIMIT}`,
);
const crafts = await tryGet(
  `craft_providers?select=id,name,headline,bio,phone,whatsapp,region,area_id,status&status=eq.active&limit=${LIMIT}`,
);
const gigs = await tryGet(
  `gigs?select=id,title,description,price,image_url,region,status&status=eq.active&limit=${LIMIT}`,
);
const jobs = await tryGet(
  `job_postings?select=id,title,company_name,description,how_to_apply,apply_email,region,status&status=eq.active&limit=${LIMIT}`,
);
const listings = await tryGet(
  `listings?select=id,title,description,price,images,city,region,status&status=eq.active&limit=${LIMIT}`,
);

// ---- validate ---------------------------------------------------------------
const storeSector = new Map();
const storeName = new Map();
const productsByStore = new Map();
for (const p of products.rows) {
  productsByStore.set(p.store_id, (productsByStore.get(p.store_id) ?? 0) + 1);
}

const storeRows = stores.rows.map((s) => {
  const sector = sectorOf(s.business_types?.slug);
  storeSector.set(s.id, sector);
  storeName.set(s.id, s.name);
  const r = dq.validateStorePublic(
    {
      name: s.name,
      category: s.business_types?.slug ?? null,
      area: s.area,
      service_area: s.service_area,
      region: s.region,
      phone: s.phone,
      whatsapp: s.whatsapp,
      description: s.description,
      logo_url: s.logo_url,
      cover_url: s.cover_url,
      // A hotel's offerings are rooms, an organiser's are ticket types, a car
      // business's are vehicles — none of them in `products`. Left unknown for
      // those sectors so the rule is skipped rather than falsely flagged.
      offerings: dq.PRIMARY_ENTITY_SECTORS.has(sector)
        ? undefined
        : (productsByStore.get(s.id) ?? 0),
    },
    { sector },
  );
  return { name: s.name, sector, level: r.level, issues: r.issues.map((i) => i.code) };
});

const productRows = products.rows.map((p) => {
  const sector = storeSector.get(p.store_id) ?? "retail";
  const r = dq.validateProductPublic(
    { name: p.name, price: p.price, discount_price: p.discount_price, image_url: p.image_url, item_kind: p.item_kind },
    { sector },
  );
  return {
    name: p.name,
    sector,
    store: storeName.get(p.store_id) ?? "(store not public)",
    hasImage: !!(p.image_url ?? "").trim(),
    level: r.level,
    issues: r.issues.map((i) => i.code),
  };
});

const craftRows = crafts.rows.map((c) => {
  const r = dq.validateEntryPublic("craft", {
    title: c.name,
    description: c.bio ?? c.headline,
    contacts: [c.phone, c.whatsapp],
    region: c.region,
    area: c.area_id,
  });
  return { name: c.name, sector: "crafts", level: r.level, issues: r.issues.map((i) => i.code) };
});

const gigRows = gigs.rows.map((g) => {
  const r = dq.validateEntryPublic("gig", {
    title: g.title,
    description: g.description,
    image: g.image_url,
    price: g.price,
    region: g.region,
  });
  return { name: g.title, sector: "freelance", level: r.level, issues: r.issues.map((i) => i.code) };
});

const jobRows = jobs.rows.map((j) => {
  const r = dq.validateEntryPublic("job", {
    title: j.title,
    description: j.description,
    contacts: [j.how_to_apply, j.apply_email],
    region: j.region,
  });
  return { name: `${j.title} — ${j.company_name ?? ""}`, sector: "jobs", level: r.level, issues: r.issues.map((i) => i.code) };
});

const listingRows = listings.rows.map((l) => {
  const imgs = Array.isArray(l.images) ? l.images : [];
  const r = dq.validateEntryPublic("listing", {
    title: l.title,
    description: l.description,
    image: imgs[0] ?? null,
    price: l.price,
    region: l.region,
    area: l.city,
  });
  return { name: l.title, sector: "market", level: r.level, issues: r.issues.map((i) => i.code) };
});

// ---- render -----------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const counts = (rows) => {
  const c = { ok: 0, incomplete: 0, blocked: 0 };
  for (const r of rows) c[r.level]++;
  return c;
};
const countLine = (label, rows) => {
  const c = counts(rows);
  return `| ${label} | ${rows.length} | ${c.ok} | ${c.incomplete} | ${c.blocked} |`;
};
const table = (rows, extra = []) => {
  if (!rows.length) return "_No public rows._\n";
  const head = ["Name", "Sector", "Level", ...extra.map((e) => e.label), "Issues"];
  const lines = [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (r) =>
        `| ${esc(r.name)} | ${r.sector} | ${r.level} | ${extra.map((e) => esc(e.get(r))).join(" | ")}${extra.length ? " | " : ""}${r.issues.join(", ") || "—"} |`,
    ),
  ];
  return lines.join("\n") + "\n";
};
const errNote = (res, table) =>
  res.error ? `\n> Could not read \`${table}\` with the anon key: ${esc(res.error)}\n` : "";

const all = [...storeRows, ...productRows, ...craftRows, ...gigRows, ...jobRows, ...listingRows];
const flagged = all.filter((r) => r.level !== "ok");
const byIssue = new Map();
for (const r of flagged) for (const code of r.issues) byIssue.set(code, (byIssue.get(code) ?? 0) + 1);

const imgCovered = productRows.filter((p) => p.hasImage).length;

const md = `# 13 — Public data quality gate

Generated ${new Date().toISOString()} by \`scripts/data-quality-report.mjs\` — **read only**, anon key, public rows.
Nothing was updated or deleted. Every flagged record below is for the owner to review by hand.

## Rules

Validators: \`src/lib/data-quality.ts\`. Level = worst severity: any **block** → \`blocked\`; any **flag** → \`incomplete\`; none → \`ok\`.
\`blocked\` = not ranked in explore / search / home rails (still reachable by URL). \`incomplete\` = listed, flagged to merchant and admin.

| Rule | Applies to | Severity | Code |
| --- | --- | --- | --- |
| Name present after trim | all | block | name_missing |
| Name is not a placeholder (test/tst/demo/asd/qwe/xxx/lorem/تجربة/اختبار…) | all | block | name_placeholder |
| Name is not only digits | all | block | name_digits_only |
| Name has no leading/trailing whitespace | all | flag | name_untrimmed |
| Name has no leading/trailing punctuation (- _ . , ; : quotes, brackets) | all | flag | name_edge_punctuation |
| Name is not garbled (mojibake, U+FFFD, 5+ vowel-less Latin letters, 4× repeated letter) | all | flag | name_garbled |
| Business type present | stores | flag | category_missing |
| Location: \`area\` for shops; \`area\` or \`service_area\` for services/contractors/professional; skipped when the location module is off | stores | flag | location_missing |
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
| item_kind fits the sector (no \`service\` in goods sectors, no \`product\` in booking sectors) | products | flag | kind_mismatch |
| Region or area present | crafts, jobs, listings | flag | location_missing |

## Counts per level

| Entity | Rows | ok | incomplete | blocked |
| --- | --- | --- | --- | --- |
${countLine("Stores (active)", storeRows)}
${countLine("Products (active, of any store)", productRows)}
${countLine("Craft providers (active)", craftRows)}
${countLine("Gigs (active)", gigRows)}
${countLine("Job postings (active)", jobRows)}
${countLine("Market listings (active)", listingRows)}

Product image coverage: **${imgCovered} / ${productRows.length}** products carry an image.

## Stores
${errNote(stores, "stores")}
${table(storeRows)}
## Products
${errNote(products, "products")}
${table(productRows, [
  { label: "Store", get: (r) => r.store },
  { label: "Image", get: (r) => (r.hasImage ? "yes" : "no") },
])}
## Craft providers
${errNote(crafts, "craft_providers")}
${table(craftRows)}
## Gigs
${errNote(gigs, "gigs")}
${table(gigRows)}
## Job postings
${errNote(jobs, "job_postings")}
${table(jobRows)}
## Market listings
${errNote(listings, "listings")}
${table(listingRows)}
## Flagged for owner review

${flagged.length} of ${all.length} public records carry at least one issue. No record was changed. Issue frequency:

| Issue | Records |
| --- | --- |
${[...byIssue.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([code, n]) => `| ${code} | ${n} |`)
  .join("\n")}

| Name | Kind | Level | Issues |
| --- | --- | --- | --- |
${flagged.map((r) => `| ${esc(r.name)} | ${r.sector} | ${r.level} | ${r.issues.join(", ")} |`).join("\n")}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md, "utf8");

const c = counts(all);
console.log(
  `wrote ${OUT}\nstores ${storeRows.length}, products ${productRows.length}, crafts ${craftRows.length}, gigs ${gigRows.length}, jobs ${jobRows.length}, listings ${listingRows.length}\nok ${c.ok} · incomplete ${c.incomplete} · blocked ${c.blocked}`,
);
for (const [name, res] of Object.entries({ stores, products, crafts, gigs, jobs, listings })) {
  if (res.error) console.log(`note: ${name} unreadable with anon key — ${res.error}`);
}
