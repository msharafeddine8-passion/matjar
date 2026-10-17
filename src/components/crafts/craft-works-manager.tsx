"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { notifyError } from "@/lib/notify";
import { ImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/field";
import type { Dictionary } from "@/i18n/get-dictionary";

export type CraftWork = {
  id: string;
  title: string | null;
  image_url: string;
  sort_order: number;
};

// Past jobs, with photos.
//
// Not the freelancer portfolio, and it should not look like one: no case
// studies, no process, no deliverables. A photo of a finished kitchen and three
// words saying what it was. That is what a customer wanting a carpenter is
// actually checking — that this person has done the thing before.
export function CraftWorksManager({
  providerId,
  works,
  dict,
  labels,
}: {
  providerId: string;
  works: CraftWork[];
  dict: Pick<Dictionary, "upload">;
  labels: {
    title: string;
    body: string;
    photo: string;
    photoHint: string;
    caption: string;
    captionPlaceholder: string;
    add: string;
    adding: string;
    remove: string;
    needPhoto: string;
    error: string;
  };
}) {
  const router = useRouter();
  const [image, setImage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    // The caption is optional; the photo is the whole point.
    if (!image) {
      notifyError(labels.needPhoto);
      return;
    }
    setBusy(true);
    const { error } = await createClient().from("craft_works").insert({
      provider_id: providerId,
      image_url: image,
      title: title.trim() || null,
      sort_order: works.length + 1,
    });
    setBusy(false);
    if (error) {
      notifyError(labels.error);
      return;
    }
    setImage(null);
    setTitle("");
    router.refresh();
  }

  async function remove(id: string) {
    const { error } = await createClient()
      .from("craft_works")
      .delete()
      .eq("id", id);
    if (error) {
      notifyError(labels.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-bold">{labels.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{labels.body}</p>

      {works.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {works.map((w) => (
            <figure
              key={w.id}
              className="relative overflow-hidden rounded-xl border border-border"
            >
              <Image
                src={w.image_url}
                alt={w.title ?? ""}
                width={240}
                height={160}
                className="h-28 w-full object-cover"
                sizes="240px"
              />
              <button
                type="button"
                onClick={() => remove(w.id)}
                aria-label={labels.remove}
                className="absolute end-1.5 top-1.5 rounded-lg bg-black/55 p-1.5 text-white transition-colors hover:bg-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {w.title && (
                <figcaption className="truncate px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  {w.title}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <ImageUpload
          folder={`crafts/${providerId}/works`}
          value={image}
          onChange={setImage}
          label={labels.photo}
          hint={labels.photoHint}
          dict={dict}
        />
        <div>
          <label className="text-sm font-semibold" htmlFor="craftwork-caption">{labels.caption}</label>
          <input
            id="craftwork-caption"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={labels.captionPlaceholder}
            className={`${fieldClass} mt-1.5`}
          />
        </div>
        <Button onClick={add} loading={busy}>
          {busy ? labels.adding : labels.add}
        </Button>
      </div>
    </div>
  );
}
