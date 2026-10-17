"use client";

import { useState } from "react";
import { Share2, MessageCircle, Check } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { share } from "@/lib/native";
import { QUICK_ACTION_BASE, QUICK_ACTION_LABEL } from "@/components/quick-action";

// Shares the current page. WhatsApp is the dominant sharing channel in Lebanon,
// so it gets a dedicated button; the second button uses the native share sheet
// (mobile) or copies the link (desktop).
export function ShareButton({
  title,
  dict,
  url,
  compact = false,
}: {
  title: string;
  dict: Pick<Dictionary, "store">;
  // Preferred share URL (e.g. the store's vanity link). Falls back to the
  // current page when omitted.
  url?: string;
  /** Phone presentation: one icon-only 44px target instead of two buttons.
   *  The dedicated WhatsApp button is dropped below `lg` on purpose — the
   *  native share sheet this opens on a phone already offers WhatsApp first,
   *  so the second button bought a duplicate channel at the price of a slot in
   *  a row that has to fit inside 320px. From `lg` up both are back, unchanged:
   *  a desktop browser has no share sheet, so there the WhatsApp button is the
   *  only way to that channel. */
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = () => url ?? window.location.href;

  function whatsappShare() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${title} ${shareUrl()}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function nativeShareOrCopy() {
    // Native share sheet in the app, Web Share API in the browser, clipboard
    // as a last resort — the helper picks the best available channel.
    const result = await share({ title, url: shareUrl() });
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={whatsappShare}
        aria-label="WhatsApp"
        className={`relative flex h-9 w-9 items-center justify-center rounded-xl bg-whatsapp text-whatsapp-foreground transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-whatsapp-hover ${
          compact ? "hidden lg:flex" : ""
        }`}
      >
        <MessageCircle className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={nativeShareOrCopy}
        aria-label={compact ? dict.store.share : undefined}
        className={`flex items-center gap-1.5 rounded-xl border border-border text-sm font-semibold transition-colors hover:border-primary hover:text-primary ${
          compact ? QUICK_ACTION_BASE : "px-4 py-2"
        }`}
      >
        {copied ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <Share2 className="h-4 w-4" />
        )}
        <span className={compact ? QUICK_ACTION_LABEL : undefined}>
          {copied ? dict.store.copied : dict.store.share}
        </span>
      </button>
    </div>
  );
}
