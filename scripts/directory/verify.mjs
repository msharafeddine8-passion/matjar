// Visits each business's own website: is it alive, which social accounts does it
// link to, and what is its official logo? The website is the authority for all
// three, so nothing here is guessed.
//
//   node scripts/directory/verify.mjs <rows.json> <out.json>
//
// rows: [{ source_key, website }]. HTML is treated as data and only pattern-matched.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [, , input, output] = process.argv;
const rows = JSON.parse(readFileSync(input, "utf8")).filter((r) => r.website);
const out = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : {};
const UA = "Mozilla/5.0 (compatible; MatjarDirectory/1.0; +https://matjarlb.com)";
// Parked and for-sale pages answer 200 and look alive.
// Hacked sites serving gambling spam answer 200 too; never link a visitor to one.
const PARKED = /(domain (is )?for sale|buy this domain|parked free|sedoparking|hugedomains|godaddy\.com\/forsale|this domain may be for sale|account suspended|site not found|togel|slot gacor|situs slot|judi online|agen slot|bandar (bola|togel)|casino online)/i;

const SOCIAL_SKIP = /\/(sharer|share|plugins|dialog|tr\?|intent|login|policies|help|privacy|about|explore|p\/|reel\/|stories\/)/i;
function socialFrom(html, host) {
  const re = new RegExp(`https?://(?:www\\.|m\\.|[a-z-]+\\.)?${host}\\.com/[A-Za-z0-9_.%/-]+`, "gi");
  for (const m of html.matchAll(re)) {
    const u = m[0].replace(/\/+$/, "").replace(/^http:/, "https:");
    const path = new URL(u).pathname;
    if (path === "" || path === "/" || SOCIAL_SKIP.test(path + "/")) continue;
    if (/\.(js|css|png|jpg|svg|php)$/i.test(path)) continue;
    return u;
  }
  return null;
}

function logoFrom(html, base) {
  const abs = (u) => { try { return new URL(u.replace(/&amp;/g, "&"), base).href; } catch { return null; } };
  const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const cands = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, "src") ?? attr(tag, "data-src");
    if (!src) continue;
    const blob = `${src} ${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""}`;
    if (/logo/i.test(blob) && !/(partner|client|sponsor|payment|visa|mastercard|footer)/i.test(blob)) cands.push({ u: src, p: 3 });
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = attr(tag, "rel") ?? "";
    const href = attr(tag, "href");
    if (!href) continue;
    if (/apple-touch-icon/i.test(rel)) cands.push({ u: href, p: 2 });
    else if (/\bicon\b/i.test(rel) && /(192|180|152|144|128|96|512)/.test(attr(tag, "sizes") ?? href)) cands.push({ u: href, p: 1 });
  }
  const seen = new Set();
  return cands.sort((a, b) => b.p - a.p).map((c) => abs(c.u)).filter((u) => u && !seen.has(u) && seen.add(u)).slice(0, 4);
}

async function visit(r) {
  const res = await fetch(r.website, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { alive: false, status: res.status };
  const type = res.headers.get("content-type") ?? "";
  if (!/html/i.test(type)) return { alive: false, status: "not_html" };
  const html = (await res.text()).slice(0, 1_500_000);
  if (html.length < 300 || PARKED.test(html)) return { alive: false, status: "parked" };
  return {
    alive: true,
    final: res.url,
    instagram: socialFrom(html, "instagram"),
    facebook: socialFrom(html, "facebook"),
    logos: logoFrom(html, res.url),
  };
}

let done = 0;
const queue = rows.filter((r) => !out[r.source_key]);
async function worker() {
  for (let r; (r = queue.shift()); ) {
    // A stalled body read can leave nothing keeping Node alive, and it would exit
    // mid-run without a word: a hard deadline per site, on a real timer.
    let timer;
    const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("deadline")), 25000); });
    try { out[r.source_key] = await Promise.race([visit(r), deadline]); }
    catch (err) { out[r.source_key] = { alive: false, status: err.name === "Error" ? err.message : err.name }; }
    finally { clearTimeout(timer); }
    if (++done % 25 === 0) { writeFileSync(output, JSON.stringify(out)); console.log(done); }
  }
}
const keepAlive = setInterval(() => {}, 1000);
await Promise.all(Array.from({ length: 10 }, worker));
clearInterval(keepAlive);
writeFileSync(output, JSON.stringify(out));
const v = Object.values(out);
console.log({ visited: v.length, alive: v.filter((x) => x.alive).length, instagram: v.filter((x) => x.instagram).length,
  facebook: v.filter((x) => x.facebook).length, logo: v.filter((x) => x.logos?.length).length });
