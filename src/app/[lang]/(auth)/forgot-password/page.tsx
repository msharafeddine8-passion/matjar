import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { dictSlice } from "@/lib/dict-slice";

export default async function ForgotPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { lang } = await params;
  const { error } = await searchParams;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <ForgotPasswordForm
      lang={lang}
      dict={dictSlice(dict, ["auth", "common"])}
      // /auth/confirm sends people back here when a link is spent or was opened
      // in a different browser than the one that asked for it. Arriving at a
      // blank form with no explanation reads as "the site lost my request".
      linkError={error === "link"}
    />
  );
}
