"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Check,
  EyeOff,
  Trash2,
  ExternalLink,
  ImageIcon,
  Briefcase,
  Palette,
  PackageOpen,
  Undo2,
  X,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import {
  logAdminAction,
  restoreAsAdmin,
  softDeleteAsAdmin,
} from "@/lib/audit";
import { matchesQuery } from "@/lib/admin-search";
import { notifyError, notifySuccess } from "@/lib/notify";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

// One normalized shape for any user-generated listing (job / gig / wholesale).
// Each admin page maps its own table rows into this and hands them to this
// single, config-driven moderation surface — adding a new moderated vertical is
// a new page + a table name, not a new screen.
export type ModerationItem = {
  id: string;
  title: string;
  author: string | null; // company / freelancer / seller name
  meta: string | null; // category · region · price, already formatted
  image: string | null;
  status: string; // 'active' = public; anything else = not shown publicly
  createdAt: string;
};

// Tables this component is allowed to moderate. Keeping it a literal union means
// the (untyped) Supabase call stays honest about what can be written.
export type ModerationTable = "job_postings" | "gigs" | "wholesale_products";

const TABS = ["all", "active", "hidden"] as const;
type Tab = (typeof TABS)[number];

export function AdminModerationClient({
  lang,
  dict,
  table,
  title,
  subtitle,
  viewBase,
  items,
}: {
  lang: Locale;
  dict: Pick<Dictionary, "admin" | "common">;
  table: ModerationTable;
  title: string;
  subtitle: string;
  viewBase: string; // public route segment, e.g. "jobs" | "freelance" | "wholesale"
  items: ModerationItem[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const t = dict.admin.moderation;
  const entity = {
    job_postings: "job",
    gigs: "gig",
    wholesale_products: "wholesale",
  }[table] as "job" | "gig" | "wholesale";
  // Derive the icon from `table` INSIDE the client — a lucide component is a
  // function and cannot cross the server→client boundary as a prop.
  const Icon = {
    job_postings: Briefcase,
    gigs: Palette,
    wholesale_products: PackageOpen,
  }[table];
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // ISS-012. Selection is a Set of ids rather than a flag on each item because
  // `items` is a server prop that is replaced wholesale on every router.refresh()
  // — a flag would be wiped by the refresh that follows every mutation.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // What the last bulk delete removed, so it can be put back. Held until the
  // admin uses it or dismisses it: a toast that expires in three seconds is not
  // an undo for an action that touched fifty rows.
  const [undoable, setUndoable] = useState<string[]>([]);

  const counts = useMemo(() => {
    let active = 0;
    let hidden = 0;
    for (const it of items) {
      if (it.status === "active") active++;
      else hidden++;
    }
    return { all: items.length, active, hidden };
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      const matchTab =
        tab === "all"
          ? true
          : tab === "active"
            ? it.status === "active"
            : it.status !== "active";
      // matchesQuery rather than `.toLowerCase().includes()`: these are listings
      // written in Arabic, and the old comparison could not find "أحمد" from
      // "احمد". `meta` joins the haystack because it is the formatted category ·
      // region · price line the row actually shows.
      return matchTab && matchesQuery(q, [it.title, it.author, it.meta]);
    });
  }, [items, tab, q]);

  // ---- selection ---------------------------------------------------------
  // The invariant that makes bulk actions safe to reason about: an action can
  // only touch rows that are on the screen, and the number in the confirm is
  // always that same number. Both come from intersecting the selection with the
  // current view, so there is no way for them to disagree — the failure this
  // guards against is approving twelve rows chosen under a filter the admin has
  // since changed and forgotten.
  //
  // Deliberately derived rather than pruned in an effect. Ids in `selected` that
  // have scrolled out of the filter are inert: nothing reads the raw Set except
  // the per-row checkbox, so a stale id changes nothing and simply reappears
  // ticked if the admin widens the filter again. Pruning it in a useEffect (the
  // first version of this) bought no safety and cost a cascading render.
  const visibleIds = useMemo(
    () => new Set(filtered.map((it) => it.id)),
    [filtered],
  );
  const selectedItems = filtered.filter((it) => selected.has(it.id));
  /** The only count shown anywhere, and the only one acted on. */
  const selectedCount = selectedItems.length;
  const allVisibleSelected =
    filtered.length > 0 && selectedCount === filtered.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds));
  }

  /**
   * Run `op` over the selected ids, one at a time, and report honestly.
   *
   * Sequential, not Promise.all: fifty parallel writes from a browser is a
   * self-inflicted burst against the same five tables, and a partial failure in
   * a parallel batch tells you a count but not which ones. Sequentially, the ids
   * that succeeded are exactly the prefix that succeeded, which is what the undo
   * bar needs to hold.
   *
   * Returns the ids that actually went through.
   */
  async function runBulk(
    ids: string[],
    op: (id: string) => Promise<boolean>,
  ): Promise<string[]> {
    setBulkBusy(true);
    const done: string[] = [];
    for (const id of ids) {
      if (await op(id)) done.push(id);
    }
    setBulkBusy(false);
    setSelected(new Set());
    router.refresh();
    if (done.length < ids.length) {
      // Never a bare "action failed" for a batch: an admin who cannot tell
      // whether nothing or most of it happened will run it again, which is how
      // a half-applied bulk action becomes a fully applied one nobody intended.
      notifyError(
        t.bulkPartial
          .replace("{done}", String(done.length))
          .replace("{total}", String(ids.length)),
      );
    }
    return done;
  }

  async function bulkStatus(status: "active" | "hidden") {
    const ids = selectedItems.map((it) => it.id);
    if (!ids.length) return;
    // The count and the verb are both in the sentence. "Publish 12 items?" is
    // answerable; "Are you sure?" is not.
    if (
      !(await confirm({
        message: (status === "active"
          ? t.bulkApproveConfirm
          : t.bulkHideConfirm
        ).replace("{n}", String(ids.length)),
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        // Not `danger`. Hiding is a status flip that the row's own button undoes
        // in one click; painting it red would spend the colour that the delete
        // confirm needs to still mean something.
        danger: false,
      }))
    )
      return;
    setUndoable([]);
    const done = await runBulk(ids, async (id) => {
      const { error } = await createClient()
        .from(table)
        .update({ status })
        .eq("id", id);
      if (error) return false;
      void logAdminAction(
        status === "active" ? "published" : "hidden",
        entity,
        id,
      );
      return true;
    });
    if (done.length)
      notifySuccess(
        (status === "active" ? t.bulkApproved : t.bulkHidden).replace(
          "{n}",
          String(done.length),
        ),
      );
  }

  async function bulkDelete() {
    const ids = selectedItems.map((it) => it.id);
    if (!ids.length) return;
    if (
      !(await confirm({
        title: t.bulkDeleteTitle,
        // Says the number, names the action, and says it can be undone — the
        // last part is true only because 0294 made these deletes soft, and it
        // would be a lie to print it on a hard delete.
        message: t.bulkDeleteConfirm.replace("{n}", String(ids.length)),
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    const done = await runBulk(ids, (id) =>
      softDeleteAsAdmin(entity, id, { bulk: true, batch_size: ids.length }),
    );
    // Only what actually got deleted goes in the undo bar. Offering to restore
    // an id the delete never reached would produce a `not_found` and an admin
    // wondering which half of the screen is lying.
    setUndoable(done);
  }

  async function undoDelete() {
    const ids = undoable;
    if (!ids.length) return;
    setBulkBusy(true);
    let restored = 0;
    for (const id of ids) {
      if (await restoreAsAdmin(entity, id)) restored++;
    }
    setBulkBusy(false);
    setUndoable([]);
    router.refresh();
    if (restored < ids.length) {
      notifyError(
        t.bulkPartial
          .replace("{done}", String(restored))
          .replace("{total}", String(ids.length)),
      );
      return;
    }
    notifySuccess(t.bulkRestored.replace("{n}", String(restored)));
  }

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    const { error } = await createClient()
      .from(table)
      .update({ status })
      .eq("id", id);
    setBusyId(null);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    void logAdminAction(status === "active" ? "published" : "hidden", entity, id);
    router.refresh();
  }

  async function remove(id: string) {
    if (
      !(await confirm({
        message: t.deleteConfirm,
        confirmLabel: dict.common.confirm,
        cancelLabel: dict.common.cancel,
        danger: true,
      }))
    )
      return;
    setBusyId(id);
    // Soft delete + audit row in one transaction (0294). `entity` is already
    // the exact string admin_soft_delete keys on, so the three verticals this
    // component moderates stay one code path.
    const ok = await softDeleteAsAdmin(entity, id);
    setBusyId(null);
    if (!ok) {
      notifyError(dict.common.actionFailed);
      return;
    }
    router.refresh();
  }

  return (
    <div className="py-10">
      <Container>
        <PageHeader icon={Icon} title={title} subtitle={subtitle} />

        <div className="grid grid-cols-3 gap-3">
          <Stat label={t.total} value={counts.all.toLocaleString("en-US")} />
          <Stat label={t.public} value={counts.active.toLocaleString("en-US")} />
          <Stat label={t.hidden} value={counts.hidden.toLocaleString("en-US")} />
        </div>

        <div className="mt-6 flex flex-wrap gap-1.5">
          {TABS.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                tab === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.tabs[s]}
              <span className="ms-1.5 opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>

        <div className="relative mt-4 max-w-sm">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.search}
          />
        </div>

        {/* Undo sits above the list and outlives the toast system on purpose.
            notifySuccess auto-dismisses in 3.5s and carries no button; an
            action that removed N rows deserves a target that is still there
            when the admin looks up. */}
        {undoable.length > 0 && (
          <div
            role="status"
            className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-muted p-3"
          >
            <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-sm font-semibold">
              {t.bulkDeleted.replace("{n}", String(undoable.length))}
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy}
              onClick={undoDelete}
              leftIcon={<Undo2 className="h-3.5 w-3.5" />}
            >
              {t.bulkUndo}
            </Button>
            <button
              type="button"
              onClick={() => setUndoable([])}
              aria-label={dict.common.cancel}
              className="relative text-muted-foreground transition-colors before:absolute before:-inset-3 before:content-[''] hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* The select-all row and the action bar are one control group, and it
            only exists while there is something to act on. A permanent bulk
            toolbar on a screen where most visits change one row is a permanent
            invitation to the mistake this feature is most likely to cause. */}
        {filtered.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3">
            <label className="relative flex cursor-pointer items-center gap-2 text-sm font-semibold before:absolute before:-inset-2.5 before:content-['']">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                disabled={bulkBusy}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              {t.selectAllVisible.replace("{n}", String(filtered.length))}
            </label>

            {selectedCount > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-primary">
                  {t.selectedCount.replace("{n}", String(selectedCount))}
                </span>
                <Button
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => bulkStatus("active")}
                  leftIcon={<Check className="h-3.5 w-3.5" />}
                >
                  {t.approve}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={bulkBusy}
                  onClick={() => bulkStatus("hidden")}
                  leftIcon={<EyeOff className="h-3.5 w-3.5" />}
                >
                  {t.hide}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={bulkBusy}
                  onClick={bulkDelete}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                  className="!text-danger"
                >
                  {t.delete}
                </Button>
              </div>
            )}
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={Icon}
            // "Nothing here yet" is false when there are items and the query
            // simply did not match any — and it is the message most likely to
            // send an admin looking for a bug that is not there.
            title={
              q.trim()
                ? dict.admin.listSearch.noMatch.replace("{q}", q.trim())
                : t.empty
            }
          />
        ) : (
          <div data-animate className="mt-6 space-y-2">
            {filtered.map((it) => {
              const isPublic = it.status === "active";
              return (
                <Card key={it.id}>
                  <CardBody className="flex flex-wrap items-center gap-4 p-3">
                    {/* First in DOM order, so it is first in the reading order
                        in both directions — `ms-`/`me-` handle the rest. The
                        pseudo-element gives the 16px box a 44px target without
                        adding layout height to the row. */}
                    <label className="relative flex shrink-0 cursor-pointer items-center before:absolute before:-inset-3.5 before:content-['']">
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggle(it.id)}
                        disabled={bulkBusy}
                        aria-label={`${t.select}: ${it.title}`}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                    </label>

                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                      {it.image ? (
                        <Image
                          src={it.image}
                          alt=""
                          width={64}
                          height={64}
                          className="h-16 w-16 object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-6 w-6 text-foreground/10" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{it.title}</span>
                        <Badge
                          variant={isPublic ? "success" : "neutral"}
                          size="sm"
                        >
                          {isPublic ? t.tabs.active : t.hiddenBadge}
                        </Badge>
                        {it.author && (
                          <Badge variant="neutral" size="sm">
                            {it.author}
                          </Badge>
                        )}
                      </div>
                      {it.meta && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {it.meta}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <ButtonLink
                        href={`/${lang}/${viewBase}/${it.id}`}
                        target="_blank"
                        variant="secondary"
                        size="sm"
                        aria-label={t.view}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </ButtonLink>
                      {isPublic ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === it.id || bulkBusy}
                          onClick={() => setStatus(it.id, "hidden")}
                          leftIcon={<EyeOff className="h-3.5 w-3.5" />}
                          className="!text-danger"
                        >
                          {t.hide}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busyId === it.id || bulkBusy}
                          onClick={() => setStatus(it.id, "active")}
                          leftIcon={<Check className="h-3.5 w-3.5" />}
                        >
                          {t.approve}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === it.id || bulkBusy}
                        onClick={() => remove(it.id)}
                        aria-label={t.delete}
                        className="!text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </Container>
    </div>
  );
}
