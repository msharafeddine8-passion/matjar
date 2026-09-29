import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  FETCH_BOUNDS,
  ID_FILTER_CHUNK,
  PAGE_ROWS,
  fetchAllByIds,
  fetchAllPages,
} from "@/lib/data/bounds";

// MP-070. src/lib/data is the whole query layer and it had no tests, so the two
// failures it has actually produced could both reach production unremarked:
//
//   1. a select that silently stops at PostgREST's 1000-row default, and
//   2. a projection that quietly loses a column the mapper below it reads.
//
// Neither can be caught by running the app against today's data — the platform
// is far too small to hit the first, and the second renders as an empty field
// rather than an error. Both are, however, plainly visible in the source, so
// these are contract tests over the source text and over the paging primitives.
// No database, no network: `e2e/` covers the live app.

const DATA_DIR = join(process.cwd(), "src/lib/data");

const dataFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith(".ts"));

function read(file: string): string {
  return readFileSync(join(DATA_DIR, file), "utf8");
}

const sources = new Map(dataFiles.map((f) => [f, read(f)] as const));

// ---------------------------------------------------------------------------
// A tiny scanner over the query builder chains.
//
// Everything below works on `.from("table") … <chain>` slices. Finding where a
// chain ends is the only fiddly part: chains appear as statements, as array
// elements inside Promise.all, and as arrow-function bodies. Walking forward
// while tracking bracket depth and string literals handles all three — the
// chain ends at the first `;` or `,` at depth 0, or at the bracket that closes
// the context the chain started inside.

type Chain = {
  file: string;
  line: number;
  table: string;
  text: string;
  /** `const x = supabase.from(…)` → "x". The bound may be applied to it later. */
  assignedTo: string | null;
};

/** Index just past a comment starting at `i`, or -1 if there is no comment.
 *  Comments have to be skipped rather than scanned: this codebase explains
 *  itself in prose, and one apostrophe in "the viewer's own review" would
 *  otherwise open a string literal that never closes. */
function skipComment(src: string, i: number): number {
  if (src[i] !== "/") return -1;
  if (src[i + 1] === "/") {
    const nl = src.indexOf("\n", i);
    return nl < 0 ? src.length : nl;
  }
  if (src[i + 1] === "*") {
    const close = src.indexOf("*/", i + 2);
    return close < 0 ? src.length : close + 2;
  }
  return -1;
}

function sliceChain(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    const past = skipComment(src, i);
    if (past >= 0) {
      i = past - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--depth < 0) return src.slice(start, i);
    } else if (depth === 0 && (c === ";" || c === ",")) return src.slice(start, i);
  }
  return src.slice(start);
}

function chainsIn(file: string, src: string): Chain[] {
  const out: Chain[] = [];
  const re = /\.from\(\s*"([a-z_0-9]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 240), m.index);
    const assign = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[^=;{}]*$/.exec(
      before,
    );
    out.push({
      file,
      line: src.slice(0, m.index).split("\n").length,
      table: m[1],
      text: sliceChain(src, m.index),
      assignedTo: assign ? assign[1] : null,
    });
  }
  return out;
}

const allChains: Chain[] = [...sources].flatMap(([f, src]) => chainsIn(f, src));

/** A chain that cannot return an unbounded number of rows. */
function isBounded(text: string): boolean {
  return (
    /\.limit\(/.test(text) ||
    /\.range\(/.test(text) ||
    // One row by construction.
    /\.maybeSingle\(\)/.test(text) ||
    /\.single\(\)/.test(text) ||
    // A count with `head: true` returns no rows at all, only the number.
    /head:\s*true/.test(text)
  );
}

/** Builder chains are often assembled over several statements:
 *    let q = supabase.from("products").select(…);
 *    if (kind) q = q.eq("item_kind", kind);
 *    const { data } = await q.order(…).limit(limit);
 *  so the bound lives on a later chain rooted at the same identifier. */
function boundedLater(src: string, ident: string): boolean {
  const re = new RegExp(`\\b${ident}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (isBounded(sliceChain(src, m.index))) return true;
  }
  return false;
}

// The only reads in this layer allowed to come back unbounded. Keep this list
// empty if at all possible: every entry is a table that must never grow, and
// "must never grow" is a promise about the future, not an observation.
//
// (Reference taxonomies such as market_categories or lb_areas are NOT here.
// They already carry FETCH_BOUNDS.referenceRows, because lb_areas in particular
// sits close enough to 1000 that the default cap was a live risk.)
const UNBOUNDED_ALLOWED: { file: string; table: string; why: string }[] = [];

describe("no query in src/lib/data can silently truncate", () => {
  it("finds the query chains at all (guards the scanner itself)", () => {
    // If the scanner ever stops matching — a rename, a formatter, a wrapper —
    // every assertion below would pass vacuously. Pin the shape it must see.
    expect(allChains.length).toBeGreaterThan(30);
    expect(allChains.map((c) => c.table)).toContain("products");
    expect(allChains.map((c) => c.table)).toContain("follows");
  });

  it("bounds every select — an unbounded one stops at 1000 rows and says nothing", () => {
    const unbounded = allChains
      .filter((c) => {
        if (isBounded(c.text)) return false;
        if (c.assignedTo && boundedLater(sources.get(c.file)!, c.assignedTo)) {
          return false;
        }
        return !UNBOUNDED_ALLOWED.some(
          (a) => a.file === c.file && a.table === c.table,
        );
      })
      .map((c) => `${c.file}:${c.line} → ${c.table}`);

    expect(
      unbounded,
      "Each of these selects returns at most PostgREST's db-max-rows and reports " +
        "success, so the rows past the cap are invisible. Add .limit(FETCH_BOUNDS.x) " +
        "(audible) or page it with fetchAllPages (audible and complete).",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two surfaces MP-040 / MP-041 named must stay PAGED, not merely bounded.
// A `.limit()` makes truncation audible; only paging makes the rows arrive.

describe("the whole-store and whole-seller reads are paged, not capped", () => {
  const storeView = sources.get("store-view.ts")!;
  const market = sources.get("market.ts")!;
  const stores = sources.get("stores.ts")!;

  it("MP-040: the store catalogue read pages through .range()", () => {
    const products = chainsIn("store-view.ts", storeView).find(
      (c) => c.table === "products",
    );
    expect(products, "store-view.ts no longer reads products").toBeTruthy();
    expect(products!.text).toContain(".range(");
    expect(storeView).toContain("fetchAllPages");
  });

  it("MP-040: paged reads carry a unique tiebreaker, or .range() drops rows", () => {
    // sort_order / created_at are not unique. Paging a result set by position
    // when the database is free to order ties either way makes a row appear on
    // two pages or on none — the failure paging is supposed to remove.
    for (const chain of chainsIn("store-view.ts", storeView)) {
      if (!chain.text.includes(".range(")) continue;
      expect(
        /\.order\(\s*"id"/.test(chain.text),
        `${chain.file}:${chain.line} (${chain.table}) pages without a unique order`,
      ).toBe(true);
    }
    const listings = chainsIn("market.ts", market).find(
      (c) => c.table === "listings" && c.text.includes(".eq(\"seller_id\""),
    );
    expect(listings!.text).toMatch(/\.order\(\s*"id"/);
  });

  it("MP-041: getMyListings pages through .range()", () => {
    const listings = chainsIn("market.ts", market).find(
      (c) => c.table === "listings" && c.text.includes(".eq(\"seller_id\""),
    );
    expect(listings, "market.ts no longer reads a seller's own listings").toBeTruthy();
    expect(listings!.text).toContain(".range(");
  });

  it("MP-041: the follow read asks about the page, not about the whole account", () => {
    // The reshape is the actual fix here. Reading every follow the user has and
    // testing the page against it made a truncated read render a followed store
    // as un-followed — wrong state, not just missing rows. Scoping the query by
    // the ids being rendered removes the ceiling instead of raising it.
    const follows = chainsIn("stores.ts", stores).filter((c) => c.table === "follows");
    expect(follows).toHaveLength(1);
    expect(
      follows[0].text,
      "follows must be filtered by the store ids on the page",
    ).toContain('.in("store_id"');
    // And nowhere else in the layer may read follows unscoped.
    for (const c of allChains.filter((c) => c.table === "follows")) {
      expect(c.text, `${c.file}:${c.line} reads follows unscoped`).toContain(
        '.in("store_id"',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Row-shape contracts.
//
// A projection and the mapper under it are one contract written in two places.
// Drop a column from the select and the mapper reads `undefined`: the field
// renders blank, nothing throws, nothing logs. These tests read the columns the
// mapper actually asks for and require the projection to supply every one.

/** Top-level column names in a PostgREST select string. `stores(name)` counts
 *  as the column `stores` — the embedded resource arrives under that key. */
function columnsOf(select: string): Set<string> {
  const out = new Set<string>();
  let depth = 0;
  let token = "";
  const flush = () => {
    const name = token.trim().split("(")[0].trim();
    if (name) out.add(name);
    token = "";
  };
  for (const c of select) {
    if (c === "(") {
      if (depth === 0) flush();
      depth++;
    } else if (c === ")") depth--;
    else if (c === "," && depth === 0) flush();
    else if (depth === 0) token += c;
  }
  flush();
  return out;
}

/** Every `<v>.<name>` read inside a slice of source. */
function fieldsReadFrom(body: string, v: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`\\b${v}\\s*\\??\\.\\s*([a-z_][a-z_0-9]*)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(m[1]);
  return out;
}

/**
 * The body of the block `marker` opens — `marker` must end with the opening
 * `{` or `(`. Balanced-delimiter matching, NOT the chain slicer: a function
 * body is full of statement semicolons and a mapper is full of commas, and
 * stopping at the first one would quietly hand every caller a one-line
 * fragment that reads almost no fields at all.
 */
function blockAfter(src: string, marker: string): string {
  const i = src.indexOf(marker);
  expect(i, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const start = i + marker.length;
  let depth = 1;
  let quote: string | null = null;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === "\\") j++;
      else if (c === quote) quote = null;
      continue;
    }
    const past = skipComment(src, j);
    if (past >= 0) {
      j = past - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--depth === 0) return src.slice(start, j);
    }
  }
  throw new Error(`unterminated block after: ${marker}`);
}

function literalAfter(src: string, marker: string): string {
  const i = src.indexOf(marker);
  expect(i, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const m = /"([^"]*)"/.exec(src.slice(i));
  expect(m, `no string literal after ${marker}`).toBeTruthy();
  return m![1];
}

describe("row-shape contracts", () => {
  it("the store catalogue projection supplies every column its mapper reads", () => {
    const src = sources.get("store-view.ts")!;
    const columns = columnsOf(literalAfter(src, "const PRODUCT_COLUMNS"));
    // `products: prods.map((p) => ({ … }))` — the block that builds StoreView.products.
    const mapper = blockAfter(src, "products: prods.map((p) => (");
    const read = fieldsReadFrom(mapper, "p");
    // Guard the extractor before trusting it: an empty or truncated body makes
    // every assertion below vacuously true. MP-040's own issue text counts 16
    // columns on this projection, so anything near that is the whole mapper.
    expect(read.size, "the products mapper was not extracted").toBeGreaterThan(15);
    expect(
      [...read].filter((f) => !columns.has(f)),
      "these columns are read by the mapper but not selected — the field renders " +
        "blank on every storefront and nothing errors",
    ).toEqual([]);
    expect(columns.size).toBeGreaterThan(15);
  });

  it("the market list projection supplies every column toCard reads", () => {
    const src = sources.get("market.ts")!;
    const columns = columnsOf(literalAfter(src, "const SELECT ="));
    const body = blockAfter(src, "function toCard(r: Row, lang: Locale): ListingCard {");
    const read = fieldsReadFrom(body, "r");
    expect(read.size, "the toCard body was not extracted").toBeGreaterThan(9);
    expect(
      [...read].filter((f) => !columns.has(f)),
      "ListingCard would be built from undefined",
    ).toEqual([]);
  });

  it("the listing detail projection is a superset of the card projection", () => {
    // getListingById feeds the detail row straight into toCard, so anything the
    // card needs must survive in the heavier select too. These two strings sit
    // 70 lines apart and are edited independently; this is the only thing
    // holding them together.
    const src = sources.get("market.ts")!;
    const card = columnsOf(literalAfter(src, "const SELECT ="));
    const detailChain = chainsIn("market.ts", src).find(
      (c) => c.table === "listings" && c.text.includes("description, views"),
    );
    expect(detailChain, "the listing detail select moved").toBeTruthy();
    const detail = columnsOf(/"([^"]*)"/.exec(detailChain!.text.split(".select(")[1])![1]);
    expect([...card].filter((c) => !detail.has(c))).toEqual([]);
    // The detail read exists precisely to add these.
    expect(detail.has("description")).toBe(true);
    expect(detail.has("views")).toBe(true);
  });

  it("the store sections and checkout-field projections match their mappers", () => {
    const src = sources.get("store-view.ts")!;
    const sections = chainsIn("store-view.ts", src).find(
      (c) => c.table === "store_sections",
    )!;
    const sectionCols = columnsOf(/"([^"]*)"/.exec(sections.text.split(".select(")[1])![1]);
    const sectionMapper = blockAfter(src, "sections: (sects ?? []).map((s) => (");
    const sectionRead = fieldsReadFrom(sectionMapper, "s");
    expect(sectionRead.size, "the sections mapper was not extracted").toBeGreaterThan(3);
    expect([...sectionRead].filter((f) => !sectionCols.has(f))).toEqual([]);

    const fields = chainsIn("store-view.ts", src).find(
      (c) => c.table === "store_checkout_fields",
    )!;
    const fieldCols = columnsOf(/"([^"]*)"/.exec(fields.text.split(".select(")[1])![1]);
    const fieldMapper = blockAfter(src, "}[]).map((f) => (");
    const fieldRead = fieldsReadFrom(fieldMapper, "f");
    expect(fieldRead.size, "the checkout-field mapper was not extracted").toBeGreaterThan(4);
    expect([...fieldRead].filter((f) => !fieldCols.has(f))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MP-010. No public projection may carry another person's account id.
//
// reviews, product_reviews and product_questions are all `select using (true)`.
// Selecting the reviewer's uuid there published a stable per-person identifier
// to every anonymous visitor, who could then correlate one person's reviews and
// questions across the whole platform. Migration 0286 fixed craft_reviews by
// withdrawing the column grant and could not fix these three, because the app
// still asked for the column — a revoke would have 42501'd the request and the
// `?? []` would have swallowed it, silently emptying the reviews block, the
// rating histogram, the verified-purchase badge and the Q&A.
//
// This is what holds that door shut. Putting the column back into any of these
// projections fails here, loudly, instead of in a penetration test.

/** The argument to `.select(...)`, resolved through a `const X = "…"` alias. */
function selectArg(chainText: string, src: string): string {
  const at = chainText.indexOf(".select(");
  if (at < 0) return "";
  const open = at + ".select(".length;
  let depth = 1;
  let end = chainText.length;
  for (let i = open; i < chainText.length; i++) {
    const c = chainText[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) {
      end = i;
      break;
    }
  }
  const arg = chainText.slice(open, end);
  const ident = /^\s*([A-Z][A-Z_0-9]*)\s*(?:,|$)/.exec(arg);
  if (!ident) return arg;
  // `.select(PRODUCT_COLUMNS)` — follow the constant to its literal.
  const decl = new RegExp(`const ${ident[1]}\\s*(?::[^=]*)?=\\s*\\n?\\s*"([^"]*)"`).exec(src);
  return decl ? decl[1] : arg;
}

describe("no public projection ships another person's account id", () => {
  // Someone else's identity. Not user_id / seller_id: those name the VIEWER in
  // `.eq("user_id", user.id)` filters, which is the viewer asking about
  // themselves — the opposite of the leak.
  const PERSON_ID = ["customer_id", "asker_id"];

  const pageFiles = [
    "src/app/[lang]/(site)/store/[id]/page.tsx",
    "src/app/[lang]/(site)/product/[id]/page.tsx",
  ];
  const scanned: [string, string][] = [
    ...[...sources].map(([f, s]) => [`src/lib/data/${f}`, s] as [string, string]),
    ...pageFiles.map(
      (f) => [f, readFileSync(join(process.cwd(), f), "utf8")] as [string, string],
    ),
  ];

  it("finds the public review and Q&A reads at all (guards the scanner)", () => {
    const tables = scanned.flatMap(([f, s]) => chainsIn(f, s)).map((c) => c.table);
    for (const t of ["reviews", "product_reviews", "product_questions"]) {
      expect(tables, `${t} is no longer read where this test looks`).toContain(t);
    }
  });

  it("never selects customer_id or asker_id", () => {
    const offenders: string[] = [];
    for (const [file, src] of scanned) {
      for (const chain of chainsIn(file, src)) {
        const arg = selectArg(chain.text, src);
        for (const col of PERSON_ID) {
          if (arg.includes(col)) offenders.push(`${file}:${chain.line} → ${col}`);
        }
      }
    }
    expect(
      offenders,
      "A public read is selecting someone else's account id. Compute what the " +
        "page needs from it server-side and return a boolean; the column grant " +
        "is being withdrawn (see migration 0286) and this request will 42501.",
    ).toEqual([]);
  });

  it("asks about the viewer's own review through the 0319 helpers, never by column", () => {
    // Since 0320 a signed-in user cannot even FILTER on customer_id, their own
    // included, so "have I reviewed this" goes through definer RPCs that only
    // answer for auth.uid(). If these calls vanish, ownership silently became
    // false for everyone and the review form stops prefilling.
    const store = readFileSync(
      join(process.cwd(), "src/app/[lang]/(site)/store/[id]/page.tsx"),
      "utf8",
    );
    expect(store).toContain('rpc("my_store_review"');
    expect(store).not.toContain('.eq("customer_id", user.id)');
    const reviews = sources.get("product-reviews.ts")!;
    expect(reviews).toContain('rpc("has_reviewed_product"');
    expect(reviews).not.toContain('.eq("customer_id"');
  });

  it("keeps the rendered row types free of any account id", () => {
    // The query is only half of it: these types are what crosses into a client
    // component, so a uuid reintroduced here reaches the browser even if the
    // select stays clean.
    const shapes: [string, string][] = [
      ["ProductReview", sources.get("product-reviews.ts")!],
      ["ProductQuestion", sources.get("product-qa.ts")!],
      [
        "Review",
        readFileSync(join(process.cwd(), "src/components/store-reviews.tsx"), "utf8"),
      ],
    ];
    for (const [name, src] of shapes) {
      const body = blockAfter(src, `export type ${name} = {`);
      expect(body.length, `${name} was not found`).toBeGreaterThan(20);
      for (const forbidden of [...PERSON_ID, "customerId", "askerId"]) {
        expect(
          body.includes(forbidden),
          `${name} carries ${forbidden} — that reaches the browser`,
        ).toBe(false);
      }
    }
  });

  it("keeps the signed-out path free of any reference to the column", () => {
    // Signed out is the common case and runs as `anon`, the role losing the
    // grant. The ownership lookups must therefore be behind a viewer check —
    // not merely return false after asking.
    const reviews = sources.get("product-reviews.ts")!;
    const guard = reviews.indexOf("if (!currentUserId) return false;");
    expect(guard, "the viewer guard in product-reviews.ts is gone").toBeGreaterThan(-1);
    expect(
      reviews.indexOf('rpc("has_reviewed_product"'),
      "the ownership question must sit AFTER the signed-out early return",
    ).toBeGreaterThan(guard);
    // product-qa no longer takes a viewer at all — there is no ownership
    // question left to answer, so there is nothing to guard.
    const qa = sources.get("product-qa.ts")!;
    expect(qa).toContain("getProductQuestions(\n  productId: string,\n)");
    expect(qa).not.toContain("currentUserId");
  });
});

// ---------------------------------------------------------------------------
// Bounds coherence: FETCH_BOUNDS and its callers must not drift apart. An
// orphaned key reads as a surface that is bounded when it is not; a reference
// to a key that does not exist is `undefined`, and `.limit(undefined)` is an
// unbounded query wearing the costume of a bounded one.

describe("FETCH_BOUNDS coherence", () => {
  // Bounds started as a src/lib/data concern, so this scanner only looked
  // there. ISS-013 put two of them in admin pages instead: the admin roster
  // fetches inline, the way every other admin page does, and moving only those
  // two into the data layer would make that layer mean two different things.
  // So the scanner follows the callers rather than the callers moving to the
  // scanner — both checks below (orphaned bound, bound that does not exist) now
  // cover these files too. Add a file here when a surface outside src/lib/data
  // starts reading FETCH_BOUNDS, or the bound it names goes unguarded.
  const boundedPages = [
    "src/app/[lang]/(dashboard)/admin/stores/page.tsx",
    "src/app/[lang]/(dashboard)/admin/leaders/page.tsx",
  ];
  const callers: [string, string][] = [
    ...[...sources].filter(([f]) => f !== "bounds.ts"),
    ...boundedPages.map(
      (f) => [f, readFileSync(join(process.cwd(), f), "utf8")] as [string, string],
    ),
  ];

  it("finds the out-of-layer callers at all (guards the scanner)", () => {
    // Without this, renaming one of those pages turns the check below into a
    // vacuous pass wearing a failure's clothes: the bound would be reported as
    // orphaned, which reads as "delete this ceiling" when the truth is "the
    // scanner lost the file".
    for (const f of boundedPages) {
      const src = callers.find(([name]) => name === f)?.[1];
      expect(src, `${f} is no longer where this test looks`).toBeDefined();
      expect(src, `${f} no longer reads FETCH_BOUNDS`).toContain("FETCH_BOUNDS.");
    }
  });

  it("every declared bound is actually used", () => {
    const used = new Set<string>();
    for (const [, src] of callers) {
      for (const m of src.matchAll(/FETCH_BOUNDS\.([A-Za-z_$][\w$]*)/g)) {
        used.add(m[1]);
      }
    }
    const orphans = Object.keys(FETCH_BOUNDS).filter((k) => !used.has(k));
    expect(
      orphans,
      "these ceilings are declared but nothing reads them — either the surface " +
        "lost its bound, or the bound outlived the surface",
    ).toEqual([]);
  });

  it("nothing reads a bound that does not exist", () => {
    const declared = new Set(Object.keys(FETCH_BOUNDS));
    const bogus: string[] = [];
    for (const [file, src] of callers) {
      for (const m of src.matchAll(/FETCH_BOUNDS\.([A-Za-z_$][\w$]*)/g)) {
        if (!declared.has(m[1])) bogus.push(`${file} → FETCH_BOUNDS.${m[1]}`);
      }
    }
    // `.limit(undefined)` does not throw; it just drops the bound.
    expect(bogus).toEqual([]);
  });

  it("no bound sits at or below PostgREST's own default", () => {
    // A ceiling of exactly 1000 can never be observed: the server caps the
    // response at 1000 first, so the warning would fire on every full page and
    // mean nothing. Bounds must be either well under it or well over it.
    for (const [name, limit] of Object.entries(FETCH_BOUNDS)) {
      expect(limit, `${name} sits on the db-max-rows boundary`).not.toBe(PAGE_ROWS);
    }
  });
});

// ---------------------------------------------------------------------------
// The paging primitives themselves.

type Page = { data: { i: number }[] | null };

/** A fake table of `n` rows that answers .range(from, to) windows. */
function fakeTable(n: number) {
  const calls: [number, number][] = [];
  const fetchPage = (from: number, to: number): PromiseLike<Page> => {
    calls.push([from, to]);
    const rows = [];
    for (let i = from; i <= Math.min(to, n - 1); i++) rows.push({ i });
    return Promise.resolve({ data: rows });
  };
  return { calls, fetchPage };
}

function captureWarn(): string[] {
  const out: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe("fetchAllPages", () => {
  it("returns rows past the 1000-row cap that a bare .limit() would have lost", async () => {
    const t = fakeTable(2500);
    const rows = await fetchAllPages<{ i: number }>(t.fetchPage, 20000, "x");
    expect(rows).toHaveLength(2500);
    expect(rows[0].i).toBe(0);
    expect(rows[2499].i).toBe(2499);
    // Contiguous and in order: no page boundary swallowed or repeated a row.
    expect(rows.every((r, i) => r.i === i)).toBe(true);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops on the first short page instead of asking forever", async () => {
    const t = fakeTable(10);
    expect(await fetchAllPages<{ i: number }>(t.fetchPage, 20000, "x")).toHaveLength(10);
    expect(t.calls).toHaveLength(1);
  });

  it("stops at the ceiling and says so", async () => {
    const warns = captureWarn();
    const t = fakeTable(10_000);
    const rows = await fetchAllPages<{ i: number }>(t.fetchPage, 2500, "products (store s1)");
    expect(rows).toHaveLength(2500);
    // The last window is narrowed to the ceiling — never overshoots it.
    expect(t.calls.at(-1)).toEqual([2000, 2499]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("products (store s1)");
    expect(warns[0]).toContain("2500");
  });

  it("stays quiet when the result set merely ends", async () => {
    const warns = captureWarn();
    await fetchAllPages<{ i: number }>(fakeTable(2499).fetchPage, 2500, "x");
    expect(warns).toEqual([]);
  });

  it("treats a failed page as the end rather than looping on it", async () => {
    let n = 0;
    const rows = await fetchAllPages<{ i: number }>(
      () => {
        n++;
        return Promise.resolve({ data: null });
      },
      20000,
      "x",
    );
    expect(rows).toEqual([]);
    expect(n).toBe(1);
  });
});

describe("fetchAllByIds", () => {
  it("never puts more than one chunk of ids in a single .in() filter", async () => {
    const ids = Array.from({ length: 1234 }, (_, i) => `id-${i}`);
    const seen: number[] = [];
    await fetchAllByIds<{ i: number }>(
      ids,
      (chunk, from, to) => {
        if (from === 0) seen.push(chunk.length);
        // One row per id in the chunk, so paging inside a chunk stays trivial.
        return Promise.resolve({
          data: chunk.slice(0, to - from + 1).map((_, i) => ({ i })),
        });
      },
      100000,
      "x",
    );
    // Asserted against a LITERAL, not against ID_FILTER_CHUNK: comparing the
    // behaviour to the constant that produces it would move the goalposts along
    // with the bug. A uuid costs ~40 bytes once url-encoded into the `in.(…)`
    // filter, so 250 ids is already a ~10KB request line — past what several
    // proxies will forward, and the reason the chunking exists.
    expect(Math.max(...seen)).toBeLessThanOrEqual(250);
    expect(ID_FILTER_CHUNK).toBeLessThanOrEqual(250);
    expect(seen.reduce((a, b) => a + b, 0)).toBe(ids.length);
  });

  it("concatenates every chunk — no id is dropped", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const rows = await fetchAllByIds<{ i: number }>(
      ids,
      (chunk) => Promise.resolve({ data: chunk.map((_, i) => ({ i })) }),
      100000,
      "x",
    );
    expect(rows).toHaveLength(450);
  });

  it("warns once for the surface, not once per chunk", async () => {
    const warns = captureWarn();
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    const rows = await fetchAllByIds<{ i: number }>(
      ids,
      (chunk, from, to) =>
        Promise.resolve({
          data: chunk.slice(0, to - from + 1).map((_, i) => ({ i })),
        }),
      300,
      "product_variants (store s1)",
    );
    expect(rows).toHaveLength(300);
    expect(warns).toHaveLength(1);
  });

  it("does nothing at all for an empty id list", async () => {
    let called = false;
    const rows = await fetchAllByIds<{ i: number }>(
      [],
      () => {
        called = true;
        return Promise.resolve({ data: [] });
      },
      100,
      "x",
    );
    expect(rows).toEqual([]);
    expect(called).toBe(false);
  });
});
