"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import {
  mergeCart,
  parseCart,
  planReorder,
  type ReorderLine,
  type ReorderPlan,
} from "@/lib/activity";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Money } from "@/components/ui/money";

export type ActivityCopy = Dictionary["activityCenter"];

type ItemRow = {
  product_id: string | null;
  variant_id: string | null;
  name: string;
  unit_price: number | string;
  quantity: number;
  products: {
    name: string;
    price: number | string;
    discount_price: number | string | null;
    flash_price: number | string | null;
    flash_start: string | null;
    flash_end: string | null;
    stock: number | null;
    status: string;
    is_available: boolean | null;
    deleted_at: string | null;
    item_kind: string | null;
    product_variants: { id: string }[] | null;
  } | null;
};

const num = (v: number | string | null | undefined) =>
  v == null || v === "" ? null : Number(v);

function toLines(rows: ItemRow[]): ReorderLine[] {
  return rows.map((r) => ({
    productId: r.product_id,
    variantId: r.variant_id,
    name: r.name,
    unitPrice: Number(r.unit_price) || 0,
    quantity: r.quantity,
    product: r.products
      ? {
          name: r.products.name,
          price: Number(r.products.price) || 0,
          discountPrice: num(r.products.discount_price),
          flashPrice: num(r.products.flash_price),
          flashStart: r.products.flash_start,
          flashEnd: r.products.flash_end,
          stock: r.products.stock,
          status: r.products.status,
          isAvailable: r.products.is_available !== false,
          deletedAt: r.products.deleted_at,
          itemKind: r.products.item_kind,
          hasVariants: (r.products.product_variants ?? []).length > 0,
        }
      : null,
  }));
}

/**
 * "Order the same again", honestly.
 *
 * Reads the past order's lines and the products AS THEY ARE NOW in one query
 * (order_items is readable by the order's customer, products by anyone while
 * they are listed), plans what can go back with planReorder(), and SHOWS the
 * plan before touching the cart: what changed price, what was lowered to the
 * stock, what cannot come back and why. Confirming merges into the store's
 * existing cart — it never replaces it — and opens the store, where the
 * customer still reviews and places the order themselves. Nothing is ordered
 * from here.
 */
export function ReorderSheet({
  open,
  onClose,
  orderId,
  storeId,
  storeName,
  lang,
  copy,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  storeId: string;
  storeName: string;
  lang: string;
  copy: ActivityCopy;
  closeLabel: string;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<ReorderPlan | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const { data, error } = await createClient()
        .from("order_items")
        .select(
          "product_id, variant_id, name, unit_price, quantity, products(name, price, discount_price, flash_price, flash_start, flash_end, stock, status, is_available, deleted_at, item_kind, product_variants(id))",
        )
        .eq("order_id", orderId);
      if (!alive) return;
      if (error) {
        setFailed(true);
        return;
      }
      setPlan(planReorder(toLines((data ?? []) as unknown as ItemRow[])));
    })();
    return () => {
      alive = false;
    };
  }, [open, orderId]);

  function confirm() {
    if (!plan) return;
    const key = `matjar-cart-${storeId}`;
    try {
      const merged = mergeCart(parseCart(localStorage.getItem(key)), plan.add);
      localStorage.setItem(key, JSON.stringify(merged));
    } catch {
      /* storage blocked: the store page still opens */
    }
    router.push(`/${lang}/store/${storeId}`);
  }

  const canAdd = plan != null && plan.kept.length > 0;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={copy.reorderTitle.replace("{store}", storeName)}
      closeLabel={closeLabel}
      footer={
        plan ? (
          canAdd ? (
            <button
              type="button"
              onClick={confirm}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              {copy.reorderConfirm}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push(`/${lang}/store/${storeId}`)}
              className="flex h-12 w-full items-center justify-center rounded-xl border border-border px-5 text-sm font-bold"
            >
              {copy.reorderOpenStore}
            </button>
          )
        ) : undefined
      }
    >
      {failed ? (
        <p role="alert" className="py-6 text-center text-sm text-danger">
          {copy.reorderError}
        </p>
      ) : !plan ? (
        <p className="py-6 text-center text-sm text-muted-foreground" aria-live="polite">
          {copy.reorderChecking}
        </p>
      ) : (
        <div className="space-y-4 pb-2">
          {plan.kept.length === 0 ? (
            <p className="text-sm font-semibold">{copy.reorderNothing}</p>
          ) : (
            <>
              {plan.priceChanged > 0 && (
                <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">
                  {copy.reorderPriceChanged.replace("{n}", String(plan.priceChanged))}
                </p>
              )}
              <ul className="divide-y divide-border rounded-xl border border-border">
                {plan.kept.map((k) => {
                  const moved = Math.abs(k.now - k.was) >= 0.005;
                  return (
                    <li key={k.productId} className="flex items-start justify-between gap-3 p-3">
                      <span className="min-w-0">
                        <span dir="auto" className="block truncate text-sm font-bold">
                          {k.name}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                          ×{k.quantity}
                        </span>
                        {k.reduced && (
                          <span className="ms-2 text-xs font-semibold text-warning">
                            {copy.reorderReduced}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-end text-sm">
                        {moved && (
                          <span className="block text-xs text-muted-foreground line-through">
                            <span className="sr-only">{copy.reorderWas} </span>
                            <Money value={k.was} />
                          </span>
                        )}
                        <span className={`block font-bold ${moved ? "text-warning" : ""}`}>
                          {moved && <span className="sr-only">{copy.reorderNow} </span>}
                          <Money value={k.now} />
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="flex items-center justify-between text-sm font-bold">
                {copy.reorderTotalNow}
                <Money value={plan.nowTotal} />
              </p>
              <p className="text-xs text-muted-foreground">{copy.reorderKeepsCart}</p>
            </>
          )}

          {plan.dropped.length > 0 && (
            <div>
              <p className="text-sm font-bold">{copy.reorderDroppedTitle}</p>
              <ul className="mt-2 space-y-1.5">
                {plan.dropped.map((d, i) => (
                  <li
                    key={`${d.productId ?? "x"}-${i}`}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    {d.reason === "hasOptions" && d.productId ? (
                      <Link
                        href={`/${lang}/product/${d.productId}`}
                        dir="auto"
                        className="min-w-0 truncate font-semibold text-primary underline"
                      >
                        {d.name}
                      </Link>
                    ) : (
                      <span dir="auto" className="min-w-0 truncate font-semibold">
                        {d.name}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {copy[`drop_${d.reason}`]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
