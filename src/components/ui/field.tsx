import { ChevronDown } from "lucide-react";
import { Children, cloneElement, isValidElement } from "react";
import type { ComponentProps, ReactNode } from "react";

// The ONE definition of form controls. Replaces the ad-hoc `fieldClass` string
// copy-pasted across ~15 forms (auth-forms, edit-store-form, coupon-manager,
// address-manager, ...). <Field> wraps any control with label/hint/error;
// <Input>, <Textarea>, <Select> are the styled native controls. Spacing uses
// logical properties (pe-*, end-*) so everything is RTL-safe.

// Exported so existing forms can adopt by deleting their local constant first,
// then migrate to the components at their own pace.
export const fieldClass =
  // border-strong, not border: a control's border is its only boundary cue and
  // must clear 3:1 against the surrounding surface (WCAG 1.4.11). Decorative
  // dividers keep the quieter --border.
  // text-base below sm: iOS Safari zooms the page into any focused control
  // whose text is under 16px (login, signup, every <Input>), and stays zoomed.
  "h-11 w-full rounded-xl border border-border-strong bg-surface px-4 text-base sm:text-sm text-foreground " +
  "outline-none transition-[border-color,box-shadow] duration-150 " +
  "placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60";

const errorClass = "border-danger focus:border-danger focus:ring-danger/15";

// ---------------------------------------------------------------------------
// Why `htmlFor` is REQUIRED and not merely encouraged.
//
// A <label> with no `for` is not a label. It is a line of bold text that
// happens to sit above a box. A screen-reader user hears "edit, blank" with no
// idea what to type; a sighted user on a phone taps the word and nothing
// focuses, because the tap target is the 40 pixels of the input alone rather
// than the 300 pixels of label-plus-input. On an Arabic delivery-address form,
// on a phone, that is the difference between an order and an abandoned cart.
//
// This was 44 call sites with 4 orphans (backlog row B-20 said 64; that number
// predates the migration and is stale — re-counted here). Fixing the 4 fixes
// today; making the prop required fixes every day after, because the 45th call
// site cannot be written wrong — `tsc` refuses it. A convention that depends on
// a reviewer noticing is one that regresses the week the reviewer is on holiday.
//
// Three shapes, and the type allows exactly these three:
//
//   <Field label="Phone" htmlFor="phone"><Input id="phone" /></Field>
//        one control, one label, wired together.
//
//   <Field label="Account type" group>…several controls…</Field>
//        SEVERAL controls under one heading — a radio row, a button group, a
//        pair of date inputs. `htmlFor` is not merely unnecessary here, it is
//        WRONG: `for` may only address a labelable element, so aiming it at the
//        wrapping <div> silently does nothing at all. This renders
//        <fieldset>/<legend>, which is the HTML that genuinely groups controls
//        and needs no id.
//
//   <Field><Input aria-label="…" /></Field>
//        no visible label; the control labels itself.
//
// What this does NOT guarantee: that `htmlFor` names an element that exists.
// TypeScript checks that a string was passed, not what it points at. The
// id auto-wiring below closes most of that gap, but a Field whose child is a
// custom component that swallows `id` can still be mis-wired. The axe checks in
// e2e/accessibility.spec.ts are the backstop for that half.
// ---------------------------------------------------------------------------

type FieldCommon = {
  hint?: ReactNode;
  /** When set, replaces the hint and turns the message red. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

// These three are named rather than inlined so that TypeScript prints the name
// in the failure. "Property 'htmlFor' is missing ... but required in type
// 'FieldWithLabel'" tells you what to do; the same error against an anonymous
// inline object type does not.

/** A visible label for exactly ONE control. `htmlFor` is mandatory. */
type FieldWithLabel = {
  /** Visible label text. */
  label: ReactNode;
  /**
   * The `id` of the control this label belongs to. MANDATORY: a <label>
   * without `for` is decoration, not a label. If the id is not already on the
   * control, Field puts it there for you.
   */
  htmlFor: string;
  group?: never;
};

/**
 * A visible label over SEVERAL controls — a radio row, a button group, a pair
 * of date inputs. Renders <fieldset>/<legend>. `htmlFor` is rejected here on
 * purpose: `for` may only address a single labelable element, so pointing it at
 * the wrapper would be silently inert.
 */
type FieldWithGroupLabel = {
  label: ReactNode;
  group: true;
  htmlFor?: never;
};

/** No visible label — the control labels itself (aria-label, or a title). */
type FieldWithoutLabel = { label?: undefined; htmlFor?: never; group?: never };

type FieldProps = FieldCommon &
  (FieldWithLabel | FieldWithGroupLabel | FieldWithoutLabel);

/** Label + control + hint/error wrapper. Pass the control as children. */
export function Field(props: FieldProps) {
  // Read through `props` rather than destructuring in the signature: `htmlFor`
  // and `group` exist on only some members of the union, and a destructuring
  // default (`group = false`) would widen the parameter type back to a shape
  // that accepts `label` without either — which is the whole thing this type
  // exists to forbid.
  const {
    label,
    hint,
    error,
    required = false,
    className = "",
    children,
  } = props;
  const htmlFor = "htmlFor" in props ? props.htmlFor : undefined;
  const group = "group" in props && props.group === true;
  // Two things are mirrored onto the child, but ONLY when the child is actually
  // a form control:
  //
  //   `required`/`aria-required`, because the asterisk in the label is
  //   aria-hidden and the requirement has to reach assistive tech some other
  //   way;
  //
  //   `id`, when `htmlFor` was given and the control does not already carry one.
  //   That is what turns "htmlFor is required" from box-ticking into a real
  //   association: label and control cannot disagree if only one of the two was
  //   written by hand. An explicit `id` still wins — the child's own props are
  //   spread last — so the 39 call sites that already pass both are unchanged.
  //
  // WHY THE `isControl` CHECK EXISTS, in full, because I got this wrong once and
  // the failure was not obvious:
  //
  //   The login form is <Field label htmlFor="password"><div className="relative">
  //   <input id="password" />…show/hide button…</div></Field>. The single child
  //   is the positioning WRAPPER, not the input. Injecting the id onto whatever
  //   single element happened to be there put `id="password"` on that <div> —
  //   giving the document TWO elements with the same id, breaking every
  //   `#password` lookup, and pointing the <label> at the div rather than the
  //   input, which is worse than the orphaned label this code exists to prevent.
  //   `e2e/smoke.spec.ts` caught it on the first run.
  //
  //   So: mirror onto <Input>/<Select>/<Textarea> and the native tags, and
  //   NOTHING else. A wrapper keeps its props and the author keeps the
  //   responsibility, which is the honest division — this component cannot know
  //   which descendant of an arbitrary tree is the control.
  const single = Children.count(children) === 1 && isValidElement(children);
  const childType = single ? (children as React.ReactElement).type : null;
  const isControl =
    childType === Input ||
    childType === Select ||
    childType === Textarea ||
    childType === "input" ||
    childType === "select" ||
    childType === "textarea";
  const childProps = single
    ? ((children as React.ReactElement).props as Record<string, unknown>)
    : {};
  const injected: Record<string, unknown> = {};
  if (required && isControl) {
    injected.required = true;
    injected["aria-required"] = true;
  }
  if (htmlFor && !group && isControl && childProps.id === undefined)
    injected.id = htmlFor;

  const content =
    single && Object.keys(injected).length > 0
      ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          ...injected,
          ...childProps,
        })
      : children;

  const marker = required ? (
    <span className="text-danger" aria-hidden="true">
      {" "}
      *
    </span>
  ) : null;

  const messages = error ? (
    <p className="text-xs font-medium text-danger" role="alert">
      {error}
    </p>
  ) : hint ? (
    <p className="text-xs text-muted-foreground">{hint}</p>
  ) : null;

  if (label && group) {
    // `min-w-0` because a fieldset sets a min-content floor on its contents
    // that stops them shrinking — a horizontal-scroll defect waiting to happen
    // at 375px, which is the exact thing e2e/mobile.spec.ts watches for.
    // border-0/p-0 because the browser default fieldset chrome is not this
    // design system's.
    return (
      <fieldset className={`min-w-0 space-y-1.5 border-0 p-0 ${className}`}>
        <legend className="block p-0 text-sm font-semibold">
          {label}
          {marker}
        </legend>
        {content}
        {messages}
      </fieldset>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-semibold">
          {label}
          {marker}
        </label>
      )}
      {content}
      {messages}
    </div>
  );
}

export function Input({
  error = false,
  className = "",
  ...props
}: { error?: boolean } & Omit<ComponentProps<"input">, "ref">) {
  return (
    <input
      className={`${fieldClass} ${error ? errorClass : ""} ${className}`}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

export function Textarea({
  error = false,
  className = "",
  ...props
}: { error?: boolean } & Omit<ComponentProps<"textarea">, "ref">) {
  return (
    <textarea
      className={`${fieldClass} h-auto min-h-24 resize-y py-3 ${error ? errorClass : ""} ${className}`}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

/** Styled native select with a chevron affordance (logical `end`, RTL-safe). */
export function Select({
  error = false,
  className = "",
  children,
  ...props
}: { error?: boolean } & Omit<ComponentProps<"select">, "ref">) {
  return (
    <span className={`relative block ${className}`}>
      <select
        className={`${fieldClass} appearance-none pe-10 ${error ? errorClass : ""}`}
        aria-invalid={error || undefined}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </span>
  );
}
