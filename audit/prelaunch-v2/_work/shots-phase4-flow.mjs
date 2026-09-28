// Phase 4 interaction shots: «شو خربان؟» understanding, and the request flow's
// honest no-match step. node audit/prelaunch-v2/_work/shots-phase4-flow.mjs
import { chromium } from "@playwright/test";
const SITE = process.env.SITE || "http://127.0.0.1:3282";
const OUT = "audit/prelaunch-v2/shots/phase4";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar" });
const page = await ctx.newPage();
await page.goto(`${SITE}/ar/crafts`, { waitUntil: "load", timeout: 180000 });
await page.waitForTimeout(4000); // hydration (dev compile)
const ask = page.locator("form:has(#craft-problem)");
await page.locator("#craft-problem").pressSequentially("بدي سنكري بطرابلس", { delay: 30 });
await page.waitForTimeout(1200);
const area = await ask.locator("select").inputValue();
const chips = await ask.locator("button[type=button], span.rounded-xl").allInnerTexts();
console.log("ask: area=", area, "chips=", chips);
await page.screenshot({ path: `${OUT}/after-flow-1-ask.png` });
await ask.locator("button[type=submit]").click();
await page.waitForURL(/crafts\/requests/, { timeout: 120000 });
console.log("url:", decodeURIComponent(page.url()));
await page.waitForTimeout(1500);
console.log("trade select:", await page.inputValue("#flow-trade"), "area:", await page.inputValue("#flow-area"));
await page.screenshot({ path: `${OUT}/after-flow-2-problem.png`, fullPage: false });
await page.locator("form:has(#flow-what) button[type=submit]").click();
await page.waitForTimeout(3000);
const txt = await page.locator("main").innerText().catch(() => "");
console.log("step2 has demand prompt:", txt.includes("اترك طلبك"), "| wa:", txt.includes("واتساب"));
await page.screenshot({ path: `${OUT}/after-flow-3-nomatch.png`, fullPage: true });
// the inferred path without a trade in the URL
await page.goto(`${SITE}/ar/crafts/requests?problem=${encodeURIComponent("البراد ما عم يبرد بالميناء")}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
console.log("inferred trade:", await page.inputValue("#flow-trade"), "area:", await page.inputValue("#flow-area"));
await browser.close();
