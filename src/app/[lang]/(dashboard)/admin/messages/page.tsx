import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  AdminMessagesClient,
  type MessageRow,
} from "@/components/admin-messages-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminMessagesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("messages", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();

  const { data: messagesData } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const messages = (messagesData ?? []) as unknown as {
    id: string;
    conversation_id: string | null;
    sender_id: string | null;
    body: string;
    created_at: string;
  }[];

  const senderIds = Array.from(
    new Set(messages.map((m) => m.sender_id).filter(Boolean) as string[]),
  );
  const convIds = Array.from(
    new Set(messages.map((m) => m.conversation_id).filter(Boolean) as string[]),
  );

  const nameById = new Map<string, string>();
  if (senderIds.length) {
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", senderIds);
    const profiles = (profilesData ?? []) as unknown as {
      id: string;
      full_name: string | null;
    }[];
    for (const p of profiles) {
      if (p.full_name) nameById.set(p.id, p.full_name);
    }
  }

  const storeByConv = new Map<string, string | null>();
  if (convIds.length) {
    const { data: convData } = await supabase
      .from("conversations")
      .select("id, store_id, stores(name)")
      .in("id", convIds);
    const convs = (convData ?? []) as unknown as {
      id: string;
      store_id: string | null;
      stores: { name: string } | null;
    }[];
    for (const c of convs) {
      storeByConv.set(c.id, c.stores?.name ?? null);
    }
  }

  const rows: MessageRow[] = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    sender: (m.sender_id && nameById.get(m.sender_id)) || "—",
    store: m.conversation_id ? storeByConv.get(m.conversation_id) ?? null : null,
  }));

  return <AdminMessagesClient lang={lang} dict={dictSlice(dict, ["admin", "common"])} rows={rows} />;
}
