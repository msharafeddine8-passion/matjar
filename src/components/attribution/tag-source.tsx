"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import {
  attributionForStore,
  currentStore,
  oncePerSession,
} from "@/lib/attribution-client";
import { firstSegment } from "@/lib/attribution";

// Rendered by a confirmation screen, the moment an order or a booking exists.
// Labels the row with where its customer came from (tag_order_source /
// tag_booking_source, migration 0312) and counts transaction_completed.
//
// AFTER placement, on purpose: the checkout RPCs are not touched. Once per
// order / booking per tab session. Every failure — the migration not applied
// yet, offline, a blocked storage — is swallowed: the order already exists
// and is valid without its label, and turning a reporting extra into an error
// on a success screen would be a lie.
//
// Unknown stays unknown: no touch recorded for this store in the last 30 days
// is tagged `unknown` ("no_touch"), never a guess.
export function TagSource(
  props:
    | { kind: "order"; orderId: string | null | undefined; storeId?: string | null }
    | { kind: "booking"; storeId: string },
) {
  const key =
    props.kind === "order" ? `order:${props.orderId ?? ""}` : `booking:${props.storeId}`;

  useEffect(() => {
    try {
      if (props.kind === "order" && !props.orderId) return;
      const surface = firstSegment(location.pathname) === "product" ? "product" : "store";

      if (props.kind === "order") {
        const orderId = props.orderId as string;
        const storeId = props.storeId ?? currentStore()?.id ?? null;
        oncePerSession(`matjar-tagged-order-${orderId}`, () => {
          const a = storeId
            ? attributionForStore(storeId)
            : { source: "unknown" as const, detail: "no_store" };
          void createClient()
            .rpc("tag_order_source", {
              p_order_id: orderId,
              p_source: a.source,
              p_detail: a.detail,
              p_store_id: storeId,
            })
            .then(
              () => {},
              () => {},
            );
          track("transaction_completed", {
            storeId,
            offeringType: "order",
            sourceSurface: surface,
          });
        });
        return;
      }

      const storeId = props.storeId;
      // A booking has no id on the legacy path; the RPC labels the caller's
      // own untagged bookings at this store from the last 15 minutes, so the
      // once-key is per store per minute (a second booking later still tags).
      const minute = Math.floor(Date.now() / 60000);
      oncePerSession(`matjar-tagged-booking-${storeId}-${minute}`, () => {
        const a = attributionForStore(storeId);
        void createClient()
          .rpc("tag_booking_source", {
            p_store_id: storeId,
            p_source: a.source,
            p_detail: a.detail,
          })
          .then(
            () => {},
            () => {},
          );
        track("transaction_completed", {
          storeId,
          offeringType: "booking",
          sourceSurface: surface,
        });
      });
    } catch {
      /* never on a success screen */
    }
    // `key` captures everything the effect reads from props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
