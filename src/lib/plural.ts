/**
 * Arabic counted nouns, which "{n} خدمة" gets wrong for most numbers.
 *
 * "3 خدمة" is not a typo a reader forgives — Arabic inflects the noun by the
 * count: one is مفرد, two is مثنى (خدمتين, no numeral at all), three to ten take
 * the plural (3 خدمات), and eleven upwards go back to the singular (11 خدمة).
 *
 * The buckets follow CLDR's Arabic rules, minus `zero` — every counter here is
 * rendered only when it has something to count, so a zero form would be a
 * string that can never appear. English dictionaries fill the same four keys
 * (one = singular, the rest plural), so one call serves both locales.
 *
 * Pure (no server or client imports): usable from server pages and "use
 * client" components alike.
 */
export type CountForms = { one: string; two: string; few: string; many: string };

export function countLabel(forms: CountForms, n: number): string {
  const mod100 = Math.abs(n) % 100;
  const form =
    n === 1
      ? forms.one
      : n === 2
        ? forms.two
        : mod100 >= 3 && mod100 <= 10
          ? forms.few
          : forms.many;
  return form.replace("{n}", String(n));
}
