import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Sparkles, Clock } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { localeAlternates } from "@/lib/site";
import type { Gig } from "@/lib/gigs";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/hub/initials-avatar";
import { ContactFreelancerButton } from "@/components/contact-freelancer-button";
import { dictSlice } from "@/lib/dict-slice";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  skills: string[] | null;
  gig_count: number;
};

async function loadProfile(id: string): Promise<PublicProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_lister_profile", { p_user: id });
  const row = (data ?? [])[0] as PublicProfile | undefined;
  return row ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLocale(lang) || !UUID_RE.test(id)) return {};
  const p = await loadProfile(id);
  if (!p) return {};
  return {
    title: p.full_name ?? undefined,
    description: p.bio?.slice(0, 160) ?? undefined,
    alternates: localeAlternates(lang, `/u/${id}`),
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.freelance;

  const profile = await loadProfile(id);
  if (!profile) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isSelf = user?.id === id;

  const { data: gigsData } = await supabase
    .from("gigs")
    .select("id, title, category, price, delivery_days, image_url")
    .eq("freelancer_id", id)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  const gigs = (gigsData ?? []) as Pick<
    Gig,
    "id" | "title" | "category" | "price" | "delivery_days" | "image_url"
  >[];

  const name = profile.full_name?.trim() || t.freelancer;
  const skills = Array.isArray(profile.skills) ? profile.skills : [];

  return (
    <div className="py-10">
      <Container className="max-w-3xl">
        <Card className="p-6 sm:p-8">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-start">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={name}
                width={112}
                height={112}
                className="h-24 w-24 shrink-0 rounded-full object-cover"
              />
            ) : (
              <InitialsAvatar name={name} size="xl" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-extrabold tracking-tight">{name}</h1>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground sm:justify-start">
                <Sparkles className="h-4 w-4 text-primary" />
                {t.gigCount.replace("{n}", String(profile.gig_count))}
              </p>
              {profile.bio && (
                <p className="mt-3 whitespace-pre-wrap text-muted-foreground">
                  {profile.bio}
                </p>
              )}
              {skills.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                  {skills.map((s) => (
                    <Badge key={s} variant="neutral" size="sm">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-5 flex justify-center sm:justify-start">
                {isSelf ? (
                  <Link
                    href={`/${lang}/freelance/mine`}
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    {t.editProfileCta}
                  </Link>
                ) : (
                  <ContactFreelancerButton
                    freelancerId={id}
                    lang={lang as Locale}
                    dict={dictSlice(dict, ["freelance"])}
                  />
                )}
              </div>
            </div>
          </div>
        </Card>

        {gigs.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-bold">{t.theirServices}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {gigs.map((g) => (
                <Link key={g.id} href={`/${lang}/freelance/${g.id}`}>
                  <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                    {g.image_url && (
                      <Image
                        src={g.image_url}
                        alt={g.title}
                        width={400}
                        height={225}
                        className="aspect-video w-full object-cover"
                        sizes="(max-width: 640px) 100vw, 320px"
                      />
                    )}
                    <div className="p-4">
                      {g.category && (
                        <Badge variant="primary" size="sm">
                          {t.categories[g.category as keyof typeof t.categories] ??
                            g.category}
                        </Badge>
                      )}
                      <h3 className="mt-2 line-clamp-2 font-bold">{g.title}</h3>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        {g.price != null && (
                          <span className="font-extrabold text-primary">
                            {t.from} ${g.price}
                          </span>
                        )}
                        {g.delivery_days != null && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            {t.deliveryIn.replace("{n}", String(g.delivery_days))}
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}
