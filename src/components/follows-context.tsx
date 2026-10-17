"use client";

import { createContext, useContext } from "react";
import type { FollowState } from "@/lib/viewer";

// ===== Follows: the hearts =====
//
// Static pages (Home is ISR) cannot know whom the viewer follows, so their
// store cards render empty hearts and FavoriteButton fills them in from here.
// The viewer island (components/viewer.tsx) provides it from /api/me
// `followedStoreIds`. One shared state for the whole page, so two cards for the
// same store (it can be in "open now" AND "featured") stay in sync when either
// heart is pressed. Its own context, not part of the viewer state, so a toggle
// re-renders the hearts and not the header — and its own module, so a heart
// does not pull the whole header island into a bundle.

export type FollowsApi = {
  /** null = not known (anonymous, or /api/me has not answered). */
  state: FollowState | null;
  /** Record the viewer's own (un)follow; it wins over any later /api/me. */
  set: (storeId: string, on: boolean) => void;
};

export const FollowsContext = createContext<FollowsApi>({
  state: null,
  set: () => {},
});

/** Outside a ViewerProvider this is { state: null } and hearts fall back to
 *  their server-rendered `favorited`, exactly as before the island existed. */
export function useFollows(): FollowsApi {
  return useContext(FollowsContext);
}
