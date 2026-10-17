"use client";
import { notifyError } from "@/lib/notify";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Package, Check, Boxes } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";

export type InventoryProduct = {
  id: string;
  name: string;
  image_url: string | null;
  stock: number | null;
  low_stock_threshold: number;
};

export type Movement = {
  id: string;
  delta: number;
  reason: "sale" | "adjustment" | "purchase" | "return";
  created_at: string;
  products: { name: string } | null;
};

// Inventory module of the Business OS: stock levels at a glance with color
// state (out / low / ok / untracked) and inline absolute-quantity adjustment.
// Every change goes through the adjust_stock RPC so the movement ledger stays
// complete.
export function InventoryManager({
  lang,
  dict,
  products,
  movements,
  branchCount,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "auth" | "os">;
  products: InventoryProduct[];
  movements: Movement[];
  /** How many branches this store has. ISS-023: every number on this screen is
   *  store-wide, never per-branch, and this is the screen where the opposite
   *  belief would otherwise form. Said out loud once the store has two. */
  branchCount: number;
}) {
  const router = useRouter();
  const t = dict.os.inventory;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function save(p: InventoryProduct) {
    const raw = drafts[p.id];
    if (raw == null || raw.trim() === "") return;
    const qty = Math.max(0, Math.floor(Number(raw)));
    if (Number.isNaN(qty)) return;
    setBusy(p.id);
    const { error } = await createClient().rpc("adjust_stock", {
      p_product: p.id,
      p_qty: qty,
    });
    setBusy(null);
    if (error) {
      notifyError(dict.auth.errorGeneric);
      return;
    }
    setSavedId(p.id);
    setTimeout(() => setSavedId(null), 1500);
    setDrafts((d) => {
      const { [p.id]: _gone, ...rest } = d;
      void _gone;
      return rest;
    });
    router.refresh();
  }

  const badge = (p: InventoryProduct) => {
    if (p.stock == null)
      return (
        <Badge variant="neutral" size="sm">
          {t.untracked}
        </Badge>
      );
    if (p.stock <= 0)
      return (
        <Badge variant="danger" size="sm">
          {t.out}
        </Badge>
      );
    if (p.stock <= p.low_stock_threshold)
      return (
        <Badge variant="warning" size="sm" className="tabular-nums">
          {t.low} · {p.stock}
        </Badge>
      );
    return (
      <Badge variant="success" size="sm" className="tabular-nums">
        {t.inStock} · {p.stock}
      </Badge>
    );
  };

  const lowOnes = products.filter(
    (p) => p.stock != null && p.stock <= p.low_stock_threshold,
  );

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar-LB-u-nu-latn" : "en-GB", {
      timeZone: "Asia/Beirut",
      month: "short",
      day: "numeric",
    });

  const row = (p: InventoryProduct) => (
    <div
      key={p.id}
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3"
    >
      {p.image_url ? (
        <Image
          src={p.image_url}
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 shrink-0 rounded-lg object-cover"
          sizes="44px"
        />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
          <Package className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1 font-semibold">{p.name}</span>
      {badge(p)}
      {/* Below lg the adjust controls claim their own line. Sharing one 360px
          row with the thumbnail, name and badge left the name about forty
          pixels wide — and the name is the field the merchant scans to find
          the product they are holding. Name + stock badge stay on top; the
          controls that act on them sit underneath at full width. */}
      <div className="flex w-full items-center gap-2 lg:w-auto lg:gap-1.5">
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={drafts[p.id] ?? ""}
          onChange={(e) =>
            setDrafts((d) => ({ ...d, [p.id]: e.target.value }))
          }
          placeholder={p.stock == null ? t.qty : String(p.stock)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm tabular-nums outline-none focus:border-primary lg:h-auto lg:w-20 lg:flex-none lg:px-2.5 lg:py-1.5"
        />
        <Button
          type="button"
          size="sm"
          loading={busy === p.id}
          disabled={!(drafts[p.id] ?? "").trim()}
          onClick={() => save(p)}
          className="h-11 shrink-0 lg:h-9"
        >
          {savedId === p.id ? <Check className="h-4 w-4" /> : t.save}
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      {branchCount > 1 && (
        <p className="mb-4 flex items-start gap-2 rounded-2xl border border-border bg-surface-muted/40 p-3 text-sm text-muted-foreground">
          <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {dict.os.branches.stockShared}
        </p>
      )}

      {lowOnes.length > 0 && (
        <section className="rounded-2xl border border-warning/30 bg-warning-soft p-4">
          <h2 className="font-bold text-warning">{t.lowTitle}</h2>
          <div className="mt-3 space-y-2">{lowOnes.map(row)}</div>
        </section>
      )}

      {products.length ? (
        <div className={`space-y-2 ${lowOnes.length ? "mt-6" : ""}`}>
          {products.filter((p) => !lowOnes.includes(p)).map(row)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
          {t.empty}
        </div>
      )}

      {movements.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {t.movements}
          </h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
            {movements.map((m, i) => (
              <div
                key={m.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm lg:flex-nowrap ${i > 0 ? "border-t border-border" : ""}`}
              >
                <span
                  className={`w-12 shrink-0 text-center font-extrabold tabular-nums ${
                    m.delta < 0 ? "text-danger" : "text-success"
                  }`}
                  dir="ltr"
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {m.products?.name ?? "—"}
                </span>
                {/* Four columns on a 360px row truncated the product name to a
                    word or two, so reason and date drop to a second line
                    indented under it (w-12 + gap-3). lg:contents dissolves this
                    wrapper above the breakpoint, leaving the desktop row's flex
                    children exactly as they were. */}
                <span className="flex w-full items-center gap-3 ps-[3.75rem] lg:contents">
                  <span className="shrink-0 text-muted-foreground">
                    {t.reasons[m.reason]}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtDate(m.created_at)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
