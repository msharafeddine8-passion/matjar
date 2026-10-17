import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/server";
import { requireAdminSection } from "@/lib/admin-guard";
import {
  AdminQuestionsClient,
  type QuestionRow,
} from "@/components/admin-questions-client";
import { dictSlice } from "@/lib/dict-slice";

export default async function AdminQuestionsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await requireAdminSection("questions", lang);
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const { data } = await supabase
    .from("product_questions")
    .select(
      "id, product_id, asker_name, question, answer, answered_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(300);

  const questions = (data ?? []) as unknown as {
    id: string;
    product_id: string;
    asker_name: string | null;
    question: string;
    answer: string | null;
    answered_at: string | null;
    created_at: string;
  }[];

  const productIds = Array.from(
    new Set(questions.map((q) => q.product_id).filter(Boolean)),
  );

  const nameById = new Map<string, string>();
  if (productIds.length) {
    const { data: products } = await supabase
      .from("products")
      .select("id, name")
      .in("id", productIds);
    const rows = (products ?? []) as unknown as {
      id: string;
      name: string;
    }[];
    for (const p of rows) nameById.set(p.id, p.name);
  }

  const rows: QuestionRow[] = questions.map((q) => ({
    id: q.id,
    productId: q.product_id,
    productName: nameById.get(q.product_id) ?? null,
    askerName: q.asker_name ?? "—",
    question: q.question,
    answer: q.answer,
    answeredAt: q.answered_at,
    createdAt: q.created_at,
  }));

  return <AdminQuestionsClient lang={lang} dict={dictSlice(dict, ["admin", "common"])} rows={rows} />;
}
