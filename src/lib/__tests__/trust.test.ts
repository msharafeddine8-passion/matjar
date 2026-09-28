import { describe, it, expect } from "vitest";
import {
  resolveStoreTrust,
  resolveProfessionalTrust,
  resolvePaidStatus,
  trustAnchor,
  paidAnchor,
  TRUST_KINDS,
} from "@/lib/trust";
import type { ProfessionalTrust } from "@/lib/professional";

const kinds = (signals: { kind: string }[]) => signals.map((s) => s.kind);

describe("resolveStoreTrust — no signal without an admin-reviewed column", () => {
  it("emits nothing for an unverified store (today's 15 stores)", () => {
    expect(
      resolveStoreTrust({
        isVerified: false,
        commercialRegVerified: false,
        verifications: [],
      }),
    ).toEqual([]);
    expect(resolveStoreTrust({})).toEqual([]);
    expect(
      resolveStoreTrust({ commercialRegVerified: null, verifications: null }),
    ).toEqual([]);
  });

  it("ignores stores.is_verified — a toggle nobody can say the meaning of", () => {
    expect(resolveStoreTrust({ isVerified: true })).toEqual([]);
    expect(
      resolveStoreTrust({ isVerified: true, commercialRegVerified: false }),
    ).toEqual([]);
  });

  it("emits registration only for commercial_reg_verified", () => {
    expect(kinds(resolveStoreTrust({ commercialRegVerified: true }))).toEqual([
      "registration",
    ]);
  });

  it("emits documents only for a `verified` store_verifications row", () => {
    expect(
      resolveStoreTrust({ verifications: [{ status: "submitted" }] }),
    ).toEqual([]);
    expect(
      resolveStoreTrust({ verifications: [{ status: "rejected" }] }),
    ).toEqual([]);
    expect(
      kinds(
        resolveStoreTrust({
          verifications: [{ status: "rejected" }, { status: "verified" }],
        }),
      ),
    ).toEqual(["documents"]);
  });

  it("carries the latest review date when the rows have one", () => {
    const [sig] = resolveStoreTrust({
      verifications: [
        { status: "verified", reviewed_at: "2026-01-01T00:00:00Z" },
        { status: "verified", reviewed_at: "2026-03-01T00:00:00Z" },
        { status: "submitted", reviewed_at: "2026-09-01T00:00:00Z" },
      ],
    });
    expect(sig).toEqual({ kind: "documents", verifiedAt: "2026-03-01T00:00:00Z" });
  });

  it("accepts the precomputed boolean, but the rows win when both are given", () => {
    expect(kinds(resolveStoreTrust({ hasVerifiedDocument: true }))).toEqual([
      "documents",
    ]);
    expect(resolveStoreTrust({ hasVerifiedDocument: false })).toEqual([]);
    expect(
      resolveStoreTrust({
        hasVerifiedDocument: true,
        verifications: [{ status: "submitted" }],
      }),
    ).toEqual([]);
  });

  it("orders registration before documents", () => {
    expect(
      kinds(
        resolveStoreTrust({
          commercialRegVerified: true,
          verifications: [{ status: "verified" }],
        }),
      ),
    ).toEqual(["registration", "documents"]);
  });

  it("never lets a plan into the trust array (the input has no plan field)", () => {
    const input = {
      plan: "business",
      isVerified: true,
      commercialRegVerified: false,
      verifications: [],
    };
    expect(resolveStoreTrust(input)).toEqual([]);
  });
});

describe("resolveProfessionalTrust", () => {
  it("emits nothing for an unreviewed professional", () => {
    expect(resolveProfessionalTrust({})).toEqual([]);
    expect(resolveProfessionalTrust({ identityVerified: false })).toEqual([]);
  });

  it("maps the admin review flag to identity, with its date", () => {
    expect(
      resolveProfessionalTrust({
        identityVerified: true,
        verifiedAt: "2026-05-05T10:00:00Z",
      }),
    ).toEqual([{ kind: "identity", verifiedAt: "2026-05-05T10:00:00Z" }]);
  });

  it("ignores pro, phone and credential — nothing in the repo sets them", () => {
    const input: ProfessionalTrust = {
      pro: true,
      phoneVerified: true,
      credentialVerified: true,
    };
    expect(resolveProfessionalTrust(input)).toEqual([]);
  });

  it("maps businessRegistered to registration", () => {
    expect(
      kinds(
        resolveProfessionalTrust({
          businessRegistered: true,
          identityVerified: true,
        }),
      ),
    ).toEqual(["registration", "identity"]);
  });
});

describe("resolvePaidStatus — a different type from trust", () => {
  it("free is not paid and shows no marker", () => {
    expect(resolvePaidStatus("free")).toEqual({
      paid: false,
      tier: "free",
      showsProMarker: false,
    });
    expect(resolvePaidStatus(null)).toMatchObject({ paid: false });
    expect(resolvePaidStatus(undefined)).toMatchObject({ paid: false });
  });

  it("basic is paid but does not show the Pro marker", () => {
    expect(resolvePaidStatus("basic")).toEqual({
      paid: true,
      tier: "basic",
      showsProMarker: false,
    });
  });

  it("pro and business show the marker", () => {
    expect(resolvePaidStatus("pro").showsProMarker).toBe(true);
    expect(resolvePaidStatus("business").showsProMarker).toBe(true);
  });

  it("has no field that could be mistaken for a trust kind", () => {
    const keys = Object.keys(resolvePaidStatus("pro"));
    for (const k of TRUST_KINDS) expect(keys).not.toContain(k);
    expect(keys).not.toContain("verified");
  });
});

describe("anchors", () => {
  it("point at the /trust page, one section per kind", () => {
    expect(trustAnchor("ar", "registration")).toBe("/ar/trust#registration");
    expect(trustAnchor("en", "documents")).toBe("/en/trust#documents");
    expect(paidAnchor("ar")).toBe("/ar/trust#paid");
  });
});
