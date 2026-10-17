import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

// Refreshes the Supabase auth session on each request and forwards the
// updated cookies. Called from proxy.ts (Next.js 16, nodejs runtime).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No Supabase auth cookie = nobody to refresh. Skipping the round-trip for
  // signed-out visitors and bots removes most /auth/v1/user calls (2,009 a day,
  // nearly all of them for requests that had no session at all).
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) {
    return response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}
