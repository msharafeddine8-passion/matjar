import { describe, it, expect } from "vitest";
import loader from "@/lib/image-loader";

// The loader stands between every product photo and the customer. It exists
// because Vercel's optimizer started answering 402 for billing reasons and
// shops were rendering broken images; if this ever hands a Supabase object URL
// back unrewritten, that failure comes straight back.

const SB = "https://wesihatopiznatsyfxer.supabase.co";
const OBJ = `${SB}/storage/v1/object/public/store-assets/abc/photo.png`;

describe("image loader", () => {
  it("routes a Supabase public object through Supabase's own resizer", () => {
    const out = loader({ src: OBJ, width: 640, quality: 75 });
    expect(out).toBe(`${SB}/storage/v1/render/image/public/store-assets/abc/photo.png?width=640&resize=contain&quality=75`);
  });

  it("never leaves a Supabase object on the path Vercel would optimize", () => {
    const out = loader({ src: OBJ, width: 384 });
    expect(out).not.toContain("/storage/v1/object/public/");
    expect(out).toContain("/storage/v1/render/image/public/");
  });

  it("keeps the aspect ratio (resize=contain) so Supabase never crops to the original height", () => {
    expect(loader({ src: OBJ, width: 128 })).toContain("resize=contain");
  });

  it("defaults quality to 75 when next/image does not pass one", () => {
    expect(loader({ src: OBJ, width: 256 })).toContain("quality=75");
  });

  it("passes local and static assets through untouched", () => {
    // The logo, the icons, anything under /public: small files, no resize.
    for (const src of ["/logo.png", "/icons/icon-512.png", "https://example.com/x.jpg"]) {
      expect(loader({ src, width: 640, quality: 75 })).toBe(src);
    }
  });

  it("does not produce a second question mark on a URL that has one", () => {
    const out = loader({ src: `${OBJ}?v=2`, width: 640, quality: 75 });
    expect(out.split("?").length - 1).toBe(1);
    expect(out).toContain("v=2");
    expect(out).toContain("width=640");
  });
});
