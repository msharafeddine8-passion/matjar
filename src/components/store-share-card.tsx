"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Check, Download, MessageCircle, QrCode as QrIcon } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";

// Merchant acquisition/marketing tool: a short store link + printable QR the
// merchant can put on their storefront, receipt, or Instagram story.
export function StoreShareCard({
  code,
  slug,
  baseUrl,
  dict,
}: {
  code: string;
  /** The store's vanity handle (stores.slug): matjarlb.com/<slug> is the link
   *  a merchant would actually say out loud. Falls back to /s/<code>. */
  slug?: string | null;
  baseUrl: string;
  dict: Pick<Dictionary, "share">;
}) {
  const t = dict.share;
  const shortUrl = slug ? `${baseUrl}/${slug}` : `${baseUrl}/s/${code}`;
  const waShare = `https://wa.me/?text=${encodeURIComponent(`${t.waText} ${shortUrl}`)}`;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(shortUrl, { width: 512, margin: 2 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [shortUrl]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <QrIcon className="h-5 w-5 text-primary" />
        {t.title}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">{t.subtitle}</p>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {qr && (
          // Data-URL QR generated client-side; next/image can't optimize it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={t.title}
            width={128}
            height={128}
            className="h-32 w-32 rounded-xl border border-border"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
            <span dir="ltr" className="min-w-0 flex-1 truncate text-sm font-semibold">
              {shortUrl}
            </span>
            <button
              onClick={copy}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-primary transition-colors hover:bg-primary-soft"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? t.copied : t.copy}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={waShare}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success-soft px-4 py-2 text-sm font-bold text-success transition-colors hover:border-success"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              {t.whatsapp}
            </a>
            {qr && (
              <a
                href={qr}
                download={`matjar-${slug || code}.png`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Download className="h-4 w-4" />
                {t.download}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
