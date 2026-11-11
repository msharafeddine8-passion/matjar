import { timingSafeEqual } from "node:crypto";
import { adminClientIfConfigured } from "@/lib/supabase/admin";
import { emailContentFor, renderEmail, sendEmail } from "@/lib/email";

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Internal endpoint the DB calls (trigger notifications_email, 0343) for a
// merchant-facing notification: a new order/booking/request, or a reminder
// nudge. Same shared-secret header as /api/push/hook; never called by a browser.
// Service role (caller #5 in lib/supabase/admin.ts): the caller is the database,
// authority is the timing-safe secret, and the surface is one named RPC
// (email_payload) keyed by a notification id.
export async function POST(request: Request) {
  const hookSecret = process.env.PUSH_HOOK_SECRET;
  if (!hookSecret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!secretMatches(request.headers.get("x-push-secret") ?? "", hookSecret)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { notification_id?: string };
  if (!body.notification_id) return Response.json({ error: "bad_request" }, { status: 400 });

  const supabase = adminClientIfConfigured();
  if (!supabase) return Response.json({ error: "not_configured" }, { status: 503 });

  const { data } = await supabase.rpc("email_payload", { p_notification_id: body.notification_id });
  const row = (data as { email: string | null; type: string; data: Record<string, unknown>; opted_out: boolean; user_id: string }[] | null)?.[0];
  if (!row?.email) return Response.json({ sent: 0, reason: "no_email" });

  const content = emailContentFor(row.type, row.data ?? {});
  if (!content) return Response.json({ sent: 0, reason: "not_emailed" });
  if (content.nudge && row.opted_out) return Response.json({ sent: 0, reason: "opted_out" });

  const { html, text } = renderEmail(content, row.user_id);
  const result = await sendEmail(row.email, content.subject, html, text);
  if (result === "sent") {
    // First real delivery switches reminder nudges on (they wait for this so
    // none are spent while no provider is configured).
    await supabase.rpc("email_mark_enabled");
  }
  return Response.json({ sent: result === "sent" ? 1 : 0, result });
}
