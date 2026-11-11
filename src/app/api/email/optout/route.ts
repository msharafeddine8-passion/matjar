import { adminClientIfConfigured } from "@/lib/supabase/admin";
import { optoutTokenValid } from "@/lib/email";

// One-click "stop reminders" link from a nudge e-mail. The HMAC token proves the
// link was issued for this account; order and booking alerts keep coming.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";
  const ok = /^[0-9a-f-]{36}$/i.test(uid) && optoutTokenValid(uid, token);
  const supabase = ok ? adminClientIfConfigured() : null;
  if (supabase) await supabase.rpc("email_optout", { p_uid: uid });

  const msg = supabase
    ? "تمام، وقّفنا التذكيرات. رح تضلّ توصلك إيميلات الطلبات والحجوزات."
    : "الرابط مش صالح أو منتهي.";
  return new Response(
    `<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>متجر</title><body style="font-family:Tahoma,Arial,sans-serif;background:#f5f5f4;margin:0;padding:48px 16px;text-align:center;color:#1c1917"><p style="font-size:18px">${msg}</p><a href="/ar" style="color:#1c1917">رجوع لمتجر</a></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: supabase ? 200 : 400 },
  );
}
