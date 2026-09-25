"use client";

import { useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

// The merchant's own share of their month: a ready-made sentence with totals
// only (no customer name or number exists in it), sent from THEIR phone via a
// free wa.me link — no API, no cost — or copied for a story or a post.
export function ShareSummary({
  text,
  labels,
}: {
  text: string;
  labels: { shareWa: string; copy: string; copied: string };
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text is on screen to select by hand */
    }
  }

  return (
    <div>
      <p
        dir="auto"
        className="select-all rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm leading-relaxed"
      >
        {text}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "whatsapp" })}
        >
          <MessageCircle className="h-4 w-4" />
          {labels.shareWa}
        </a>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
        >
          <Copy className="h-4 w-4" />
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
    </div>
  );
}
