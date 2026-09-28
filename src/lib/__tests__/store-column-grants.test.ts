import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STORE_ALL_COLUMNS,
  STORE_ANON_COLUMNS,
  STORE_AUTHENTICATED_COLUMNS,
  STORE_PRIVATE_COLUMNS,
  VERIFICATION_ANON_COLUMNS,
  VERIFICATION_AUTHENTICATED_COLUMNS,
} from "@/lib/store-columns";

// Migration 0314 replaced the table-level SELECT on public.stores with
// column-level grants. A column the public site names but anon was not
// granted does not render as an empty field — the WHOLE query fails with
// 42501 and the storefront goes blank. So this is checked from both ends,
// without a database:
//
//   1. the grant lists written in the migration == src/lib/store-columns.ts;
//   2. every `stores` select / filter / embed in src/ names only columns its
//      audience was granted (public code → anon list; everything → the
//      authenticated list, which excludes the private set);
//   3. the rolled-back SQL test embeds the migration verbatim.
//
// supabase/tests/0314_privacy_hardening.test.sql then proves the grants
// against Postgres itself by running the SELECTs as anon.

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  join(ROOT, "supabase/migrations/0314_privacy_hardening.sql"),
  "utf8",
);
const SQL_TEST = readFileSync(
  join(ROOT, "supabase/tests/0314_privacy_hardening.test.sql"),
  "utf8",
);

function grantList(sql: string, table: string, role: string): string[] {
  const re = new RegExp(
    `grant select \\(([^)]*)\\)\\s*on table public\\.${table} to ${role};`,
    "i",
  );
  const m = re.exec(sql);
  if (!m) throw new Error(`no grant select (...) on ${table} to ${role}`);
  return m[1]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("0314 grant lists match src/lib/store-columns.ts", () => {
  it("stores: 71 distinct columns, private ∩ anon = ∅, anon ⊆ authenticated", () => {
    expect(new Set(STORE_ALL_COLUMNS).size).toBe(71);
    const anon = new Set<string>(STORE_ANON_COLUMNS);
    for (const c of STORE_PRIVATE_COLUMNS) expect(anon.has(c)).toBe(false);
    const auth = new Set<string>(STORE_AUTHENTICATED_COLUMNS);
    for (const c of STORE_ANON_COLUMNS) expect(auth.has(c)).toBe(true);
    expect(auth.size + STORE_PRIVATE_COLUMNS.length).toBe(71);
  });

  it("stores → anon", () => {
    expect(sorted(grantList(MIGRATION, "stores", "anon"))).toEqual(
      sorted(STORE_ANON_COLUMNS),
    );
  });

  it("stores → authenticated", () => {
    expect(sorted(grantList(MIGRATION, "stores", "authenticated"))).toEqual(
      sorted(STORE_AUTHENTICATED_COLUMNS),
    );
  });

  it("store_verifications → anon / authenticated (never reviewed_by)", () => {
    expect(sorted(grantList(MIGRATION, "store_verifications", "anon"))).toEqual(
      sorted(VERIFICATION_ANON_COLUMNS),
    );
    const auth = grantList(MIGRATION, "store_verifications", "authenticated");
    expect(sorted(auth)).toEqual(sorted(VERIFICATION_AUTHENTICATED_COLUMNS));
    expect(auth).not.toContain("reviewed_by");
  });

  it("the SQL test embeds the migration verbatim", () => {
    const start = "-- ==== MIGRATION 0314 (verbatim) ====\n";
    const end = "-- ==== END MIGRATION 0314 (verbatim) ====";
    const a = SQL_TEST.indexOf(start);
    const b = SQL_TEST.indexOf(end);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const embedded = SQL_TEST.slice(a + start.length, b).replace(/\r\n/g, "\n");
    expect(embedded.trim()).toBe(MIGRATION.replace(/\r\n/g, "\n").trim());
  });
});

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

type Use = { file: string; line: number; column: string; how: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Index just past the string literal opening at i (', " or `). */
function skipString(s: string, i: number): number {
  const q = s[i];
  i++;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (q === "`" && s[i] === "$" && s[i + 1] === "{") {
      i = matchParen(s, i + 1, "{", "}");
      continue;
    }
    if (s[i] === q) return i + 1;
    i++;
  }
  return i;
}

/** s[i] === open; index just past its matching close (strings, comments skipped). */
function matchParen(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      i = skipString(s, i);
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const e = s.indexOf("*/", i + 2);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** Resolve a select() argument to its text: literals, templates, and consts. */
function resolveArg(arg: string, src: string, depth = 0): string | null {
  const a = stripComments(arg).trim().replace(/,\s*$/, "");
  if (depth > 4) return null;
  const lit = /^(["'`])([\s\S]*)\1$/.exec(a);
  if (lit) {
    return lit[2].replace(/\$\{\s*([A-Z_][A-Z0-9_]*)\s*\}/g, (_, name: string) => {
      return resolveArg(name, src, depth + 1) ?? "";
    });
  }
  const ident = /^([A-Za-z_$][\w$]*)(?:\.replace\([\s\S]*\))?$/.exec(a);
  if (ident) {
    const def = new RegExp(`const ${ident[1]}\\s*=\\s*`).exec(src);
    if (!def) return null;
    const start = def.index + def[0].length;
    const q = src[start];
    if (q !== '"' && q !== "'" && q !== "`") return null;
    return resolveArg(src.slice(start, skipString(src, start)), src, depth + 1);
  }
  // First argument followed by options, e.g. `"id", { count: "exact" }`.
  const first = /^(["'`])([^"'`]*)\1\s*,/.exec(a);
  return first ? first[2] : null;
}

/** Top-level comma split that respects parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Columns of `stores` named by a PostgREST select string on stores itself. */
function columnsOfSelect(select: string): string[] {
  const cols: string[] = [];
  for (const raw of splitTop(select)) {
    const tok = raw.trim();
    if (!tok) continue;
    const paren = tok.indexOf("(");
    if (paren >= 0) {
      // An embed hanging off stores; business_types joins through our FK.
      const res = tok.slice(0, paren).replace(/^\w+:/, "").split("!")[0].trim();
      if (res === "business_types") cols.push("business_type_id");
      continue;
    }
    if (tok === "*") {
      cols.push("*");
      continue;
    }
    const name = tok.replace(/^\w+:/, "").split("::")[0].trim();
    if (/^[a-z_][a-z0-9_]*$/.test(name)) cols.push(name);
  }
  return cols;
}

const FILTERS = /^(eq|neq|is|in|gt|gte|lt|lte|like|ilike|order|not|contains|match)$/;
const OR_COLUMN = /(?:^|,)\s*([a-z_][a-z0-9_]*)\.(?:eq|neq|gt|gte|lt|lte|like|ilike|in|is|not)\./g;

function scanFile(file: string): Use[] {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;
  const uses: Use[] = [];

  // Direct chains: .from("stores") . select / filters …
  const re = /\.from\(\s*["'`]stores["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    for (;;) {
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] !== ".") break;
      const nm = /^\.([A-Za-z_$][\w$]*)\s*/.exec(src.slice(j));
      if (!nm) break;
      j += nm[0].length;
      if (src[j] !== "(") break;
      const end = matchParen(src, j, "(", ")");
      const arg = src.slice(j + 1, end - 1);
      const method = nm[1];
      if (method === "select") {
        const text = resolveArg(arg, src);
        if (text == null) {
          uses.push({ file: rel, line: lineOf(m.index), column: "?unresolved-select", how: arg.trim() });
        } else {
          for (const c of columnsOfSelect(text)) {
            uses.push({ file: rel, line: lineOf(m.index), column: c, how: "select" });
          }
        }
      } else if (FILTERS.test(method)) {
        const col = /^\s*["'`]([a-z_][a-z0-9_]*)["'`]/.exec(stripComments(arg));
        if (col) uses.push({ file: rel, line: lineOf(m.index), column: col[1], how: method });
      } else if (method === "or") {
        for (const o of stripComments(arg).matchAll(OR_COLUMN)) {
          uses.push({ file: rel, line: lineOf(m.index), column: o[1], how: "or" });
        }
      }
      i = end;
    }
  }

  // Embeds inside other tables' select strings: stores(...), alias:stores!hint(...)
  // and filters on them: "stores.status".
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    if (c !== '"' && c !== "'" && c !== "`") continue;
    const end = skipString(src, i);
    const lit = src.slice(i + 1, end - 1);
    const at = lineOf(i);
    const filt = /^stores\.([a-z_][a-z0-9_]*)$/.exec(lit);
    if (filt) uses.push({ file: rel, line: at, column: filt[1], how: "embed filter" });
    const embed = /(?:^|[\s,(])(?:\w+:)?stores(?:!\w+)*\s*\(/g;
    let e: RegExpExecArray | null;
    while ((e = embed.exec(lit))) {
      const open = e.index + e[0].length - 1;
      const close = matchParen(lit, open, "(", ")");
      for (const col of columnsOfSelect(lit.slice(open + 1, close - 1))) {
        uses.push({ file: rel, line: at, column: col, how: "embed" });
      }
    }
    i = end - 1;
  }
  return uses;
}

// Files that only ever run for a signed-in merchant or admin although they do
// not live under app/[lang]/(dashboard). Each needs a reason.
const DASHBOARD_ONLY = new Map<string, string>([
  [
    "src/lib/data/merchant-stalls.ts",
    "admin home stall report (admin/page.tsx); reads status_changed_at",
  ],
]);

const isDashboard = (rel: string) =>
  rel.includes("/(dashboard)/") || DASHBOARD_ONLY.has(rel);

// The ONE sanctioned direct read of private columns: store-private.ts's
// fallback for a database that does not have 0314 yet (it is refused after
// 0314 by design, and only runs when the RPC is missing). Its column list is
// asserted to be the getter's in privacy-helpers.test.ts.
const PRE_0314_FALLBACK = "src/lib/store-private.ts";

const allUses = walk(join(ROOT, "src"))
  .flatMap(scanFile)
  .filter((u) => u.file !== PRE_0314_FALLBACK);

describe("every stores read in src/ names only granted columns", () => {
  it("finds the reads at all (guards the scanner)", () => {
    const files = new Set(allUses.map((u) => u.file));
    expect(files.has("src/lib/data/store-view.ts")).toBe(true);
    expect(files.has("src/app/feeds/[slug]/google.xml/route.ts")).toBe(true);
    expect(files.has("src/lib/data/stores.ts")).toBe(true);
    expect(files.has("src/lib/data/related.ts")).toBe(true); // stores.status filter + embed
    expect(allUses.length).toBeGreaterThan(250);
  });

  it("resolves every select argument (a const it cannot read is a blind spot)", () => {
    const blind = allUses.filter((u) => u.column.startsWith("?"));
    expect(blind, JSON.stringify(blind, null, 1)).toEqual([]);
  });

  it("never selects * on stores (one ungranted column fails the whole query)", () => {
    expect(allUses.filter((u) => u.column === "*")).toEqual([]);
  });

  it("public code names only STORE_ANON_COLUMNS", () => {
    const anon = new Set<string>(STORE_ANON_COLUMNS);
    const bad = allUses.filter((u) => !isDashboard(u.file) && !anon.has(u.column));
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });

  it("no code names a private column directly (they come from store_private_fields)", () => {
    const auth = new Set<string>(STORE_AUTHENTICATED_COLUMNS);
    const bad = allUses.filter((u) => !auth.has(u.column));
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });

  it("the dynamic store-search or() columns are anon-granted", () => {
    // storeTextOrClause() in src/lib/search-intent.ts builds these at runtime.
    const anon = new Set<string>(STORE_ANON_COLUMNS);
    for (const c of ["name", "description", "area", "specialties", "region"]) {
      expect(anon.has(c)).toBe(true);
    }
  });

  it("the storefront reads store_verifications with anon columns only", () => {
    const src = readFileSync(join(ROOT, "src/app/[lang]/(site)/store/[id]/page.tsx"), "utf8");
    const at = src.indexOf('.from("store_verifications")');
    expect(at).toBeGreaterThan(-1);
    const open = src.indexOf("(", src.indexOf(".select", at));
    const text = resolveArg(src.slice(open + 1, matchParen(src, open, "(", ")") - 1), src);
    const anon = new Set<string>(VERIFICATION_ANON_COLUMNS);
    const cols = columnsOfSelect(text ?? "");
    expect(cols.length).toBeGreaterThan(3);
    expect(cols.filter((c) => !anon.has(c))).toEqual([]);
  });
});
