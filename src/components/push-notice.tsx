import { Bell } from "lucide-react";
import type { Dictionary } from "@/i18n/get-dictionary";
import { PushOptIn } from "@/components/push-opt-in";
import { dictSlice } from "@/lib/dict-slice";

// The switch, where the person who needs it will actually stand.
//
// Push has been wired end to end since 0049 — the secret, the site URL and pg_net
// are all configured — and there were still zero subscriptions on the whole
// platform. Not because it failed: because the only place to turn it on was the
// customer account page, which an admin waiting on store approvals never opens.
// A feature nobody can find is indistinguishable from one that does not exist.
//
// So it goes on the dashboards, and it says what it is FOR rather than "enable
// notifications" — the reason is the thing that makes someone tap it. It stays
// visible once enabled (PushOptIn turns itself into a confirmation), because on
// a phone the permission can be revoked from outside the app and a row that
// vanished would leave no way back.
export function PushNotice({
  dict,
  title,
  body,
}: {
  dict: Dictionary;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/25 bg-primary-soft/40 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Bell className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>
      </div>
      <PushOptIn dict={dictSlice(dict, ["push"])} />
    </div>
  );
}
