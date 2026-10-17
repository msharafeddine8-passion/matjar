import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { LoginForm } from "@/components/auth-forms";
import { dictSlice } from "@/lib/dict-slice";

// The tab said only «متجر | Matjar» — the layout default — so a visitor
// bounced here from «راسل البائع» could not tell from the tab what page it was.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.auth.loginTitle };
}

export default async function LoginPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return <LoginForm lang={lang} dict={dictSlice(dict, ["auth", "common"])} />;
}
