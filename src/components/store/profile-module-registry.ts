import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

// Slots in the business-profile engine that are owned by another feature.
//
// `loyalty` is reserved in the engine's module order (src/lib/sectors.ts,
// src/lib/profile-engine.ts) so the loyalty / gift-card work can put its public
// block on the storefront without touching the page or the engine: register a
// renderer here and the module becomes present for real stores, in the
// position each sector's composition gives it. Until something is registered
// the slot renders nothing and does not appear in the section tabs — an empty
// «برنامج الولاء» heading is exactly the placeholder the engine exists to stop.
//
// The renderer receives only public, non-personal facts. A per-viewer balance
// must be fetched by the registered component itself, on the request-scoped
// client, so it can never end up in a cached render.

export type ProfileSlotProps = {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  /** stores.loyalty_redemption_enabled */
  loyaltyRedemptionEnabled: boolean;
  /** stores.loyalty_points_per_unit */
  loyaltyPointsPerUnit: number | null;
  signedIn: boolean;
};

export type ProfileSlotRenderer = (props: ProfileSlotProps) => ReactNode;

export type ProfileSlotKey = "loyalty";

export const PROFILE_MODULE_SLOTS: Partial<
  Record<ProfileSlotKey, ProfileSlotRenderer>
> = {};
