"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/i18n/get-dictionary";

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export function MessageThread({
  conversationId,
  meId,
  initialMessages,
  dict,
  initialText = "",
}: {
  conversationId: string;
  meId: string;
  initialMessages: ChatMessage[];
  dict: Dictionary;
  /** A draft to start from (never sent on its own) — e.g. the line naming the
   *  Sunday Market listing a buyer came from. */
  initialText?: string;
}) {
  const t = dict.messages;
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Lightweight polling — the whole (RLS-scoped) message list is canonical, so
  // replacing it is idempotent and can't duplicate an optimistic send.
  useEffect(() => {
    const supabase = createClient();
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (data) setMessages(data as ChatMessage[]);
    }, 4000);
    return () => clearInterval(timer);
  }, [conversationId]);

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: meId, body })
      .select("id, sender_id, body, created_at")
      .single();
    setSending(false);
    if (!error && data) {
      setMessages((m) => [...m, data as ChatMessage]);
      setText("");
    } else {
      // The insert policy caps messages per hour; a rejection here is the cap.
      setSendError(dict.common.rateLimited);
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface">
      <div className="flex max-h-[60vh] min-h-[40vh] flex-col gap-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="m-auto text-sm text-muted-foreground">{t.startPrompt}</p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div
              key={m.id}
              className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
                mine
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-surface-muted"
              }`}
            >
              {m.body}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {sendError && (
        <p className="border-t border-border px-4 py-2 text-sm font-medium text-danger">
          {sendError}
        </p>
      )}
      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.placeholder}
          className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label={t.send}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          <Send className="h-4 w-4 rtl:-scale-x-100" />
        </button>
      </form>
    </div>
  );
}
