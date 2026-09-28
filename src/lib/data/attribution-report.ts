import type { SupabaseClient } from "@supabase/supabase-js";
import {
  summarizeReport,
  type ReportRowRaw,
  type ReportSummary,
} from "@/lib/attribution";

export type AttributionReport =
  | { ok: true; summary: ReportSummary }
  /** 'denied' — the caller lacks the orders permission (42501).
   *  'missing' — migration 0312 is not applied yet, or anything else failed:
   *  the screen says the report is not available, it never crashes. */
  | { ok: false; reason: "denied" | "missing" };

/**
 * One Beirut month of public.store_attribution_report for a store, read under
 * the caller's own session (the function re-checks staff_can(store,'orders')).
 */
export async function loadAttributionReport(
  supabase: SupabaseClient,
  storeId: string,
  month: string,
): Promise<AttributionReport> {
  try {
    const { data, error } = await supabase.rpc("store_attribution_report", {
      p_store_id: storeId,
      p_month: month,
    });
    if (error) {
      return { ok: false, reason: error.code === "42501" ? "denied" : "missing" };
    }
    return {
      ok: true,
      summary: summarizeReport(Array.isArray(data) ? (data as ReportRowRaw[]) : []),
    };
  } catch {
    return { ok: false, reason: "missing" };
  }
}
