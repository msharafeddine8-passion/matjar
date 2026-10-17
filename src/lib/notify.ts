"use client";

// Lightweight, dependency-free toast. Gives client mutations a visible failure
// path without threading state/props through every component: on an error, call
// `notifyError(...)` and the user sees an accessible, auto-dismissing message.
// Positioned bottom-center, RTL-safe, respects prefers-reduced-motion.

type ToastType = "error" | "success";

const CONTAINER_ID = "matjar-toast-root";

function ensureContainer(): HTMLElement {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = CONTAINER_ID;
    el.setAttribute("aria-live", "assertive");
    el.style.cssText =
      "position:fixed;inset-inline:0;bottom:1rem;z-index:9999;display:flex;flex-direction:column;align-items:center;gap:.5rem;pointer-events:none;padding-inline:1rem";
    document.body.appendChild(el);
  }
  return el;
}

type ToastAction = { href: string; label: string };

function notify(message: string, type: ToastType, action?: ToastAction) {
  if (typeof document === "undefined") return;
  const root = ensureContainer();
  const reduce = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const toast = document.createElement("div");
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  // Token-driven so the toast follows the active theme; the literals are only a
  // fallback for the (impossible in practice) case of the vars being absent.
  // The *-strong tokens, not --danger/--success: those are the on-soft TEXT
  // colours, and white on the dark-theme --success (#3fb950) is only 2.54:1.
  const bg =
    type === "error"
      ? "var(--danger-strong, #b91c1c)"
      : "var(--success-strong, #0b7a35)";
  toast.style.cssText = `pointer-events:auto;max-width:32rem;background:${bg};color:#fff;font-weight:600;font-size:.875rem;line-height:1.4;padding:.75rem 1rem;border-radius:.75rem;box-shadow:0 10px 30px -10px rgba(0,0,0,.4);opacity:0;transform:translateY(${reduce ? "0" : ".5rem"});transition:opacity .2s ease,transform .2s ease`;
  toast.textContent = message;
  if (action) {
    // One follow-up link (e.g. a prefilled WhatsApp message). Opens in a new
    // tab; underlined white on the strong fill, same contrast as the text.
    const a = document.createElement("a");
    a.href = action.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = action.label;
    a.style.cssText =
      "display:inline-block;margin-inline-start:.5rem;color:#fff;text-decoration:underline;font-weight:800";
    toast.appendChild(document.createTextNode(" "));
    toast.appendChild(a);
  }
  root.appendChild(toast);

  // Next frame → animate in.
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  const remove = () => {
    toast.style.opacity = "0";
    toast.style.transform = `translateY(${reduce ? "0" : ".5rem"})`;
    setTimeout(() => toast.remove(), 220);
  };
  setTimeout(remove, action ? 12000 : type === "error" ? 6000 : 3500);
  toast.addEventListener("click", remove);
}

/** Show a red error toast. Pass a user-friendly, localized message. */
export function notifyError(message: string) {
  notify(message, "error");
}

/** Show a green success toast. */
export function notifySuccess(message: string) {
  notify(message, "success");
}

/** A success toast carrying one follow-up link, kept up longer (12s). */
export function notifyWithLink(message: string, action: ToastAction) {
  notify(message, "success", action);
}
