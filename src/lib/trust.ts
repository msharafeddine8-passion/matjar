// The one place that decides what a customer-facing trust badge may say.
//
// Two things used to blur into a single "موثّق" tick: PAID STATUS (a plan the
// merchant bought) and TRUST STATUS (a claim Matjar makes because a person on
// the team reviewed something). They are different promises, and a badge whose
// own subject can purchase it is not evidence. So this module keeps them in two
// functions that share no output type: `resolveStoreTrust` / `resolveProfessionalTrust`
// return `TrustSignal[]`, `resolvePaidStatus` returns a `PaidStatus`, and nothing
// in here ever lets a plan produce a signal.
//
// A signal is only emitted for a column that an admin-reviewed flow writes:
//
//   registration  stores.commercial_reg_verified — the merchant typed a
//                 commercial-registration number in settings; an admin toggles
//                 "وثّق السجل" in admin/stores after looking at it. Manual
//                 review, no registry lookup (admin-stores-client.tsx).
//   documents     store_verifications.status = 'verified' — the merchant
//                 uploaded a licence / certificate / accreditation / award; an
//                 admin opened it in admin/verifications and approved it
//                 (admin-verification-actions.tsx). 'submitted' and 'rejected'
//                 rows never count.
//   identity      craft_providers.verified (set with verified_at by
//                 admin-craft-actions.tsx) and profiles.freelancer_verified
//                 (set_freelancer_verified RPC, super admin only). Both are a
//                 hand review of the account by the team: the app collects no
//                 ID document, which is why the customer copy for this kind
//                 says "reviewed by the Matjar team", not "ID checked".
//
// Deliberately NOT a signal:
//
//   stores.is_verified — a generic admin toggle with no recorded dimension,
//   and (until this change) also written `true` by the plan <select> in
//   admin/stores whenever a paid plan was assigned. Nobody can say what it
//   verified, so no customer badge is rendered from it. The column stays for
//   admin bookkeeping; the resolver ignores it on purpose.
//
//   ProfessionalTrust.phoneVerified / credentialVerified — the type has the
//   fields but no flow in the repo ever sets them (no OTP, no credential
//   upload). Explaining a check the code does not perform would be inventing
//   one, so they are ignored until a real flow exists.

import type { ProfessionalTrust } from "@/lib/professional";
import { hasPlan, planRank, type StorePlan } from "@/lib/plan-tiers";

export type TrustKind = "registration" | "documents" | "identity";

/** Every kind, in the order the badges render and the /trust page lists them. */
export const TRUST_KINDS: readonly TrustKind[] = [
  "registration",
  "documents",
  "identity",
];

export type TrustSignal = {
  kind: TrustKind;
  /** ISO timestamp of the admin decision, when the row carries one. */
  verifiedAt?: string | null;
};

type VerificationRow = {
  status: string;
  reviewed_at?: string | null;
};

export type StoreTrustInput = {
  /** stores.is_verified — accepted so callers can pass the row through, ignored. */
  isVerified?: boolean | null;
  /** stores.commercial_reg_verified */
  commercialRegVerified?: boolean | null;
  /** store_verifications rows for the store (any status). */
  verifications?: ReadonlyArray<VerificationRow> | null;
  /**
   * Precomputed `verifications.some(v => v.status === "verified")` for
   * surfaces that only carry the boolean (the store header). Ignored when
   * `verifications` is supplied.
   */
  hasVerifiedDocument?: boolean | null;
};

export function resolveStoreTrust(input: StoreTrustInput): TrustSignal[] {
  const out: TrustSignal[] = [];
  if (input.commercialRegVerified === true) out.push({ kind: "registration" });

  if (input.verifications) {
    const approved = input.verifications.filter((v) => v.status === "verified");
    if (approved.length) {
      const latest = approved
        .map((v) => v.reviewed_at ?? null)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(-1);
      out.push({ kind: "documents", verifiedAt: latest ?? null });
    }
  } else if (input.hasVerifiedDocument === true) {
    out.push({ kind: "documents" });
  }
  return out;
}

export type ProfessionalTrustInput = Pick<
  ProfessionalTrust,
  "identityVerified" | "businessRegistered"
> & {
  /** craft_providers.verified_at, when the caller has it. */
  verifiedAt?: string | null;
};

export function resolveProfessionalTrust(
  input: ProfessionalTrustInput,
): TrustSignal[] {
  const out: TrustSignal[] = [];
  if (input.businessRegistered === true) out.push({ kind: "registration" });
  if (input.identityVerified === true)
    out.push({ kind: "identity", verifiedAt: input.verifiedAt ?? null });
  return out;
}

// ── Paid status — a separate type on purpose ────────────────────────────────

export type PaidStatus = {
  /** Any tier above free. */
  paid: boolean;
  tier: StorePlan;
  /** Whether the customer-facing "Pro" marker shows (pro and business). */
  showsProMarker: boolean;
};

export function resolvePaidStatus(plan: string | null | undefined): PaidStatus {
  const tier = (plan ?? "free") as StorePlan;
  return {
    paid: planRank(tier) > 0,
    tier,
    showsProMarker: hasPlan(tier, "pro"),
  };
}

/** The anchor on /trust that explains one kind. */
export function trustAnchor(lang: string, kind: TrustKind): string {
  return `/${lang}/trust#${kind}`;
}

/** The anchor on /trust that explains what a paid plan is — and is not. */
export function paidAnchor(lang: string): string {
  return `/${lang}/trust#paid`;
}
