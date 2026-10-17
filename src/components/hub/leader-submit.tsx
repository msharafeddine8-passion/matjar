"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { Button, ButtonLink } from "@/components/ui/button";
import { notifyError } from "@/lib/notify";

const field =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

function slugify(name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, "-")
      .replace(/[؀-ۿ]/g, "")
      .replace(/^-+|-+$/g, "") || "leader";
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

// Public self-submission for the Business Leaders directory. Inserts an
// UNPUBLISHED row (RLS enforces submitted_by = auth.uid() and published = false);
// a super admin reviews and publishes. Keeps the directory curated — never
// auto-populated with unverified profiles.
export function LeaderSubmit({ lang, dict }: { lang: Locale; dict: Pick<Dictionary, "common" | "hub"> }) {
  const l = dict.hub.leaders;
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [instagram, setInstagram] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      setUid(user?.id ?? null);
      setReady(true);
    })();
  }, []);

  async function submit() {
    if (!name.trim() || !uid || busy) return;
    setBusy(true);
    const socials: Record<string, string> = {};
    if (linkedin.trim()) socials.linkedin = linkedin.trim();
    if (instagram.trim()) socials.instagram = instagram.trim();
    const { error } = await createClient().from("business_leaders").insert({
      slug: slugify(name.trim()),
      name: name.trim(),
      headline: headline.trim() || null,
      bio: bio.trim() || null,
      website: website.trim() || null,
      socials,
      submitted_by: uid,
      published: false,
    });
    setBusy(false);
    if (error) {
      notifyError(
        error.message?.includes("submission_limit_reached")
          ? l.submitLimit
          : dict.common.actionFailed,
      );
      return;
    }
    setDone(true);
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary-soft/25 p-6">
      <h2 className="text-lg font-extrabold">{l.submitTitle}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{l.submitNote}</p>

      {done ? (
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-success-soft px-4 py-4 text-success">
          <CheckCircle2 className="h-6 w-6 shrink-0" />
          <p className="text-sm font-bold">{l.submitDone}</p>
        </div>
      ) : !ready ? null : !uid ? (
        <ButtonLink href={`/${lang}/login`} className="mt-4">
          {l.submitLogin}
        </ButtonLink>
      ) : (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={l.fName} className={field} />
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder={l.fHeadline} className={field} />
          </div>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder={l.fBio} rows={3} className={field} />
          <div className="grid gap-3 sm:grid-cols-3">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder={l.fWebsite} className={field} dir="ltr" />
            <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="LinkedIn" className={field} dir="ltr" />
            <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="Instagram" className={field} dir="ltr" />
          </div>
          <Button onClick={submit} loading={busy} disabled={!name.trim()} leftIcon={<Send className="h-4 w-4" />}>
            {l.submitButton}
          </Button>
        </div>
      )}
    </div>
  );
}
