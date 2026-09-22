"use client";

import { useEffect, useRef } from "react";
import s from "./mark-3d.module.css";

/**
 * The brand mark with volume, and the hand that turns it.
 *
 * Decorative: `aria-hidden`, no text a reader needs. The sector words on the
 * floating chips are repeated by the gateway tiles directly below, which are
 * the real links.
 *
 * Three inputs move it, in this order of preference:
 *  - pointer over the stage (desktop): rotate toward the cursor
 *  - device orientation (phone): rotate with the hand. Android fires this
 *    without asking; iOS 13+ needs a permission that can only be requested
 *    from a user gesture, so the stage requests it on first tap and does
 *    nothing on iOS until then.
 *  - otherwise a slow idle orbit, so it never sits dead.
 *
 * `prefers-reduced-motion` switches all three off and leaves the mark at rest.
 */
export function Mark3D({
  chips,
  className = "",
}: {
  /** Four short sector words, in this order: food, health, shopping, crafts. */
  chips: [string, string, string, string];
  className?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const st = stage.current;
    const sc = scene.current;
    if (!st || !sc) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      sc.classList.remove(s.idle);
      return;
    }

    let idleTimer: number | undefined;
    const set = (rx: number, ry: number) => {
      sc.classList.remove(s.idle);
      sc.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      sc.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
    };
    const poke = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        sc.style.removeProperty("--rx");
        sc.style.removeProperty("--ry");
        sc.classList.add(s.idle);
      }, 2200);
    };

    const onPointer = (e: PointerEvent) => {
      const r = st.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      set(-y * 18, x * 26);
      poke();
    };

    let base: { b: number; g: number } | null = null;
    const onOri = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      const rx = Math.max(-16, Math.min(16, (e.beta - base.b) * 0.6));
      const ry = Math.max(-22, Math.min(22, (e.gamma - base.g) * 0.8));
      set(-rx, ry);
      poke();
    };

    st.addEventListener("pointermove", onPointer);

    type DOE = typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    const DO = window.DeviceOrientationEvent as DOE | undefined;
    let armed = false;
    const askIOS = () => {
      DO?.requestPermission?.()
        .then((r) => {
          if (r === "granted") window.addEventListener("deviceorientation", onOri);
        })
        .catch(() => {});
    };
    if (DO) {
      if (typeof DO.requestPermission === "function") {
        st.addEventListener("click", askIOS, { once: true });
      } else {
        window.addEventListener("deviceorientation", onOri);
        armed = true;
      }
    }

    return () => {
      st.removeEventListener("pointermove", onPointer);
      st.removeEventListener("click", askIOS);
      if (armed) window.removeEventListener("deviceorientation", onOri);
      window.clearTimeout(idleTimer);
    };
  }, []);

  return (
    <div ref={stage} className={`${s.stage} ${className}`} aria-hidden="true">
      <div ref={scene} className={`${s.scene} ${s.idle}`}>
        <div className={`${s.layer} ${s.ground}`} />
        <div className={`${s.layer} ${s.body}`}>
          <div className={s.side} />
          <div className={s.face}>
            <span className={s.m}>M</span>
          </div>
        </div>
        <div className={`${s.layer} ${s.awning}`}>
          <span />
          <span />
          <span />
        </div>
        <div className={`${s.layer} ${s.dot}`} />
        <div className={`${s.layer} ${s.chip} ${s.c1} text-tint-2`}>
          <i />
          <span className="text-foreground">{chips[0]}</span>
        </div>
        <div className={`${s.layer} ${s.chip} ${s.c2} text-tint-4`}>
          <i />
          <span className="text-foreground">{chips[1]}</span>
        </div>
        <div className={`${s.layer} ${s.chip} ${s.c3} text-tint-6`}>
          <i />
          <span className="text-foreground">{chips[2]}</span>
        </div>
        <div className={`${s.layer} ${s.chip} ${s.c4} text-tint-7`}>
          <i />
          <span className="text-foreground">{chips[3]}</span>
        </div>
      </div>
    </div>
  );
}
