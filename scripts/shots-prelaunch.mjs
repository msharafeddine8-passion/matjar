// BEFORE/AFTER screenshots for the prelaunch-foundation program (§43).
//
//   node scripts/shots-prelaunch.mjs before
//   node scripts/shots-prelaunch.mjs after
//
// Runs against a locally built production server (SITE overrides it), Arabic
// RTL, at the six widths the brief names. Writes into
// audit/prelaunch-v2/shots/<phase>/ and a status table next to it, so a route
// that answered 404 or 500 is recorded rather than screenshotted as if fine.
//
// Like shots-professional.mjs it waits for streamed sections to resolve, not
// for the network to go quiet: a skeleton screenshots exactly as cleanly as
// real content.
import fs from "fs";
import { chromium } from "@playwright/test";

const phase = process.argv[2];
if (!["before", "after"].includes(phase)) {
  console.error("usage: node scripts/shots-prelaunch.mjs <before|after>");
  process.exit(2);
}
const SITE = process.env.SITE || "http://127.0.0.1:3000";
const OUT = `audit/prelaunch-v2/shots/${phase}`;

const VIEWPORTS = [
  { w: 360, h: 800 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
  { w: 768, h: 1024 },
  { w: 1024, h: 768 },
  { w: 1440, h: 900 },
];

// Real records on the production database (read-only). Names in comments so a
// dead id is recognisable when the status table says 404.
const IDS = {
  retailStore: "5b174b32-b511-4e8e-8c78-4bd60fc5c76c", // sleepy care (3 products)
  restaurant: "42b8b8a3-81c6-44d4-b568-c48b770c2810", // Let's meat
  clinic: "745d24ea-679e-4906-a488-26c37eba357d", // دكتور عمر الصمد (3 services)
  service: "905d55ef-3533-41db-91e4-1d4622b6f29a", // أشعة (item_kind=service)
  product: "4ec4a683-ce30-44a8-9bfc-7114d5d497a3", // طقم كنب (image)
  freelancer: "8b6f9cdc-3100-4f4b-a2df-3cb3e7c1e80a", // باشن
};

export const PAGES = [
  { name: "01-home", path: "/ar" },
  { name: "02-explore", path: "/ar/explore" },
  { name: "03-search", path: "/ar/search?q=%D8%AF%D9%83%D8%AA%D9%88%D8%B1" },
  { name: "04-category", path: "/ar/category/food" },
  { name: "05-retail-store", path: `/ar/store/${IDS.retailStore}` },
  { name: "06-restaurant", path: `/ar/store/${IDS.restaurant}` },
  { name: "07-clinic", path: `/ar/store/${IDS.clinic}` },
  { name: "08-appointment-service", path: `/ar/product/${IDS.service}` },
  { name: "09-physical-product", path: `/ar/product/${IDS.product}` },
  { name: "10-crafts-landing", path: "/ar/crafts" },
  { name: "11-crafts-result", path: "/ar/crafts/electrician" },
  { name: "12-freelance-landing", path: "/ar/freelance" },
  { name: "13-freelancer-profile", path: `/ar/freelance/pro/${IDS.freelancer}` },
  { name: "14-jobs", path: "/ar/jobs" },
  { name: "15-market", path: "/ar/market" },
  { name: "16-pricing", path: "/ar/pricing" },
  { name: "17-merchants", path: "/ar/merchants" },
];

const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const rows = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.w < 768 ? 2 : 1,
    locale: "ar",
    isMobile: vp.w < 768,
    hasTouch: vp.w < 768,
  });
  for (const p of PAGES) {
    if (only && !only.some((o) => p.name.startsWith(o))) continue;
    const page = await ctx.newPage();
    let status = 0;
    try {
      const res = await page.goto(SITE + p.path, { waitUntil: "load", timeout: 60_000 });
      status = res?.status() ?? 0;
      // Streamed sections: wait until no skeleton is left, up to 8s.
      await page
        .waitForFunction(
          () => document.querySelectorAll("[data-skeleton], .animate-pulse").length === 0,
          null,
          { timeout: 8_000 },
        )
        .catch(() => {});
      await page.waitForTimeout(400);
      const file = `${OUT}/${p.name}@${vp.w}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      rows.push({ name: p.name, w: vp.w, status, height: h, hOverflow: overflow });
    } catch (e) {
      rows.push({ name: p.name, w: vp.w, status, height: 0, hOverflow: false, error: String(e).slice(0, 80) });
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();

const table = [
  "| route | width | status | page height | horizontal overflow |",
  "|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.name} | ${r.w} | ${r.status} | ${r.height} | ${r.hOverflow ? "YES" : "no"}${r.error ? " · " + r.error : ""} |`,
  ),
].join("\n");
fs.writeFileSync(`${OUT}/STATUS.md`, `# ${phase} — ${new Date().toISOString()}\n\n${table}\n`);
console.log(table);
