// Phase 4 (professional marketplace) before/after screenshots at 390px.
//   node audit/prelaunch-v2/_work/shots-phase4.mjs before|after
// Writes PNGs (gitignored) + a status/robots table to audit/prelaunch-v2/shots/phase4/.
import fs from "fs";
import { chromium } from "@playwright/test";

const phase = process.argv[2];
if (!["before", "after"].includes(phase)) process.exit(2);
const SITE = process.env.SITE || "http://127.0.0.1:3282";
const OUT = "audit/prelaunch-v2/shots/phase4";
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["crafts", "/ar/crafts"],
  ["crafts-electrician", "/ar/crafts/electrician"],
  ["crafts-electrician-area", "/ar/crafts/electrician?area=tripoli"],
  ["crafts-requests", "/ar/crafts/requests?problem=" + encodeURIComponent("البراد ما عم يبرد بالميناء")],
  ["freelance", "/ar/freelance"],
  ["freelance-services", "/ar/freelance?view=services"],
  ["freelance-pro", "/ar/freelance/pro/8b6f9cdc-3100-4f4b-a2df-3cb3e7c1e80a"],
  ["jobs", "/ar/jobs"],
  ["jobs-filtered-empty", "/ar/jobs?type=internship"],
  ["freelance-gig", "/ar/freelance/138fb16e-1282-4491-a547-9ed486b4acc4"],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar" });
const rows = [];
for (const [name, path] of PAGES) {
  const page = await ctx.newPage();
  let status = 0;
  try {
    const res = await page.goto(SITE + path, { waitUntil: "load", timeout: 180000 });
    status = res?.status() ?? 0;
    await page.waitForTimeout(1500);
    const robots = await page
      .locator('meta[name="robots"]')
      .first()
      .getAttribute("content")
      .catch(() => null);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    await page.screenshot({ path: `${OUT}/${phase}-${name}.png`, fullPage: true });
    rows.push(`| ${name} | ${path.slice(0, 60)} | ${status} | ${robots ?? "(none)"} | ${overflow} |`);
  } catch (e) {
    rows.push(`| ${name} | ${path.slice(0, 60)} | ERR ${String(e).slice(0, 60)} | | |`);
  }
  await page.close();
}
await browser.close();
const table = ["| page | path | status | robots | x-overflow px |", "|---|---|---|---|---|", ...rows].join("\n");
fs.writeFileSync(`${OUT}/${phase}-status.md`, table + "\n");
console.log(table);
