import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { ResetPasswordForm } from "@/components/auth-forms";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { dictSlice } from "@/lib/dict-slice";

// The form is only shown to someone the recovery link actually signed in.
//
// It used to render unconditionally, so a person whose link had not produced a
// session typed a new password, got "something went wrong", and then could not
// log in with either password — because nothing had been changed. The failure
// they were shown described the wrong thing at the wrong moment.
//
// Checking here means the dead-link case is answered before they type anything,
// with the one action that helps: ask for a new link.
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card variant="elevated" className="p-8 text-center">
        <h1 className="text-xl font-extrabold">{dict.auth.resetNoSession}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {dict.auth.resetNoSessionHint}
        </p>
        <p className="mt-6">
          <Link
            href={`/${lang}/forgot-password`}
            className="font-bold text-primary hover:underline"
          >
            {dict.auth.forgotTitle}
          </Link>
        </p>
      </Card>
    );
  }

  return <ResetPasswordForm lang={lang} dict={dictSlice(dict, ["auth", "common"])} />;
}
