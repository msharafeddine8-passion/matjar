import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { robotsDisallowList } from "@/lib/seo-rules";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Resource-hungry SEO/AI crawlers hammer the dynamic pages and burn
      // serverless CPU without sending us a single visitor. Search engines
      // that actually matter (Google/Bing) stay fully allowed below.
      {
        userAgent: [
          "AhrefsBot",
          "SemrushBot",
          "MJ12bot",
          "DotBot",
          "PetalBot",
          "Bytespider",
          "DataForSeoBot",
          "BLEXBot",
          // The crawler that drained the masarak credit in August 2026
          // (vercel-cost-guard). The firewall rule is the real block; this is
          // the polite version for when it identifies itself.
          "meta-externalagent",
        ],
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
        // Private, per-user, write and bearer-token surfaces, plus the
        // unbounded query facets. The list lives in lib/seo-rules.ts so the
        // tests can hold it to the rules (every private prefix, both locales).
        disallow: robotsDisallowList(),
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
