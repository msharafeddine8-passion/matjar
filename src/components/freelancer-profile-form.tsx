"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

// Lets a freelancer fill the public profile that /u/[id] shows: a short bio and
// a set of skill tags. Writes straight to their own profiles row (allowed by
// RLS — auth.uid() = id).
export function FreelancerProfileForm({
  dict,
  initial,
}: {
  dict: Pick<Dictionary, "account" | "auth" | "freelance" | "wholesale">;
  initial: { bio: string; skills: string[] };
}) {
  const router = useRouter();
  const t = dict.freelance;
  const [bio, setBio] = useState(initial.bio);
  const [skills, setSkills] = useState<string[]>(initial.skills);
  const [skillDraft, setSkillDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addSkill() {
    const s = skillDraft.trim();
    if (s && !skills.includes(s) && skills.length < 12) {
      setSkills([...skills, s]);
    }
    setSkillDraft("");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { error: upErr } = await supabase
      .from("profiles")
      .update({
        bio: bio.trim() || null,
        skills: skills.length ? skills : null,
      })
      .eq("id", user.id);
    if (upErr) {
      setError(dict.auth.errorGeneric);
      setLoading(false);
      return;
    }
    setLoading(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
    >
      <Field label={t.bioLabel} htmlFor="bio" hint={t.bioHint}>
        <Textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          maxLength={600}
          placeholder={t.bioPlaceholder}
        />
      </Field>

      <div>
        <span className="text-sm font-semibold">{t.skillsLabel}</span>
        <div className="mt-2 flex gap-2">
          <Input
            value={skillDraft}
            onChange={(e) => setSkillDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSkill();
              }
            }}
            placeholder={t.skillsPlaceholder}
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addSkill}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            {t.addSkill}
          </Button>
        </div>
        {skills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {skills.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary"
              >
                {s}
                <button
                  type="button"
                  onClick={() => setSkills(skills.filter((x) => x !== s))}
                  aria-label={dict.wholesale.remove}
                  className="transition-opacity hover:opacity-70"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={loading}>
          {loading ? dict.account.saving : dict.account.save}
        </Button>
        {saved && (
          <span className="text-sm font-semibold text-primary">
            {dict.account.saved}
          </span>
        )}
        {error && (
          <span className="text-sm font-semibold text-danger">{error}</span>
        )}
      </div>
    </form>
  );
}
