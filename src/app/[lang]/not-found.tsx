import { supportWaLink } from "@/lib/support";
import { getDictionary } from "@/i18n/get-dictionary";
import { NotFoundBody } from "@/components/not-found-body";

// Localized 404. Params aren't available to not-found boundaries, so both
// languages' copy is read here and NotFoundBody picks one from the URL the
// visitor is on. It used to print both languages at once and offer only
// "home" — a dead end. It now offers a search box (works without JS), home,
// explore, and a human.
//
// This page used to answer HTTP 200 rather than 404, and the note here used to
// argue that was an acceptable trade. It is fixed, and the argument was wrong,
// so both are recorded rather than quietly deleted.
//
// The mechanism: `notFound()` can only set a status while the response has not
// started, and `(site)/loading.tsx` put a Suspense boundary above every page in
// the group, so Next flushed a skeleton with a 200 before the page body
// discovered the record was missing. That much was diagnosed correctly — by
// removing the file, rebuilding, and watching /ar/<unknown-slug> become a real
// 404.
//
// The wrong part was the conclusion: that keeping an instant skeleton on ~40
// routes beat a status code on URLs nobody meant to request. 6086d58 measured
// what that boundary actually cost — with it in place, /ar and /ar/merchants
// shipped **zero** characters inside <main>, so a crawler, and any phone that
// never finished hydrating, saw the skeleton and nothing else. The skeleton was
// not buying a nicer wait; it was withholding every public page's content from
// everyone who does not run JavaScript.
//
// Worth keeping from the old note, because it is still true and still
// counter-intuitive: Next already emits <meta name="robots" content="noindex">
// on any page reached through notFound(). An explicit tag added here never
// reached <head> — it appeared only in the flight payload, because Next's own
// tag already holds that slot.
//
// e2e/smoke.spec.ts asserts the 404 status. It was a `test.fail()` while this
// stood, which is how the fix announced itself: the suite went red with
// "expected to fail, but passed".
export default async function NotFound() {
  const [ar, en] = await Promise.all([getDictionary("ar"), getDictionary("en")]);
  return (
    <NotFoundBody
      copies={{ ar: ar.notFound, en: en.notFound }}
      supportHref={supportWaLink()}
    />
  );
}
