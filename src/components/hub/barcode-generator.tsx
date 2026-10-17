"use client";

import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Download } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { trackToolUse } from "@/lib/track-tool";
import { isValidBarcode } from "@/lib/barcode";

const field =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

// Client-only barcode generator (bundled `jsbarcode`). CODE128 accepts any text;
// EAN-13 needs 12–13 digits. Invalid input is surfaced, never thrown.
export function BarcodeGenerator({ dict }: { dict: Pick<Dictionary, "hub"> }) {
  const t = dict.hub.tools.barcode;
  const [value, setValue] = useState("");
  const [format, setFormat] = useState("CODE128");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const v = value.trim();
  // Derived, not stored: validity is a function of what was typed, so keeping
  // it in state meant a render where the barcode and the error disagreed.
  const invalid = v.length > 0 && !isValidBarcode(v, format);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !v || invalid) return;
    try {
      JsBarcode(canvas, v, {
        format,
        displayValue: true,
        margin: 10,
        height: 80,
        background: "#ffffff",
      });
      trackToolUse("barcode");
    } catch {
      /* isValidBarcode and JsBarcode disagreed; leave the canvas untouched */
    }
  }, [v, format, invalid]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas || !v || invalid) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "barcode-matjar.png";
    a.click();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid content-start gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.format}</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className={field}>
            <option value="CODE128">CODE128</option>
            <option value="EAN13">EAN-13</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.value}</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={format === "EAN13" ? "123456789012" : "MATJAR-001"} className={field} dir="ltr" />
        </label>
        {invalid && v && (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{t.invalid}</p>
        )}
        <Button onClick={download} disabled={!v || invalid} leftIcon={<Download className="h-4 w-4" />}>
          {t.download}
        </Button>
      </div>

      <div className="grid place-items-center rounded-2xl border border-border bg-surface-muted/40 p-6">
        <canvas ref={canvasRef} className={`h-auto w-full max-w-[320px] rounded-xl ${!v || invalid ? "hidden" : "bg-white p-3"}`} />
        {(!v || invalid) && (
          <p className="text-center text-sm text-muted-foreground">{invalid ? t.invalid : t.empty}</p>
        )}
      </div>
    </div>
  );
}
