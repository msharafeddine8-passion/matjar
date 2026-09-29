import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

type Convo = {
  conversation_id: string;
  store_name: string | null;
  other_name: string | null;
  display_name: string | null;
  last_body: string | null;
  last_at: string;
  unread: boolean;
};

function shortDate(iso: string, lang: Locale) {
  // Render in Lebanon time — this runs server-side (UTC on Vercel), so without
  // an explicit timeZone the date could show the wrong day near midnight.
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar" : "en", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Beirut",
  });
}

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.messages;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  const { data } = await supabase.rpc("my_conversations");
  const convos = (data ?? []) as Convo[];

  return (
    <div className="py-10">
      <Container className="max-w-2xl">
        <PageHeader title={t.title} icon={MessageCircle} />

        {convos.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
            {convos.map((c) => (
              <li key={c.conversation_id}>
                <Link
                  href={`/${lang}/messages/${c.conversation_id}`}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-surface-muted"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <MessageCircle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-bold">
                        {/* display_name is already the store for a customer and the person
                            for the shop (0319: never their email). No store_name
                            fallback: for the owner that was their OWN shop's name. */}
                        {c.display_name || t.unknown}
                      </span>
                      {c.unread && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
                      <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                        {shortDate(c.last_at, lang as Locale)}
                      </span>
                    </div>
                    <p
                      className={`truncate text-sm ${c.unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                    >
                      {c.last_body || t.noMessagesYet}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={MessageCircle} title={t.empty} />
        )}
      </Container>
    </div>
  );
}
