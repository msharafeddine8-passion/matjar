"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { Sparkles, Download, X, Loader2, Share2 } from "lucide-react";
import { formatUsd } from "@/lib/currency";
import type { Dictionary } from "@/i18n/get-dictionary";

// Generates a 1080x1920 Instagram-story image (product photo + price + QR) the
// merchant/customer can download and post — free viral distribution.
export function ProductStoryCard({
  productId,
  name,
  price,
  imageUrl,
  baseUrl,
  dict,
  priceText,
  scanLabel,
}: {
  productId: string;
  name: string;
  price: number;
  imageUrl: string | null;
  baseUrl: string;
  dict: Dictionary;
  /** The price as the offering page words it — "$90", or for an unpriced
   *  service "السعر بعد الاستشارة". Omitted = the formatted number. */
  priceText?: string;
  /** The line under the QR. A service says "scan to book", not "to order". */
  scanLabel?: string;
}) {
  const t = dict.share;
  const priceLine = priceText ?? formatUsd(price);
  const scanLine = scanLabel ?? t.scanToOrder;
  const [busy, setBusy] = useState(false);
  const [png, setPng] = useState<string | null>(null);

  // Share the generated PNG itself (not a link) so it lands directly in WhatsApp
  // Status / Instagram Story via the native share sheet. Falls back to download
  // where file-sharing isn't supported (most desktops).
  async function shareStory() {
    if (!png) return;
    try {
      const blob = await (await fetch(png)).blob();
      const file = new File([blob], `matjar-${productId}.png`, {
        type: "image/png",
      });
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
      };
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch {
      // fall through to download
    }
    const a = document.createElement("a");
    a.href = png;
    a.download = `matjar-${productId}.png`;
    a.click();
  }

  function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function generate() {
    setBusy(true);
    try {
      const W = 1080;
      const H = 1920;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Background gradient (brand blue -> white).
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#1556c2");
      grad.addColorStop(1, "#ffffff");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.direction = "rtl";
      ctx.textAlign = "center";

      // Brand.
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 64px Tajawal, sans-serif";
      ctx.fillText("متجر · Matjar", W / 2, 130);

      // Product image in a rounded white card.
      const cardX = 90;
      const cardY = 220;
      const cardW = W - 180;
      const cardH = 900;
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, cardX, cardY, cardW, cardH, 40);
      ctx.fill();

      const img = imageUrl ? await loadImage(imageUrl) : null;
      if (img) {
        // cover-fit into the card with padding.
        const pad = 40;
        const bx = cardX + pad;
        const by = cardY + pad;
        const bw = cardW - pad * 2;
        const bh = cardH - pad * 2;
        const scale = Math.max(bw / img.width, bh / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.save();
        roundRect(ctx, bx, by, bw, bh, 24);
        ctx.clip();
        ctx.drawImage(img, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
        ctx.restore();
      }

      // Name.
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 60px Tajawal, sans-serif";
      wrapText(ctx, name, W / 2, cardY + cardH + 110, W - 160, 72, 2);

      // Price.
      ctx.fillStyle = "#1556c2";
      ctx.font = "bold 96px Tajawal, sans-serif";
      ctx.fillText(priceLine, W / 2, cardY + cardH + 300);

      // QR to the product page.
      const url = `${baseUrl}/product/${productId}`;
      const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
      const qrImg = await loadImage(qrDataUrl);
      if (qrImg) {
        const qs = 300;
        ctx.drawImage(qrImg, (W - qs) / 2, H - 460, qs, qs);
      }
      ctx.fillStyle = "#334155";
      ctx.font = "600 40px Tajawal, sans-serif";
      ctx.fillText(scanLine, W / 2, H - 90);

      setPng(canvas.toDataURL("image/png"));
    } catch {
      setPng(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={generate}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {t.story}
      </button>

      {png && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPng(null)}
        >
          <div
            className="max-h-[90vh] overflow-y-auto rounded-2xl bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex justify-end">
              <button
                onClick={() => setPng(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Deliberately a raw <img>. `png` is a data URL this component
                just drew on a <canvas> in the browser — there is no remote URL
                for the optimizer to fetch, its dimensions are only known at
                draw time, and the same string is the href of the download link
                below. next/image would round-trip a local blob through /_next/
                image for nothing. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={png} alt="" className="mx-auto max-h-[70vh] rounded-xl" />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={shareStory}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Share2 className="h-4 w-4" />
                {t.shareStory}
              </button>
              <a
                href={png}
                download={`matjar-${productId}.png`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-6 py-3 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
              >
                <Download className="h-4 w-4" />
                {t.download}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}
