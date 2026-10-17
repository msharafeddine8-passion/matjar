"use client";

import { useEffect, useRef, useState } from "react";
import { waLink } from "@/lib/phone";
import QRCode from "qrcode";
import { Download } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { trackToolUse } from "@/lib/track-tool";

const field =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

type Mode = "store" | "wa" | "text";

// Client-only QR generator (uses the bundled `qrcode` lib — no CDN). Renders to
// a canvas so the merchant can download a print-ready PNG.
export function QrGenerator({ dict }: { dict: Pick<Dictionary, "hub"> }) {
  const t = dict.hub.tools.qr;
  const [mode, setMode] = useState<Mode>("store");
  const [value, setValue] = useState("");
  const [size, setSize] = useState(512);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const encoded =
    mode === "wa"
      ? value.replace(/\D/g, "")
        ? (waLink(value) ?? value)
        : ""
      : value.trim();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!encoded) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    void QRCode.toCanvas(canvas, encoded, { width: size, margin: 1 }).then(() => {
      trackToolUse("qr");
    });
  }, [encoded, size]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas || !encoded) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "qr-matjar.png";
    a.click();
  }

  const modes: { key: Mode; label: string; ph: string }[] = [
    { key: "store", label: t.presetStore, ph: t.placeholder },
    { key: "wa", label: t.presetWa, ph: t.waPlaceholder },
    { key: "text", label: t.presetText, ph: "…" },
  ];
  const ph = modes.find((m) => m.key === mode)!.ph;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                mode === m.key ? "bg-primary text-primary-foreground" : "border border-border bg-surface hover:border-primary"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.content}</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={ph} inputMode={mode === "wa" ? "tel" : "text"} className={field} dir="ltr" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">{t.size}</span>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className={field}>
            <option value={256}>256 px</option>
            <option value={512}>512 px</option>
            <option value={1024}>1024 px</option>
          </select>
        </label>
        <Button onClick={download} disabled={!encoded} leftIcon={<Download className="h-4 w-4" />}>
          {t.download}
        </Button>
      </div>

      <div className="grid place-items-center rounded-2xl border border-border bg-surface-muted/40 p-6">
        {encoded ? (
          <canvas ref={canvasRef} className="h-auto w-full max-w-[280px] rounded-xl bg-white p-3" />
        ) : (
          <p className="text-center text-sm text-muted-foreground">{t.empty}</p>
        )}
      </div>
    </div>
  );
}
