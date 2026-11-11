import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/config";

// Service-role client. Bypasses RLS completely, so it must never be reachable
// from a browser — hence `server-only`, which turns an accidental client import
// into a build error rather than a leaked key.
//
// ===== Who actually uses this, as of MP-018 =====
//
// This comment used to say it existed "for one job". It did not: there are four
// callers, three of them acting for a request that carries no session at all. A
// comment that understates a security boundary is worse than no comment, because
// the next person reads "one job" and adds a fifth without looking.
//
//   1. app/[lang]/download/[itemId]/route.ts — signs a URL for a file in the
//      private digital-goods bucket. That bucket has no read policy at all,
//      deliberately: "may this person download this" is a question about an
//      ORDER, and RLS on storage.objects cannot see orders. Entitlement is
//      decided FIRST by digital_download_grant() running as the actual caller;
//      only then does this client mint the link. Storage only, no RPC.
//
//   2. api/clock/register/route.ts — enrols one phone against one employee.
//      Every call is RLS-bypassing (clock_store_context, redeem_enrolment_code,
//      enrolment_locked, issue_webauthn_challenge, spend_webauthn_challenge,
//      register_employee_device) because the person holding the phone has no
//      Matjar account — that is the point of the feature. What stands in for a
//      login is the owner's single-use enrolment code, which the database
//      itself rate-limits and expires.
//
//   3. api/clock/punch/route.ts — the punch and the "show me my hours" read.
//      Same absence of a session, same service role. This is also the only
//      caller that touches a TABLE directly rather than a named RPC: it reads
//      employee_devices by credential_id and writes back the signature counter.
//      Note the order — the row is fetched BEFORE the assertion is verified,
//      because the public key in it is what verifies the assertion. Nothing is
//      returned or recorded on that basis; the acting RPCs (clock_by_device,
//      attendance_snapshot) run only after verifyAuthenticationResponse passes
//      and after the device is confirmed to belong to this store.
//
//   4. api/push/hook/route.ts — fans a notification out as Web Push. Called by
//      the database over pg_net, not by a browser, so there is no session to
//      act as; get_push_subs is revoked from anon and authenticated precisely
//      because it hands back another user's push credentials for any uid.
//      Authenticated by a timing-safe comparison against PUSH_HOOK_SECRET.
//
//   5. api/email/hook/route.ts (0343) — e-mails a merchant notification. Same
//      shape as #4: called by the database over pg_net, secret-header
//      authenticated, and it only calls email_payload(notification_id) and
//      email_mark_enabled(), both granted to service_role alone.
//
//   6. api/email/optout/route.ts (0343) — a one-click link from an e-mail; the
//      person may not be signed in. Authority is an HMAC over the user id
//      (PUSH_HOOK_SECRET), checked before email_optout(uid) is called.
//
// ===== The rule for a seventh =====
//
// A new use is a security review, not a convenience. It has to satisfy all
// three of the things the four above have in common:
//
//   • There is genuinely no session that could carry the authority — the caller
//     is the database, or a person with no account by design. If a session
//     exists, use the request-scoped client and let RLS decide. "RLS was in the
//     way" is the reason NOT to do this.
//   • Entitlement is established by something other than RLS, and established
//     before this client acts: a grant function run as the real caller, a
//     single-use code the database rate-limits, a verified WebAuthn assertion,
//     a timing-safe secret. Not "the route is internal".
//   • The privileged surface is narrow and named — a specific RPC, one storage
//     path, one row looked up by a key the request then has to prove it owns.
//     Never a general table query whose filter comes from the request body.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The same client, for callers that would rather answer than crash.
//
// A missing key is a deployment problem, not a request problem, and throwing it
// out of a route handler produces a 500 with an empty body. The browser then
// fails to parse the response and falls into whatever generic catch it has, so
// an employee holding a valid code is told the code is wrong — and the one fact
// that would have explained it never reaches anyone. Clock-in was down in
// production for exactly this reason, and it read as three different bugs.
export function adminClientIfConfigured() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
}
