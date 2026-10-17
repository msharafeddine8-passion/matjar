// Regression guard: the whole Dictionary must never cross into a client
// component.
//
// Every prop handed from a Server Component to a "use client" component is
// serialised into the page's RSC payload. React dedupes only by object
// reference, so a single `dict={dict}` costs the ENTIRE translation file
// (~290 KB of UTF-8 for ar.json) on that page. Measured on production before
// this guard: the store page was 614 KB of HTML (125 KB gzip), of which about
// half was dictionary. Narrowing the TYPE of the prop is not enough on its own
// — TypeScript does not change what gets serialised — so both halves are
// checked here:
//
//   A. no "use client" file types a prop as the full `Dictionary`
//      (it must be `Pick<Dictionary, ...>`, so tsc proves what it reads), and
//   B. no server file holding the full dictionary passes it bare
//      (`anything={dict}`) into a client component — it must go through
//      `dictSlice(dict, [...])` from src/lib/dict-slice.ts, or as plain strings.
//
// Static scan, no rendering: it reads the source the way the bundler resolves
// it (imports, `@/` alias, `next/dynamic` wrappers).

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Known, deliberately unconverted sites. Keep empty; add `file → reason`
 *  only for a dashboard-only site you could not convert yet. */
const ALLOW: Record<string, string> = {};

const files: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") walk(p);
    } else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      files.push(path.normalize(p));
    }
  }
})(SRC);

const src = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, "/");
const isClient = (f: string) =>
  /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src.get(f) ?? "");

// `dict: Dictionary` / `dict?: Dictionary`, but not `Dictionary["store"]`.
const FULL_PROP = /\bdict\??:\s*Dictionary\b(?!\s*\[)/;

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else return null;
  for (const c of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    const n = path.normalize(c);
    if (src.has(n)) return n;
  }
  return null;
}

type Imported = { file: string; name: string };
const importCache = new Map<string, Record<string, Imported>>();
function importsOf(f: string): Record<string, Imported> {
  const hit = importCache.get(f);
  if (hit) return hit;
  const map: Record<string, Imported> = {};
  const re =
    /import\s+(?:type\s+)?([\w$]+\s*,\s*)?(?:\{([^}]*)\})?\s*([\w$]+)?\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src.get(f) ?? ""))) {
    const target = resolveSpec(f, m[4]);
    if (!target) continue;
    const def = (m[1] ?? "").replace(/[,\s]/g, "") || m[3];
    if (def) map[def] = { file: target, name: "default" };
    for (const part of (m[2] ?? "").split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      if (!p) continue;
      const [a, b] = p.split(/\s+as\s+/);
      map[(b ?? a).trim()] = { file: target, name: a.trim() };
    }
  }
  importCache.set(f, map);
  return map;
}

/** The file that really renders `<Name>` — following `next/dynamic` thunks. */
function resolveComponent(f: string, name: string): string | null {
  const imp = importsOf(f)[name.split(".")[0]];
  if (!imp) return null;
  const body = src.get(imp.file) ?? "";
  const dyn = new RegExp(
    `export const ${imp.name}\\s*=\\s*dynamic\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*["']([^"']+)["']`,
  ).exec(body);
  if (dyn) return resolveSpec(imp.file, dyn[1]) ?? imp.file;
  return imp.file;
}

/** Opening JSX tags and the names of their own props whose value is exactly
 *  `{dict}`. Tolerant of `=>`, nested braces (a JSX element inside a prop is
 *  scanned as its own tag, not as this one's prop), quoted strings and
 *  comments between attributes. */
function* jsxTags(s: string): Generator<{ name: string; bareDict: string[]; index: number }> {
  const open = /<([A-Z][\w.]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(s))) {
    // `Pick<Dictionary` / `Array<Foo>` are type arguments, not JSX.
    if (/[\w$.]$/.test(s.slice(0, m.index))) continue;
    const bareDict: string[] = [];
    let i = open.lastIndex;
    let depth = 0;
    let exprStart = -1;
    for (; i < s.length; i++) {
      const c = s[i];
      if (depth === 0) {
        if (c === ">") break;
        if (c === '"' || c === "'") { i = s.indexOf(c, i + 1); if (i < 0) break; continue; }
        if (c === "/" && s[i + 1] === "/") { i = s.indexOf("\n", i); if (i < 0) break; continue; }
        if (c === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i) + 1; if (i <= 0) break; continue; }
      }
      if (c === "{") {
        if (depth === 0) exprStart = i;
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0 && s.slice(exprStart + 1, i).trim() === "dict") {
          const name = /([\w$]+)\s*=\s*$/.exec(s.slice(open.lastIndex, exprStart));
          if (name) bareDict.push(name[1]);
        }
      }
    }
    if (i < 0) return;
    yield { name: m[1], bareDict, index: m.index };
  }
}

describe("the full dictionary stays on the server", () => {
  it("A: no client component types a prop as the full Dictionary", () => {
    const bad = files
      .filter((f) => isClient(f) && FULL_PROP.test(src.get(f) ?? ""))
      .map(rel)
      .filter((f) => !ALLOW[f]);
    expect(bad, "type it Pick<Dictionary, ...> instead").toEqual([]);
  });

  it("B: no server file passes the full dict bare into a client component", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (isClient(f)) continue;
      const s = src.get(f) ?? "";
      // Only files that hold the WHOLE dictionary; a server component handed a
      // slice may forward it.
      if (!FULL_PROP.test(s) && !/getDictionary\(/.test(s)) continue;
      for (const tag of jsxTags(s)) {
        if (!tag.bareDict.length) continue;
        const target = resolveComponent(f, tag.name);
        if (!target || !isClient(target)) continue;
        const where = `${rel(f)}:${s.slice(0, tag.index).split("\n").length}`;
        if (ALLOW[rel(f)]) continue;
        bad.push(`${where} <${tag.name} ${tag.bareDict[0]}={dict}> → ${rel(target)}`);
      }
    }
    expect(bad, "use dictSlice(dict, [...]) or pass plain strings").toEqual([]);
  });

  it("the scanner still sees the call sites it guards", () => {
    // If a refactor moved the slicing helper or the scan stopped resolving
    // imports, the two checks above would pass vacuously.
    const sliced = files.filter((f) => /dict=\{dictSlice\(dict,/.test(src.get(f) ?? ""));
    expect(sliced.length).toBeGreaterThan(50);
    const header = files.find((f) => rel(f) === "components/site-header.tsx");
    expect(header && resolveComponent(header, "MobileMenu")).toBe(
      path.join(SRC, "components", "mobile-menu.tsx"),
    );
  });
});
