"use client";

import { useRef, type ReactNode } from "react";
import d from "./depth.module.css";

/**
 * Tilts its child toward the pointer and lays a glare over it.
 *
 * A wrapper rather than a change to StoreCard, which is rendered in a dozen
 * places that do not want this. Only hover devices get the effect — `depth.
 * module.css` gates the transform on `(hover: hover)` — so on a phone this is
 * an inert div and the card underneath is exactly what it was.
 */
export function Tilt({ children, className = "" }: { children: ReactNode; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  return (
    <div className={`${d.tiltWrap} ${className}`}>
      <div
        ref={el}
        className={d.tilt}
        onPointerMove={(e) => {
          const n = el.current;
          if (!n || e.pointerType !== "mouse") return;
          const r = n.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          n.style.setProperty("--cy", `${((x - 0.5) * -12).toFixed(2)}deg`);
          n.style.setProperty("--cx", `${((y - 0.5) * 10).toFixed(2)}deg`);
          n.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
          n.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
        }}
        onPointerLeave={() => {
          const n = el.current;
          if (!n) return;
          n.style.removeProperty("--cx");
          n.style.removeProperty("--cy");
        }}
      >
        {children}
        <span className={d.glare} aria-hidden="true" />
      </div>
    </div>
  );
}
