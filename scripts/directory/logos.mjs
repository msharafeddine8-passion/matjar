// Downloads official logos and stores them small and uniform on our own domain
// (the CSP only allows our own images, and a hotlinked logo breaks when their site
// changes). Tries each candidate URL; rejects anything too small to look right.
//
//   node scripts/directory/logos.mjs <in.json> <map-out.json>
//
// in: [{ source_key, logos: ["https://..."] }]  ->  { source_key: "/directory-logos/x.webp" }

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const [, , input, output] = process.argv;
const DIR = "public/directory-logos";
mkdirSync(DIR, { recursive: true });
const items = JSON.parse(readFileSync(input, "utf8"));
const map = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : {};
const UA = "Mozilla/5.0 (compatible; MatjarDirectory/1.0; +https://matjarlb.com)";
const MIN = 64;

async function one(url, file) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return false;
  const type = res.headers.get("content-type") ?? "";
  if (!/image|svg|octet/i.test(type)) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200 || buf.length > 8_000_000) return false;
  const img = sharp(buf, { density: 300, failOn: "none" });
  const meta = await img.metadata();
  if (meta.format !== "svg" && (meta.width < MIN || meta.height < MIN)) return false;
  // Banners and page photos aren't logos.
  const ratio = (meta.width ?? 1) / (meta.height ?? 1);
  if (ratio > 6 || ratio < 0.3) return false;
  await img.resize(256, 256, { fit: "inside", withoutEnlargement: false }).webp({ quality: 82 }).toFile(file);
  return true;
}

const queue = items.filter((i) => !map[i.source_key] && i.logos?.length);
let ok = 0, fail = 0;
async function worker() {
  for (let it; (it = queue.shift()); ) {
    const name = createHash("sha1").update(it.source_key).digest("hex").slice(0, 16);
    const file = `${DIR}/${name}.webp`;
    let saved = false;
    for (const u of it.logos) {
      try { if (await one(u, file)) { saved = true; break; } } catch { /* next candidate */ }
    }
    if (saved) { map[it.source_key] = `/directory-logos/${name}.webp`; ok++; } else fail++;
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
writeFileSync(output, JSON.stringify(map, null, 0));
console.log({ ok, fail, total: Object.keys(map).length });
