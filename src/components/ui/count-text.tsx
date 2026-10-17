import { countLabel, type CountForms } from "@/lib/plural";

/**
 * A counted noun («3 محلات», «محلّين») with the figure emphasised, for the
 * places that used to print a bold number followed by one fixed noun
 * («3 محل»). The dual and the singular carry no numeral at all, so the
 * phrase is built by `countLabel` first and the figure, if it is there, is
 * wrapped afterwards. No hooks: usable from server and client components.
 */
export function CountText({
  forms,
  n,
  numberClassName = "font-bold tabular-nums text-foreground",
}: {
  forms: CountForms;
  n: number;
  numberClassName?: string;
}) {
  const text = countLabel(forms, n);
  const digits = String(n);
  const at = text.indexOf(digits);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className={numberClassName}>{digits}</span>
      {text.slice(at + digits.length)}
    </>
  );
}
