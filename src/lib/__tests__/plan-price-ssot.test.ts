import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_ORDER, PLAN_TIERS, planProductLimit } from "@/lib/plan-tiers";
import { TRIAL_DAYS } from "@/lib/plan";
import { fillPlanCopy, planCopyVars } from "@/lib/plan-copy";

// Plan prices, the trial length, product caps, staff seats and promo savings
// live in exactly one place: src/lib/plan-tiers.ts (+ TRIAL_DAYS in plan.ts).
// Every surface that shows one of them reads it from there, and copy carries a
// placeholder that lib/plan-copy fills at render time. This test walks src/**
// and both dictionaries and fails if a plan number is typed back in anywhere a
// plan is being talked about — so the /help FAQ can never again quote a $12 Pro
// plan that PLAN_TIERS stopped selling.
//
// It is deliberately context-restricted: "$10 delivery fee" in a product string
// is not a plan price. A line (or dictionary string) is only inspected when it
// is in a pricing context — a plan/subscription word on the same line, or a key
// under one of the namespaces that describe plans.

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// Files that legitimately hold the numbers.
const SOURCE_OF_TRUTH = new Set([
  "src/lib/plan-tiers.ts",
  "src/lib/plan.ts",
]);

const planPrices = new Set<number>();
for (const key of PLAN_ORDER) {
  const t = PLAN_TIERS[key];
  planPrices.add(t.monthly);
  planPrices.add(t.annualPromo);
  planPrices.add(t.annualStandard);
}
const productCaps = new Set<number>([
  planProductLimit("free"),
  ...PLAN_ORDER.map((k) => PLAN_TIERS[k].products).filter(
    (n): n is number => n !== null,
  ),
]);
const staffSeats = new Set(PLAN_ORDER.map((k) => PLAN_TIERS[k].staff));
const savings = new Set(PLAN_ORDER.map((k) => PLAN_TIERS[k].savingsPct));

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabic = (n: number) =>
  String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
const altBoth = (nums: Set<number>) =>
  [...nums].flatMap((n) => [String(n), toArabic(n)]).join("|");

// A plan is being talked about on this line/string.
const PLAN_CONTEXT =
  /plan|pricing|subscri|annual|yearly|monthly|promo|tier|trial|basic|\bpro\b|business|اشتراك|باقة|خطة|خطّة|الخطط|سنوي|شهري|تجربة|أساسي|احتراف|أعمال|العرض/i;

// The patterns that mean "a plan fact was typed in".
const CHECKS: { name: string; re: RegExp }[] = [
  {
    name: "plan price with a dollar sign",
    re: new RegExp(
      `(?:\\$\\s?(?:${altBoth(planPrices)})(?![\\d٠-٩.,]))|(?:(?<![\\d٠-٩.,])(?:${altBoth(planPrices)})\\s?\\$)`,
    ),
  },
  {
    name: "trial length in days",
    re: new RegExp(
      `(?<![\\d٠-٩])(?:${TRIAL_DAYS}|${toArabic(TRIAL_DAYS)})[-\\s]?(?:day|days|يوم|أيام)`,
      "i",
    ),
  },
  {
    name: "product cap",
    re: new RegExp(
      `(?<![\\d٠-٩])(?:${altBoth(productCaps)})\\s?(?:products?|منتج|منتجات)`,
      "i",
    ),
  },
  {
    name: "staff seats",
    re: new RegExp(
      `(?<![\\d٠-٩])(?:${altBoth(staffSeats)})\\s?(?:staff|seats?|team members?|موظف|مقاعد|مقعد|حسابات)`,
      "i",
    ),
  },
  {
    name: "promo savings percentage",
    re: new RegExp(`(?<![\\d٠-٩])(?:${altBoth(savings)})\\s?[%٪]`),
  },
];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// Strip comments so a historical note ("used to show $15") is not a finding:
// block comments (including JSX {/* */}) and full-line or trailing // comments.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^(\s*)\/\/.*$/gm, "$1")
    .replace(/(^|[^:"'`])\/\/(?![^"'`\n]*["'`]).*$/gm, "$1");
}

describe("plan prices have a single source of truth", () => {
  it("the numbers this test guards are the ones plan-tiers holds", () => {
    // Sanity: if the tiers change, the guard follows them automatically.
    expect(planPrices.size).toBeGreaterThan(0);
    expect(productCaps.has(planProductLimit("free"))).toBe(true);
    expect(TRIAL_DAYS).toBeGreaterThan(0);
  });

  it("no component or page types a plan price, trial length, cap, seat count or savings figure", () => {
    const findings: string[] = [];
    for (const file of walk(SRC, [])) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (SOURCE_OF_TRUTH.has(rel)) continue;
      const lines = stripComments(readFileSync(file, "utf8")).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!PLAN_CONTEXT.test(line)) return;
        for (const check of CHECKS) {
          if (check.re.test(line))
            findings.push(`${rel}:${i + 1} [${check.name}] ${line.trim()}`);
        }
      });
    }
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("no code reads plan prices from the plans table", () => {
    // public.plans still holds a $12 "pro" row that disagrees with PLAN_TIERS
    // (docs/plans-alignment-PENDING.sql). Until the owner reconciles it, no UI
    // may price anything from it.
    const findings: string[] = [];
    for (const file of walk(SRC, [])) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const src = stripComments(readFileSync(file, "utf8"));
      if (/from\(\s*["']plans["']\s*\)|price_monthly|price_yearly/.test(src))
        findings.push(rel);
    }
    expect(findings, findings.join("\n")).toEqual([]);
  });

  // Dictionary namespaces whose strings describe plans. Every string under them
  // is inspected; elsewhere a string is inspected only when it is in plan
  // context (so "$10 delivery fee" and "last 14 days" charts are not findings).
  const PLAN_NAMESPACES =
    /^(pricing|faq|merchantsPage|merchant\.subscription|os\.pro|subscription|help|proGate)(\.|$)/;

  function walkDict(
    node: unknown,
    path: string,
    visit: (path: string, value: string) => void,
  ) {
    if (typeof node === "string") return visit(path, node);
    if (Array.isArray(node))
      return node.forEach((v, i) => walkDict(v, `${path}.${i}`, visit));
    if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node as Record<string, unknown>))
        walkDict(v, path ? `${path}.${k}` : k, visit);
  }

  const dictionaries = (["ar", "en"] as const).map((locale) => ({
    locale,
    data: JSON.parse(
      readFileSync(join(SRC, "i18n/dictionaries", `${locale}.json`), "utf8"),
    ) as Record<string, unknown>,
  }));

  it("no dictionary string types a plan fact", () => {
    const findings: string[] = [];
    for (const { locale, data } of dictionaries) {
      walkDict(data, "", (path, value) => {
        const inPlanNamespace = PLAN_NAMESPACES.test(path);
        if (!inPlanNamespace && !PLAN_CONTEXT.test(value)) return;
        for (const check of CHECKS) {
          if (check.re.test(value))
            findings.push(`${locale}.json ${path} [${check.name}] ${value}`);
        }
      });
    }
    expect(findings, findings.join("\n")).toEqual([]);
  });

  it("plan placeholders match between ar and en, and plan-copy knows every one", () => {
    const known = new Set(Object.keys(planCopyVars(new Date())));
    // Page-specific extras a caller passes alongside the standard set.
    known.add("limit");
    const byPath: Record<string, Record<string, string[]>> = {};
    for (const { locale, data } of dictionaries) {
      walkDict(data, "", (path, value) => {
        if (!PLAN_NAMESPACES.test(path)) return;
        const found = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        if (!found.length) return;
        (byPath[path] ??= {})[locale] = found.sort();
      });
    }
    const problems: string[] = [];
    for (const [path, locales] of Object.entries(byPath)) {
      const ar = (locales.ar ?? []).join(",");
      const en = (locales.en ?? []).join(",");
      if (ar !== en) problems.push(`${path}: ar={${ar}} en={${en}}`);
      for (const name of new Set([...(locales.ar ?? []), ...(locales.en ?? [])])) {
        // Placeholders other renderers fill themselves ({n}, {pct}, {days} of
        // the trial banner, {plan}, {date}) are fine; a plan-FACT placeholder
        // must be one plan-copy resolves, or it would print raw.
        if (/^(basic|pro|business|free)/.test(name) && !known.has(name))
          problems.push(`${path}: {${name}} is not filled by plan-copy`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("plan-copy fills the placeholders with the plan-tiers numbers", () => {
    const vars = planCopyVars(new Date("2026-01-01T00:00:00+03:00"));
    expect(vars.days).toBe(TRIAL_DAYS);
    expect(vars.freeProducts).toBe(planProductLimit("free"));
    expect(vars.basicProducts).toBe(PLAN_TIERS.basic.products);
    expect(vars.proProducts).toBe(PLAN_TIERS.pro.products);
    expect(vars.proMonthly).toBe(PLAN_TIERS.pro.monthly);
    // Promo window (2026-01-01 is before PROMO_END): the promo annual price.
    expect(vars.proAnnual).toBe(PLAN_TIERS.pro.annualPromo);
    // After the window: standard annual.
    const later = planCopyVars(new Date("2099-01-01T00:00:00Z"));
    expect(later.proAnnual).toBe(PLAN_TIERS.pro.annualStandard);
    expect(fillPlanCopy("{days} days, {basicProducts} products, {nope}", vars)).toBe(
      `${TRIAL_DAYS} days, ${PLAN_TIERS.basic.products} products, {nope}`,
    );
  });
});
