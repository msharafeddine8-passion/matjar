// Plain .mjs, not .ts: Hostinger's build servers run a glibc older than 2.29,
// so Next falls back to its wasm SWC, which cannot compile a TypeScript config
// and cannot run Turbopack — hence also `next build --webpack` in package.json.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const isDev = process.env.NODE_ENV === "development";

// ===== Build identity (MP-035) =====
//
// The service worker's cache name used to be the hand-written string
// "matjar-shell-v1", and nothing in the repo ever bumped it. A change to
// offline.html or to the precached shell list therefore never reached anyone
// already carrying v1: their worker kept serving what it had and the `activate`
// sweep found nothing to delete, because the name it was comparing against was
// still v1. The version had been edited exactly zero times since it was written.
//
// So it is derived instead. This one value is both Next's build id and the
// `?v=` on the service-worker script URL (see src/lib/sw.ts), which makes the
// cache name a function of the deploy rather than of somebody remembering.
//
// It has to be DETERMINISTIC WITHIN A BUILD — `next build` evaluates this file
// in several worker processes, and a Date.now()/randomUUID() here would inline
// a different id into different chunks. Hence: the commit, never a clock.
//
//   1. VERCEL_GIT_COMMIT_SHA — set by Vercel on every deployment.
//   2. git HEAD — local builds and any CI with a checkout.
//   3. a hash of src/ and public/ — a checkout without .git (Hostinger may
//      build from one). Same files, same id, so it is still deterministic.
//   4. "dev" — nothing readable; one fixed cache name, as before MP-035.
//
// Redeploying the same commit reuses the same id on purpose: identical code
// should not throw away a warm cache.
function contentHash() {
  const hash = createHash("sha1");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(path).update(readFileSync(path));
    }
  };
  walk("src");
  walk("public");
  return hash.digest("hex").slice(0, 12);
}

function buildIdentity() {
  const vercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercel) return vercel.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    try {
      return contentHash();
    } catch {
      return "dev";
    }
  }
}

const BUILD_ID = buildIdentity();

// Content-Security-Policy. Allow-list built from an actual audit of every
// resource the app loads: self, Supabase (images/auth/rest + realtime wss),
// OpenStreetMap tiles (Leaflet map), Vercel Analytics, data:/blob: (QR + story
// canvas + Leaflet marker), self-hosted fonts. Dev also needs 'unsafe-eval'
// and ws: for Turbopack HMR — production stays without them.
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org`,
  `font-src 'self' data:`,
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com https://va.vercel-scripts.com${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  `worker-src 'self' blob:`,
  `frame-ancestors 'self'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Block the site from being framed (clickjacking).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Stop MIME-type sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Least-privilege browser features (geolocation stays on for "nearest stores").
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Same string on both sides, so "the build id" means one thing: the segment
  // Next stamps into /_next/static/<id>/, and the value the client reads to
  // build the service-worker URL.
  generateBuildId: () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  images: {
    // Supabase resizes its own images; Vercel's optimizer is out of the path.
    // See src/lib/image-loader.ts for the 402 that made this necessary.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "wesihatopiznatsyfxer.supabase.co",
        pathname: "/storage/v1/**",
      },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
