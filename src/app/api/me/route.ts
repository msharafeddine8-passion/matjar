import { createClient } from "@/lib/supabase/server";
import { loadMe } from "@/lib/data/viewer";
import { ANONYMOUS } from "@/lib/viewer";

// GET /api/me — the signed-in half of the public chrome, in one request.
//
// The (site) layout no longer reads cookies, so its pages can be statically
// rendered and cached. The header/bottom-nav island (components/viewer)
// calls this once after hydration — and only when the browser holds a
// Supabase session cookie, so anonymous visitors never invoke it.
//
// Never cached anywhere: the body is per-user. On any failure it answers
// anonymous, which is exactly the chrome a static page already shows.
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;

export async function GET() {
  try {
    const supabase = await createClient();
    const me = await loadMe(supabase);
    return Response.json(me, { headers: NO_STORE });
  } catch {
    return Response.json(ANONYMOUS, { headers: NO_STORE });
  }
}
