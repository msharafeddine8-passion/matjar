import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/ui/container";
import { MessageThread, type ChatMessage } from "@/components/message-thread";
import { ChevronPrev } from "@/components/ui/directional-icon";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ about?: string | string[] }>;
}) {
  const { lang, id } = await params;
  const aboutRaw = (await searchParams).about;
  const about = typeof aboutRaw === "string" && UUID_RE.test(aboutRaw) ? aboutRaw : null;
  if (!isLocale(lang)) notFound();
  if (!UUID_RE.test(id)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/login`);

  // RLS returns the row only if the user is a participant.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, store_id, stores(name, owner_id)")
    .eq("id", id)
    .maybeSingle();
  if (!conv) notFound();

  const store = conv.stores as unknown as {
    name: string;
    owner_id: string;
  } | null;
  // Resolve the counterparty via a SECURITY DEFINER, participant-gated RPC.
  // Reading profiles directly does NOT work here: profiles_select RLS is
  // (is_super_admin() OR auth.uid() = id), so a merchant could not read the
  // customer's name and the header fell back to their own store's name.
  // The RPC also applies the side-aware rule: a customer sees the store's name;
  // the store owner sees the person.
  const { data: peerRows } = await supabase.rpc("conversation_peer", {
    p_conversation_id: id,
  });
  const peer = (peerRows ?? [])[0] as { display_name: string | null } | undefined;
  const header =
    peer?.display_name?.trim() || store?.name || dict.messages.unknown;

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  // Arrived from «راسل البائع» (?about=<listing>) on an empty conversation:
  // start the draft with a line naming the listing, so the seller knows which
  // item this is about. Only the title of a listing the buyer can already see
  // (RLS), and only a draft — nothing is sent until they press send.
  let initialText = "";
  if (about && (msgs ?? []).length === 0) {
    const { data: listing } = await supabase
      .from("listings")
      .select("title")
      .eq("id", about)
      .maybeSingle();
    const title = (listing as { title: string } | null)?.title?.trim();
    if (title) initialText = dict.messages.aboutListing.replace("{title}", title);
  }

  // Mark this conversation read for me.
  await supabase
    .from("conversation_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", id)
    .eq("user_id", user.id);

  return (
    <div className="py-6">
      <Container className="max-w-2xl">
        <Link
          href={`/${lang}/messages`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronPrev className="h-4 w-4" />
          {dict.messages.title}
        </Link>
        <h1 className="mt-2 text-xl font-extrabold tracking-tight">{header}</h1>
        {conv.store_id && store && (
          <Link
            href={`/${lang}/store/${conv.store_id}`}
            className="text-sm font-semibold text-primary hover:underline"
          >
            {dict.messages.viewStore}
          </Link>
        )}

        <div className="mt-4">
          <MessageThread
            conversationId={id}
            meId={user.id}
            initialMessages={(msgs ?? []) as ChatMessage[]}
            dict={dict}
            initialText={initialText}
          />
        </div>
      </Container>
    </div>
  );
}
