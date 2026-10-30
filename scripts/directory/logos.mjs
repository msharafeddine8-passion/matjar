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

// Sites show other people's logos: socials, partners, accreditations.
const NOT_THEIRS = /(instagram|facebook|fb[-_.]|whatsapp|twitter|tiktok|youtube|linkedin|snapchat|pinterest|airbnb|booking|tripadvisor|expedia|fairtrade|united.?nations|\bun[-_.]|unesco|unicef|airfrance|air.?france|vice|google|apple.?store|play.?store|visa|mastercard|paypal|emoji|favicon-?(16|32)|placeholder|default)/i;
const CDN = /(wixstatic|squarespace|shopify|cloudfront|wp\.com|cloudinary|imgix|amazonaws|googleusercontent|webflow|sitecdn|zyrosite|hostinger)/i;
const root = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").split(".").slice(-3).join("."); } catch { return ""; } };
function sameOwner(url, website) {
  if (!website) return true;
  const h = new URL(url).hostname;
  if (CDN.test(h)) return true;
  const site = root(website).split(".");
  const name = site.length > 2 && site[site.length - 1].length === 2 ? site[site.length - 3] : site[site.length - 2];
  return h.includes(name);
}

async function one(url, file, website) {
  if (NOT_THEIRS.test(url) || !sameOwner(url, website)) return false;
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
  // On our light card: a white-on-transparent logo vanishes, and a photograph has
  // far more tonal variety than any logo.
  const flat = await sharp(buf, { density: 300, failOn: "none" }).resize(128, 128, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" }).removeAlpha().toBuffer();
  const stats = await sharp(flat).stats();
  const spread = Math.max(...stats.channels.map((c) => c.stdev));
  if (spread < 12 || stats.entropy > 6.6) return false;
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
      let timer;
      const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("deadline")), 25000); });
      try { if (await Promise.race([one(u, file, it.website), deadline])) { saved = true; break; } }
      catch { /* next candidate */ }
      finally { clearTimeout(timer); }
    }
    if (saved) { map[it.source_key] = `/directory-logos/${name}.webp`; ok++; } else fail++;
  }
}
const keepAlive = setInterval(() => {}, 1000);
await Promise.all(Array.from({ length: 8 }, worker));
clearInterval(keepAlive);
writeFileSync(output, JSON.stringify(map, null, 0));
console.log({ ok, fail, total: Object.keys(map).length });
