"use client";

import { useEffect } from "react";
import { SW_URL } from "@/lib/sw";

// Register the service worker for everyone, not only people who accept
// notifications.
//
// It used to register inside the push opt-in, so most visitors never had one at
// all — which also meant Chrome's install criteria were never met and "Add to
// Home Screen" was never offered. Push still works exactly as before; it just
// no longer owns whether the worker exists.
//
// Registration is deferred to the load event so it never competes with the
// first paint on a slow phone.
export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    // Dev chunks keep the same URL across edits, and the worker serves
    // /_next/static cache-first — so in `next dev` it pins yesterday's code
    // and edits silently never arrive. Production chunk URLs are content-
    // hashed, which is what makes cache-first safe there. In dev, retire any
    // worker a previous session installed instead of registering one.
    if (process.env.NODE_ENV === "development") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()))
        .catch(() => {});
      return;
    }
    const register = () => {
      // SW_URL carries the build id. Registering it when the id has changed is
      // what replaces the previous worker (and, through it, retires the previous
      // cache); registering it when nothing has changed is a no-op the browser
      // resolves against the existing registration. See src/lib/sw.ts.
      navigator.serviceWorker.register(SW_URL).catch(() => {
        /* An unavailable worker must never break the page. */
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
