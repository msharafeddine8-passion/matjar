"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader2, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/push";
import { SW_URL } from "@/lib/sw";
import {
  NATIVE_PUSH_ENABLED,
  checkNativePermission,
  deleteDeviceTokenRow,
  isNativeApp,
  readDeviceToken,
  registerNativeDevice,
  requestNativePermission,
  unregisterNativeDevice,
} from "@/lib/native-push";
import type { Dictionary } from "@/i18n/get-dictionary";

// The switch. It is the only place in the app that triggers a notification
// permission prompt, on either platform — nothing asks on launch, and nothing
// asks after login. It is rendered inside `PushNotice`, which states in words
// what the notification is for, so by the time the OS alert appears the person
// has read a reason and tapped a button.
//
// That ordering is not politeness. On iOS the system alert can be shown once per
// install; a "Don't Allow" is final and cannot be re-asked from inside the app.
//
// Five states, because they need five different things said to them:
//
//   checking     — we do not know yet. Show the control disabled rather than
//                  nothing, so it does not pop into existence under a thumb.
//   unsupported  — this platform cannot do push (a browser without the Push
//                  API; the app shell before the FCM sender ships). Say so.
//                  Never render a button that would do nothing.
//   idle         — never asked. This is the only state that may show the prompt.
//   on           — granted and switched on. Stays visible: the permission can be
//                  revoked from outside the app, and a row that vanished when it
//                  succeeded would leave no way back.
//   off          — granted at the OS, switched off in the app. Turning it back
//                  on needs no prompt.
//   blocked      — denied at the OS. The app cannot ask again. The only honest
//                  thing to show is where the phone's own setting lives.
type State =
  | "checking"
  | "unsupported"
  | "idle"
  | "on"
  | "off"
  | "blocked"
  | "busy";

/** Which push channel this device actually uses. */
type Channel = "web" | "native";

/**
 * One device, one channel — never two (MP-029).
 *
 * A phone that holds a Web Push subscription AND an FCM/APNs token is
 * registered twice for the same account: `push_on_notification` fans out to
 * `push_subscriptions` over VAPID, and the FCM sender (MOBILE_APP.md, still
 * unbuilt) will fan out to `device_push_tokens`. Every notification would then
 * arrive twice on the same screen, and turning it off in one place would not
 * stop the other — the switch in here only ever tears down the channel it
 * believes it is on.
 *
 * So the moment this component knows it is inside the shell, any web-side
 * registration on this device is retired: the row first — that is the thing the
 * sender reads and the only thing that actually stops delivery — then the
 * browser subscription.
 *
 * Cheap on the common path: `getSubscription()` is a local read that answers
 * null for every device that never had one, and nothing else runs.
 *
 * This is deliberately one-way. The mirror image — dropping the device token
 * when the web branch is taken — is NOT done, because `isNativeApp()` reports
 * false whenever the Capacitor import fails for any reason, and inside a real
 * app binary that would quietly delete a working FCM registration on a
 * transient failure. Losing a stale web subscription is recoverable with one
 * tap; losing the native one is not, because re-registering can need the
 * one-shot iOS prompt that has already been spent.
 */
async function dropWebPushOnThisDevice(): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return;
  }
  try {
    // `getRegistration()`, never `ready` — `ready` never settles on a device
    // with no worker, which is most of them inside a WebView.
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const supabase = createClient();
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  } catch {
    /* Best effort. A failure here must not stop the native state from showing. */
  }
}

export function PushOptIn({ dict }: { dict: Pick<Dictionary, "push"> }) {
  const t = dict.push;
  const [state, setState] = useState<State>("checking");
  const [channel, setChannel] = useState<Channel>("web");

  const detect = useCallback(async () => {
    if (typeof window === "undefined") return;

    if (await isNativeApp()) {
      setChannel("native");
      // This device is a native device, so it must not also be a web-push
      // device. Runs before the flag check on purpose: with native push still
      // switched off, a shell carrying a leftover web subscription would be
      // told "notifications aren't available" by this component while quietly
      // continuing to receive them.
      await dropWebPushOnThisDevice();
      // The one-shot prompt must not be spent on a channel with no sender
      // behind it. Until NEXT_PUBLIC_NATIVE_PUSH_ENABLED is set, the app shell
      // reports itself as unable rather than showing a button that would burn
      // the only ask the app gets.
      if (!NATIVE_PUSH_ENABLED) {
        setState("unsupported");
        return;
      }
      const perm = await checkNativePermission();
      if (perm === "unsupported") return setState("unsupported");
      if (perm === "denied") return setState("blocked");
      if (perm === "prompt") return setState("idle");
      // Granted at the OS. A remembered token is what separates "on" from
      // "the user switched it off in here".
      return setState(readDeviceToken() ? "on" : "off");
    }

    setChannel("web");
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      return setState("unsupported");
    }
    if (Notification.permission === "denied") return setState("blocked");
    if (Notification.permission === "default") return setState("idle");
    // Granted. On the web the subscription itself is the switch.
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  // State updates here are intentional (kept in an effect to avoid an SSR/CSR
  // hydration mismatch — none of this is knowable on the server).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void detect();
    // The OS permission can change while the app is backgrounded (Settings →
    // Notifications). Re-read it when the tab comes back, so a person who just
    // enabled it in Settings does not return to a screen still telling them it
    // is blocked.
    const onVisible = () => {
      if (document.visibilityState === "visible") void detect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [detect]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function enableNative() {
    // Only ask when we have never asked. Re-asking after a grant is a no-op,
    // but after a denial it is worse than a no-op: it resolves instantly with
    // "denied" and looks to the user like the button is broken.
    const current = await checkNativePermission();
    const perm = current === "prompt" ? await requestNativePermission() : current;
    if (perm === "denied") return setState("blocked");
    if (perm !== "granted") return setState("idle");
    // Fires the `registration` listener that NativeBridge installed; that
    // listener is what writes the token row.
    await registerNativeDevice();
    setState("on");
  }

  async function enableWeb() {
    const perm = await Notification.requestPermission();
    if (perm === "denied") return setState("blocked");
    if (perm !== "granted") return setState("idle");
    // SwRegister already registered the worker on load; this only waits for it.
    // Registering here too was how the worker came to exist ONLY for people who
    // accepted notifications.
    const reg =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register(SW_URL));
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: a Uint8Array is a valid BufferSource at runtime; TS's newer lib
      // types narrow this and reject the ArrayBufferLike buffer.
      applicationServerKey: urlBase64ToUint8Array(
        VAPID_PUBLIC_KEY,
      ) as BufferSource,
    });
    const json = sub.toJSON();
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !json.keys) return setState("off");
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
      { onConflict: "endpoint" },
    );
    setState("on");
  }

  async function enable() {
    setState("busy");
    try {
      if (channel === "native") await enableNative();
      else await enableWeb();
    } catch {
      // Fall back to a fresh read rather than guessing: a thrown subscribe can
      // still have left a granted permission behind.
      await detect();
    }
  }

  // Turning it off has to remove the server-side row, not just the local
  // registration — the row is the thing the sender reads, and a device that
  // still has a row keeps receiving.
  async function disable() {
    setState("busy");
    const supabase = createClient();
    try {
      if (channel === "native") {
        await deleteDeviceTokenRow(supabase);
        await unregisterNativeDevice();
      } else {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
          await sub.unsubscribe();
        }
      }
      setState("off");
    } catch {
      await detect();
    }
  }

  if (state === "checking") {
    return (
      <button
        disabled
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-bold opacity-50"
      >
        <Bell className="h-4 w-4" />
        {t.enable}
      </button>
    );
  }

  if (state === "unsupported") {
    return (
      <p className="text-xs font-semibold text-muted-foreground">
        {t.unsupported}
      </p>
    );
  }

  // Denied at the OS. The app has spent its ask and cannot show the prompt
  // again — the only route back is the phone's own settings, so say that
  // instead of offering a button that would silently do nothing.
  if (state === "blocked") {
    return (
      <p className="flex items-start gap-1.5 text-xs font-semibold text-muted-foreground">
        <Settings className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="max-w-xs leading-relaxed">{t.blocked}</span>
      </p>
    );
  }

  if (state === "on") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          <Check className="h-4 w-4" />
          {t.enabled}
        </span>
        <button
          onClick={disable}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          <BellOff className="h-4 w-4" />
          {t.disable}
        </button>
      </div>
    );
  }

  // idle | off | busy — all show the enable button; `off` explains why it is
  // being offered again to someone who already granted the permission.
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "off" && (
        <span className="text-xs font-semibold text-muted-foreground">
          {t.turnedOff}
        </span>
      )}
      <button
        onClick={enable}
        disabled={state === "busy"}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
      >
        {state === "busy" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        {t.enable}
      </button>
    </div>
  );
}
