import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_PRIVATE_FIELDS,
  PRIVATE_FALLBACK_SELECT,
  fetchStorePrivateFields,
  toPrivateFieldsMap,
} from "@/lib/store-private";
import {
  classifyDocRef,
  docPathBelongsTo,
  docUrlFor,
  resolveDocUrls,
  verificationDocPath,
} from "@/lib/verification-docs";
import {
  STAFF_NOTE_MAX,
  cleanStaffNote,
  isMissingTable,
  pickStaffNote,
  saveStaffNote,
} from "@/lib/order-staff-note";
import { buildCrossPostListing } from "@/lib/market-crosspost";
import { STORE_PRIVATE_COLUMNS } from "@/lib/store-columns";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// store-private.ts (P1-PRIV-01)
// ---------------------------------------------------------------------------
describe("store private fields", () => {
  it("maps getter rows by id and drops junk", () => {
    const m = toPrivateFieldsMap([
      { id: A, tax_no: "T1", legal_name: "", status_reason: null },
      { nope: true },
      null,
      "x",
    ]);
    expect([...m.keys()]).toEqual([A]);
    expect(m.get(A)).toEqual({ ...EMPTY_PRIVATE_FIELDS, tax_no: "T1" });
    expect(toPrivateFieldsMap(null).size).toBe(0);
  });

  it("the pre-0314 fallback selects only columns the getter also returns", () => {
    const cols = PRIVATE_FALLBACK_SELECT.split(", ");
    expect(cols[0]).toBe("id");
    const priv = new Set<string>(STORE_PRIVATE_COLUMNS);
    for (const c of cols.slice(1)) expect(priv.has(c)).toBe(true);
  });

  function fakeClient(opts: {
    rpc: { data: unknown; error: unknown };
    fallback?: { data: unknown; error: unknown };
  }) {
    const inCalls: string[][] = [];
    const client = {
      rpc: vi.fn(async () => opts.rpc),
      from: vi.fn(() => ({
        select: () => ({
          in: async (_c: string, ids: string[]) => {
            inCalls.push(ids);
            return opts.fallback ?? { data: null, error: { code: "42501" } };
          },
        }),
      })),
    };
    return { client: client as unknown as SupabaseClient, raw: client, inCalls };
  }

  it("uses the RPC when it answers", async () => {
    const { client, raw } = fakeClient({ rpc: { data: [{ id: A, tax_no: "T" }], error: null } });
    const m = await fetchStorePrivateFields(client, [A, A, ""]);
    expect(raw.rpc).toHaveBeenCalledWith("store_private_fields", { p_store_ids: [A] });
    expect(raw.from).not.toHaveBeenCalled();
    expect(m.get(A)?.tax_no).toBe("T");
  });

  it("before 0314 (no function) falls back to the direct select", async () => {
    const { client, inCalls } = fakeClient({
      rpc: { data: null, error: { code: "PGRST202" } },
      fallback: { data: [{ id: B, legal_name: "L" }], error: null },
    });
    const m = await fetchStorePrivateFields(client, [B]);
    expect(inCalls).toEqual([[B]]);
    expect(m.get(B)?.legal_name).toBe("L");
  });

  it("when both fail it answers an empty map — never throws", async () => {
    const { client } = fakeClient({ rpc: { data: null, error: { code: "42501" } } });
    await expect(fetchStorePrivateFields(client, [A])).resolves.toEqual(new Map());
    const throwing = { rpc: () => { throw new Error("down"); } } as unknown as SupabaseClient;
    await expect(fetchStorePrivateFields(throwing, [A])).resolves.toEqual(new Map());
  });

  it("chunks long id lists (the fallback puts them in the URL)", async () => {
    const ids = Array.from({ length: 320 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);
    const { client, raw } = fakeClient({ rpc: { data: [], error: null } });
    await fetchStorePrivateFields(client, ids);
    expect(raw.rpc).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// verification-docs.ts (P1-PRIV-02)
// ---------------------------------------------------------------------------
describe("verification document refs", () => {
  it("builds '<store>/<id>.<ext>' with a safe extension", () => {
    expect(verificationDocPath(A, "abc", "JPG")).toBe(`${A}/abc.jpg`);
    expect(verificationDocPath(A, "abc", "heic")).toBe(`${A}/abc.jpg`);
    // Separators and dots are stripped, never passed into the path.
    expect(verificationDocPath(A, "abc", "p/n..g")).toBe(`${A}/abc.png`);
    expect(verificationDocPath(A, "abc", "../x")).toBe(`${A}/abc.jpg`);
    expect(verificationDocPath(A, "abc", "webp")).toBe(`${A}/abc.webp`);
  });

  it("classifies private paths and legacy public URLs the way the 0314 CHECK does", () => {
    expect(classifyDocRef(`${A}/x.jpg`)).toEqual({ kind: "private", path: `${A}/x.jpg` });
    expect(classifyDocRef("https://p.supabase.co/storage/v1/object/public/store-assets/verifications/a.jpg"))
      .toMatchObject({ kind: "legacy-url" });
    for (const bad of [
      null,
      "",
      `verifications/${A}/x.jpg`, // the old folder shape
      `${A}/`,
      `${A}/../${B}/x.jpg`,
      `/${A}/x.jpg`,
      "javascript:alert(1)",
      "data:image/png;base64,xx",
      "not-a-uuid/x.jpg",
    ]) {
      expect(classifyDocRef(bad)).toBeNull();
    }
  });

  it("knows which store a path belongs to", () => {
    expect(docPathBelongsTo(`${A}/x.jpg`, A)).toBe(true);
    expect(docPathBelongsTo(`${A}/x.jpg`, B)).toBe(false);
    expect(docPathBelongsTo("https://x/y.jpg", A)).toBe(false);
  });

  it("signs private paths in one call, passes legacy URLs through, skips junk", async () => {
    const lifetimes: number[] = [];
    const createSignedUrls = vi.fn(async (paths: string[], seconds: number) => {
      lifetimes.push(seconds);
      return {
        data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}?t=1`, error: null })),
        error: null,
      };
    });
    const client = {
      storage: { from: vi.fn(() => ({ createSignedUrls })) },
    } as unknown as SupabaseClient;
    const legacy = "https://p.supabase.co/storage/v1/object/public/store-assets/a.jpg";
    const urls = await resolveDocUrls(client, [`${A}/x.jpg`, `${A}/x.jpg`, legacy, "junk", null]);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0][0]).toEqual([`${A}/x.jpg`]);
    // Short-lived: minutes, not the hours a forwarded link would stay useful.
    expect(lifetimes).toEqual([600]);
    expect(docUrlFor(urls, `${A}/x.jpg`)).toBe(`https://signed/${A}/x.jpg?t=1`);
    expect(docUrlFor(urls, legacy)).toBe(legacy);
    expect(docUrlFor(urls, "junk")).toBeNull();
  });

  it("a missing bucket (before 0314) yields no links, not a crash", async () => {
    const client = {
      storage: { from: () => ({ createSignedUrls: async () => { throw new Error("Bucket not found"); } }) },
    } as unknown as SupabaseClient;
    const urls = await resolveDocUrls(client, [`${A}/x.jpg`]);
    expect(urls.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// order-staff-note.ts (P2-PRIV-04)
// ---------------------------------------------------------------------------
describe("order staff notes", () => {
  it("cleans and caps the note", () => {
    expect(cleanStaffNote("  gift wrap ")).toBe("gift wrap");
    expect(cleanStaffNote("   ")).toBeNull();
    expect(cleanStaffNote(null)).toBeNull();
    expect(cleanStaffNote("x".repeat(STAFF_NOTE_MAX + 5))?.length).toBe(STAFF_NOTE_MAX);
  });

  it("prefers the staff-notes table, falls back to the legacy column", () => {
    const table = new Map([["o1", "from table"]]);
    expect(pickStaffNote(table, "o1", "legacy")).toBe("from table");
    expect(pickStaffNote(table, "o2", " legacy ")).toBe("legacy");
    expect(pickStaffNote(table, "o3", null)).toBeNull();
  });

  it("recognises a missing table", () => {
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "42501" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });

  function noteClient(tableError: unknown, legacyError: unknown = null) {
    const calls: string[] = [];
    const client = {
      from: (t: string) => ({
        upsert: async (row: unknown, opts: unknown) => {
          calls.push(`${t}.upsert ${JSON.stringify(row)} ${JSON.stringify(opts)}`);
          return { error: tableError };
        },
        delete: () => ({
          eq: async () => {
            calls.push(`${t}.delete`);
            return { error: tableError };
          },
        }),
        update: (patch: unknown) => ({
          eq: async () => {
            calls.push(`${t}.update ${JSON.stringify(patch)}`);
            return { error: legacyError };
          },
        }),
      }),
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it("after 0314: upserts into order_staff_notes, never touches orders", async () => {
    const { client, calls } = noteClient(null);
    expect(await saveStaffNote(client, { orderId: "o", storeId: "s", note: " hi " })).toBe(true);
    expect(calls).toEqual([
      'order_staff_notes.upsert {"order_id":"o","store_id":"s","note":"hi"} {"onConflict":"order_id"}',
    ]);
  });

  it("an empty note deletes it", async () => {
    const { client, calls } = noteClient(null);
    expect(await saveStaffNote(client, { orderId: "o", storeId: "s", note: "  " })).toBe(true);
    expect(calls).toEqual(["order_staff_notes.delete"]);
  });

  it("before 0314: falls back to orders.store_note", async () => {
    const { client, calls } = noteClient({ code: "PGRST205" });
    expect(await saveStaffNote(client, { orderId: "o", storeId: "s", note: "hi" })).toBe(true);
    expect(calls[1]).toBe('orders.update {"store_note":"hi"}');
  });

  it("a refusal (not a missing table) is reported, not bypassed through the old column", async () => {
    const { client, calls } = noteClient({ code: "42501" });
    expect(await saveStaffNote(client, { orderId: "o", storeId: "s", note: "hi" })).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// market-crosspost.ts (P2-MARKET-CROSSPOST)
// ---------------------------------------------------------------------------
describe("Sunday Market cross-post", () => {
  const base = {
    sellerId: "u",
    storeId: "s",
    categoryId: "cat",
    title: " Phone ",
    description: "  ",
    price: 100,
    discountPrice: null,
    images: ["a.jpg", null, "", "b.jpg"],
  };

  it("refuses a listing without a category (the listing form requires one)", () => {
    expect(buildCrossPostListing({ ...base, categoryId: "" })).toEqual({ ok: false, reason: "category" });
    expect(buildCrossPostListing({ ...base, categoryId: null })).toEqual({ ok: false, reason: "category" });
    expect(buildCrossPostListing({ ...base, categoryId: "  " })).toEqual({ ok: false, reason: "category" });
  });

  it("refuses an empty title", () => {
    expect(buildCrossPostListing({ ...base, title: "  " })).toEqual({ ok: false, reason: "title" });
  });

  it("builds a pending listing with the category, trimmed text and real images", () => {
    const r = buildCrossPostListing(base);
    expect(r).toEqual({
      ok: true,
      listing: {
        seller_id: "u",
        store_id: "s",
        category_id: "cat",
        title: "Phone",
        description: null,
        price: 100,
        images: ["a.jpg", "b.jpg"],
        status: "pending",
      },
    });
  });

  it("lists the discounted price when there is one, as before", () => {
    const r = buildCrossPostListing({ ...base, discountPrice: 80 });
    expect(r.ok && r.listing.price).toBe(80);
    const z = buildCrossPostListing({ ...base, discountPrice: 0 });
    expect(z.ok && z.listing.price).toBe(100);
    const n = buildCrossPostListing({ ...base, price: Number.NaN });
    expect(n.ok && n.listing.price).toBe(0);
  });
});
