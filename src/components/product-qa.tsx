"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion, Send, CornerDownLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CardList, CardRow } from "@/components/ui/card";
import { notifyError } from "@/lib/notify";
import type { Dictionary } from "@/i18n/get-dictionary";
import type { ProductQuestion } from "@/lib/data/product-qa";
import { safePublicName } from "@/lib/public-name";

export function ProductQA({
  productId,
  questions,
  canAsk,
  canAnswer,
  dict,
  askPlaceholder,
}: {
  productId: string;
  questions: ProductQuestion[];
  canAsk: boolean;
  canAnswer: boolean;
  dict: Dictionary;
  /** Variant wording from the offering resolver — a clinic page must not ask
   *  "عندك سؤال عن المنتج؟". Omitted = the product wording. */
  askPlaceholder?: string;
}) {
  const router = useRouter();
  const t = dict.productQa;
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answerFor, setAnswerFor] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");

  async function ask() {
    if (!q.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    // Shown publicly beside the question: a name or nothing, never an email.
    const name = safePublicName(user.user_metadata?.full_name as string | undefined);
    const { error } = await supabase.from("product_questions").insert({
      product_id: productId,
      asker_id: user.id,
      asker_name: name,
      question: q.trim(),
    });
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    setQ("");
    router.refresh();
  }

  async function answer(id: string) {
    if (!answerText.trim()) return;
    setBusy(true);
    const { error } = await createClient().rpc("answer_product_question", {
      p_qid: id,
      p_answer: answerText.trim(),
    });
    setBusy(false);
    if (error) {
      notifyError(dict.common.actionFailed);
      return;
    }
    setAnswerFor(null);
    setAnswerText("");
    router.refresh();
  }

  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
        <MessageCircleQuestion className="h-6 w-6 text-primary" />
        {t.title}
      </h2>

      {canAsk && (
        <div className="mb-5 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={askPlaceholder ?? t.askPlaceholder}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={ask}
            disabled={busy || !q.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {t.ask}
          </button>
        </div>
      )}

      {questions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-8 text-center text-muted-foreground">
          {t.empty}
        </p>
      ) : (
        <CardList>
          {questions.map((item) => (
            <CardRow key={item.id}>
              <p className="font-semibold">
                <span className="text-primary">{t.q}</span> {item.question}
              </p>
              {item.answer ? (
                <p className="mt-2 flex gap-1.5 text-sm text-muted-foreground">
                  <CornerDownLeft className="mt-0.5 h-4 w-4 shrink-0 rtl:-scale-x-100" />
                  <span>
                    <span className="font-bold text-foreground">{t.a}</span>{" "}
                    {item.answer}
                  </span>
                </p>
              ) : canAnswer ? (
                answerFor === item.id ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      placeholder={t.answerPlaceholder}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => answer(item.id)}
                      disabled={busy}
                      className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
                    >
                      {t.sendAnswer}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAnswerFor(item.id)}
                    className="mt-2 text-sm font-semibold text-primary hover:underline"
                  >
                    {t.answer}
                  </button>
                )
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{t.awaiting}</p>
              )}
            </CardRow>
          ))}
        </CardList>
      )}
    </section>
  );
}
