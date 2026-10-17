"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Package, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { ImageUpload } from "@/components/image-upload";
import { fieldClass } from "@/components/ui/field";

const labelClass = "text-sm font-semibold";
import { localized } from "@/lib/i18n-field";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { CardList, CardRow } from "@/components/ui/card";

export type Component = {
  id: string;
  name: string;
  nameEn: string | null;
  price: number;
};
export type BundleRow = {
  id: string;
  name: string;
  nameEn: string | null;
  price: number;
  imageUrl: string | null;
  items: { productId: string; quantity: number }[];
};

const money = (n: number) =>
  n >= 1000 ? `$${n.toLocaleString("en-US")}` : `$${n}`;

// A bundle is just a product (is_bundle=true) plus bundle_items rows pointing at
// the components — so it sells through the normal cart/checkout untouched.
export function BundleManager({
  storeId,
  lang,
  dict,
  components,
  bundles,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  components: Component[];
  bundles: BundleRow[];
}) {
  const router = useRouter();
  const t = dict.merchant.bundles;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // Selected components → quantity.
  const [picks, setPicks] = useState<Record<string, number>>({});

  const byId = new Map(components.map((c) => [c.id, c]));
  const partsTotal = Object.entries(picks).reduce(
    (sum, [id, q]) => sum + (byId.get(id)?.price ?? 0) * q,
    0,
  );
  const priceNum = Number(price) || 0;
  const savings = partsTotal - priceNum;

  function toggle(id: string) {
    setPicks((p) => {
      const next = { ...p };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  }
  function setQty(id: string, q: number) {
    setPicks((p) => ({ ...p, [id]: Math.max(1, q) }));
  }

  function reset() {
    setName("");
    setNameEn("");
    setPrice("");
    setImageUrl(null);
    setPicks({});
  }

  async function save() {
    const chosen = Object.entries(picks);
    if (busy || !name.trim() || priceNum <= 0 || chosen.length < 2) return;
    setBusy(true);
    const supabase = createClient();
    // 1) the bundle product row
    const { data: prod, error: prodErr } = await supabase
      .from("products")
      .insert({
        store_id: storeId,
        name: name.trim(),
        name_en: nameEn.trim() || null,
        price: priceNum,
        image_url: imageUrl,
        is_bundle: true,
        status: "active",
        is_available: true,
      })
      .select("id")
      .single();
    if (prodErr || !prod) {
      setBusy(false);
      notifyError(dict.common.actionFailed);
      return;
    }
    // 2) its component rows
    const rows = chosen.map(([product_id, quantity], i) => ({
      bundle_id: prod.id,
      product_id,
      quantity,
      sort_order: i,
    }));
    const { error: itemsErr } = await supabase
      .from("bundle_items")
      .insert(rows);
    if (itemsErr) {
      // Roll back the half-made bundle. This used to be products.delete(), but
      // products has no DELETE policy, so RLS matched zero rows, returned no
      // error, and left a live, empty bundle on the storefront. Soft-delete is
      // how every other product removal works here (product-row-actions,
      // remove() below), and deleted_at is what every public read filters on.
      // `.select` so a zero-row update (the same silent RLS miss that sank the
      // delete) is seen as a failure instead of passing for success.
      const { data: undone, error: undoErr } = await supabase
        .from("products")
        .update({
          deleted_at: new Date().toISOString(),
          is_available: false,
        })
        .eq("id", prod.id)
        .select("id");
      console.error("[bundle-manager] bundle_items insert failed", itemsErr);
      setBusy(false);
      if (undoErr || !undone?.length) {
        console.error("[bundle-manager] rollback failed", undoErr);
        notifyError(t.itemsFailedOrphan);
        router.refresh();
        return;
      }
      notifyError(t.itemsFailed);
      return;
    }
    setBusy(false);
    notifySuccess(t.created);
    reset();
    setOpen(false);
    router.refresh();
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    // Soft-delete like any product; bundle_items cascade on hard delete but stay
    // harmlessly attached to a hidden bundle here.
    const { error } = await createClient()
      .from("products")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {/* Existing bundles */}
      {bundles.length > 0 ? (
        <CardList>
          {bundles.map((b) => {
            const parts = b.items.reduce(
              (s, it) => s + (byId.get(it.productId)?.price ?? 0) * it.quantity,
              0,
            );
            const save = parts - b.price;
            return (
              <CardRow key={b.id} className="flex items-start gap-3">
                {b.imageUrl ? (
                  <Image
                    src={b.imageUrl}
                    alt=""
                    width={56}
                    height={56}
                    className="h-14 w-14 shrink-0 rounded-xl object-cover"
                    sizes="56px"
                  />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Package className="h-6 w-6" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{localized(b.name, b.nameEn, lang)}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {b.items
                      .map((it) => {
                        const c = byId.get(it.productId);
                        return c
                          ? `${it.quantity}× ${localized(c.name, c.nameEn, lang)}`
                          : null;
                      })
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-1 text-sm font-bold text-primary">
                    {money(b.price)}
                    {save > 0 && (
                      <span className="ms-2 text-xs font-bold text-success">
                        {t.savings.replace("{amount}", money(save))}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(b.id)}
                  aria-label={t.delete}
                  className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:border-danger hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </CardRow>
            );
          })}
        </CardList>
      ) : (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-muted-foreground">
          {t.empty}
        </div>
      )}

      {/* Create */}
      {open ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5">
          <h3 className="font-bold">{t.newTitle}</h3>
          <ImageUpload
            folder={storeId}
            value={imageUrl}
            onChange={setImageUrl}
            label={t.image}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="b_name">
                {t.name}
              </label>
              <input
                id="b_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.namePlaceholder}
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="b_name_en">
                {t.nameEn}
              </label>
              <input
                id="b_name_en"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                dir="ltr"
                className={fieldClass}
              />
            </div>
          </div>

          {/* Component picker */}
          <div>
            <span className={labelClass}>{t.pickItems}</span>
            {components.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t.noComponents}
              </p>
            ) : (
              <div className="mt-1.5 max-h-60 space-y-1.5 overflow-y-auto rounded-xl border border-border p-2">
                {components.map((c) => {
                  const picked = picks[c.id] != null;
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                        picked ? "bg-primary-soft" : ""
                      }`}
                    >
                      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => toggle(c.id)}
                          className="h-4 w-4 accent-primary"
                        />
                        {localized(c.name, c.nameEn, lang)}
                        <span className="text-xs font-normal text-muted-foreground">
                          {money(c.price)}
                        </span>
                      </label>
                      {picked && (
                        <input
                          type="number"
                          min={1}
                          value={picks[c.id]}
                          onChange={(e) => setQty(c.id, Number(e.target.value))}
                          aria-label={t.quantity}
                          className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="b_price">
              {t.price}
            </label>
            <input
              id="b_price"
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              dir="ltr"
              className={fieldClass}
            />
            {partsTotal > 0 && (
              <p className="mt-1.5 text-xs font-semibold text-muted-foreground">
                {t.partsTotal.replace("{amount}", money(partsTotal))}
                {savings > 0 && (
                  <span className="ms-2 text-success">
                    {t.savings.replace("{amount}", money(savings))}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={
                busy ||
                !name.trim() ||
                priceNum <= 0 ||
                Object.keys(picks).length < 2
              }
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {t.save}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              {dict.common.cancel}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t.minTwo}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          {t.newTitle}
        </button>
      )}
    </div>
  );
}
