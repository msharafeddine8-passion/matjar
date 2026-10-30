// Writes the import batch: remote logos are swapped for our own copies, or dropped.
//
//   node scripts/directory/tripoli-seed.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(HERE, "data", f), "utf8"));
const rows = read("tripoli-merged.json");
const logos = read("tripoli-logos.map.json");

const out = rows.map(({ brand_logo, ...r }) => {
  const own = (u) => (u?.startsWith("/") ? u : null);
  return { ...r, logo_url: logos[r.source_key] ?? own(r.logo_url) ?? own(brand_logo) };
});
const dir = join(HERE, "../../public/directory-seed");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "tripoli.json"), JSON.stringify(out));
console.log({ rows: out.length, logos: out.filter((r) => r.logo_url).length, social: out.filter((r) => r.instagram || r.facebook).length, phone: out.filter((r) => r.phone).length });
