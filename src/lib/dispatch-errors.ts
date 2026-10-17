// request_delivery() / update_delivery_status() (0213) refuse in English
// sentences written for a developer. The dispatch panel used to toast them
// verbatim — an Arabic merchant read "delivery status only moves forward".
// Each known refusal maps to a dictionary key; anything unknown falls back to
// the generic error rather than leaking Postgres text.

export type DispatchErrorKey =
  | "errOrderNotFound"
  | "errNotAllowed"
  | "errPlanRequired"
  | "errCourierUnavailable"
  | "errAlreadyActive"
  | "errTrackingRef"
  | "errRequestNotFound"
  | "errAlreadyDelivered"
  | "errAlreadyCancelled"
  | "errForwardOnly";

// Order matters only where one message contains another; none here do.
const KNOWN: readonly [string, DispatchErrorKey][] = [
  ["delivery request not found", "errRequestNotFound"],
  ["order not found", "errOrderNotFound"],
  ["not allowed", "errNotAllowed"],
  ["requires the pro plan", "errPlanRequired"],
  ["plan_required", "errPlanRequired"],
  ["courier not available", "errCourierUnavailable"],
  ["already has an active delivery request", "errAlreadyActive"],
  ["could not allocate a tracking reference", "errTrackingRef"],
  ["this delivery is already completed", "errAlreadyDelivered"],
  ["this delivery was cancelled", "errAlreadyCancelled"],
  ["delivery status only moves forward", "errForwardOnly"],
];

export function dispatchErrorKey(
  message: string | null | undefined,
): DispatchErrorKey | null {
  const m = (message ?? "").toLowerCase();
  if (!m) return null;
  for (const [needle, key] of KNOWN) if (m.includes(needle)) return key;
  return null;
}
