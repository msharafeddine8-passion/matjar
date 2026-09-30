"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarCheck,
  Check,
  Clock,
  Info,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { categoryStyles, type CategoryKey } from "@/lib/catalog";
import { attributeSummary } from "@/lib/attributes";
import { waLink } from "@/lib/whatsapp";
import { daySpan, generateSlots, type WeekHours } from "@/lib/hours";
import { localized } from "@/lib/i18n-field";
import { groupBySection, type SectionInfo } from "@/lib/sections";
import { categoryIcons } from "@/components/category-icon";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { formatUsd } from "@/lib/currency";
import { Money } from "@/components/ui/money";
import { TagSource } from "@/components/attribution/tag-source";
import { lowestOptionPrice, type ServiceOption } from "@/lib/service-options";

type Service = {
  id: string;
  name: string;
  nameEn?: string | null;
  price: number;
  imageUrl?: string | null;
  attributes?: Record<string, string> | null;
  sectionId?: string | null;
  // Booking engine v2 (0174): how this service is delivered.
  allocationMode?: string | null;
  durationMinutes?: number | null;
  bufferMinutes?: number | null;
  capacityPerSlot?: number | null;
  /** 0321: priced options (short / long hair, 30 / 60 minutes). Empty = the
   *  service has one price. Each option may carry its own duration. */
  options?: ServiceOption[];
};

type BusyRange = { s: string; e: string };
type Avail = {
  mode: string | null;
  duration: number;
  buffer: number;
  capacity: number | null;
  busy: BusyRange[];
  busy_by_provider: Record<string, BusyRange[]>;
  windows: { s: string; e: string }[] | null;
  blocked: boolean;
};

// min-h-11 is the 44px thumb target — every field here is also a tap target on
// a phone, and a 40px select is a miss as often as a hit.
const fieldClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-muted-foreground";
const labelClass = "text-sm font-semibold";
// A sheet trigger reads as the value it holds, not as an empty box: the
// customer's own answer is the label once they've given one.
const triggerClass =
  "mt-1.5 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-start text-sm font-semibold transition-colors lg:hidden";

/** The phone flow, in order. `provider` drops out of stores with one choice. */
type Step = "service" | "provider" | "date" | "time" | "details" | "review";

export function BookingPanel({
  storeId,
  lang,
  dict,
  category,
  services,
  customerName,
  customerPhone = null,
  whatsapp = null,
  storeName = "",
  hours = null,
  slotMinutes = 30,
  doctors = [],
  providerServices = {},
  sections = [],
  initialServiceId = null,
  cancelHours = 0,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
  category: CategoryKey;
  services: Service[];
  customerName: string | null;
  customerPhone?: string | null;
  whatsapp?: string | null;
  storeName?: string;
  hours?: WeekHours | null;
  slotMinutes?: number;
  doctors?: { id: string; name: string; specialty?: string | null }[];
  /** productId -> provider ids that offer it. Absent/empty = any provider. */
  providerServices?: Record<string, string[]>;
  sections?: SectionInfo[];
  /** Preselect a service — set when the customer arrives from a service page. */
  initialServiceId?: string | null;
  /** stores.booking_cancel_hours — 0 means the customer can cancel anytime. */
  cancelHours?: number;
}) {
  const router = useRouter();
  const Icon = categoryIcons[category];
  const style = categoryStyles[category];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookedWaUrl, setBookedWaUrl] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);
  // Conflict awareness: taken time strings for the picked date (legacy path).
  const [taken, setTaken] = useState<string[]>([]);
  // New-engine availability (mode/duration/busy ranges/windows) — 0174.
  const [avail, setAvail] = useState<Avail | null>(null);
  const [time, setTime] = useState("");
  const [pickedDate, setPickedDate] = useState("");
  // Availability is scoped to the chosen service (a different service at the
  // same time is fine — different provider/room), so we track the selection.
  // Arriving from a service detail page preselects it, so the customer lands on
  // the slot picker instead of an empty dropdown they must re-navigate.
  const [serviceId, setServiceId] = useState(initialServiceId ?? "");
  // 0321: which of the service's priced options was chosen ("" = none yet).
  const [optionId, setOptionId] = useState(() => {
    const opts = services.find((s) => s.id === (initialServiceId ?? ""))?.options ?? [];
    return opts.length === 1 ? opts[0].id : "";
  });
  // Coupon (validated against the chosen service price; discount is honored on
  // arrival — there's no online payment).
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  // Multi-doctor clinics: availability is per doctor, so bookings for different
  // doctors don't block each other. Defaults to the first (server-ordered).
  const [doctorId, setDoctorId] = useState<string>(doctors[0]?.id ?? "");
  // Waitlist: when the chosen day is fully booked, let the customer get in line.
  const [waitBusy, setWaitBusy] = useState(false);
  const [waitJoined, setWaitJoined] = useState(false);
  // Prefill the name only when the account actually has a real name — never the
  // email, so a booking is never recorded under an email address.
  const prefillName =
    customerName && !customerName.includes("@") ? customerName : "";
  // Name and phone are controlled so the phone flow can gate "continue" on
  // them, and so a failed submission never empties a field the customer would
  // have to retype.
  const [name, setName] = useState(prefillName);
  // Contact number so the merchant can reach the customer about the booking.
  const [phone, setPhone] = useState(customerPhone ?? "");
  // MJ-020. Clinics only, and optional. The one thing a practice cannot work
  // out from the booking itself and that changes what it does with it: a first
  // visit needs a longer slot and a file that does not exist yet. Everything
  // else on that audit row was rejected — see migration 0297 for why.
  const [patientStatus, setPatientStatus] = useState("");
  const asksPatientStatus = category === "healthcare";
  // Phone-only step cursor. Above `lg` every block is visible at once, so this
  // is inert there — nothing branches on it except which block is hidden.
  const [stepIdx, setStepIdx] = useState(0);
  const [dateSheet, setDateSheet] = useState(false);
  const [timeSheet, setTimeSheet] = useState(false);

  // A provider can deliver a service if it's unassigned or explicitly linked.
  const offeredBy = (svcId: string, doctor: string) => {
    const assigned = providerServices[svcId];
    return (
      !assigned ||
      assigned.length === 0 ||
      (!!doctor && assigned.includes(doctor))
    );
  };
  // Services shown in the picker are limited to what the chosen provider offers
  // ("any available" imposes no filter — the engine assigns at placement).
  const visibleServices =
    doctorId && doctorId !== "any"
      ? services.filter((s) => offeredBy(s.id, doctorId))
      : services;

  const selectedService = services.find((s) => s.id === serviceId) ?? null;
  const engineMode = selectedService?.allocationMode ?? null;
  // Providers grouped by specialty/department for the picker.
  const doctorGroups = doctors.reduce<
    Record<string, typeof doctors>
  >((acc, d) => {
    const key = d.specialty?.trim() || "";
    (acc[key] ??= []).push(d);
    return acc;
  }, {});

  // 0321: the chosen option decides the price and, when it has one, the
  // duration — the same rule place_booking applies on the server.
  const serviceOptions = selectedService?.options ?? [];
  const selectedOption = serviceOptions.find((o) => o.id === optionId) ?? null;
  const needsOption = serviceOptions.length > 0 && !selectedOption;
  const effDuration = avail
    ? (selectedOption?.durationMinutes ?? avail.duration)
    : 0;

  // Fresha-style slot grid when the merchant configured structured hours;
  // otherwise fall back to a free time input + taken-times chips. The step is
  // the SERVICE's real duration (+buffer) on the new engine.
  const span = pickedDate
    ? daySpan(hours, new Date(`${pickedDate}T00:00:00`))
    : null;
  const engineStep =
    avail && avail.mode ? effDuration + avail.buffer : slotMinutes;
  const slots = hours && span ? generateSlots(span, engineStep) : null;
  const dayClosed = (!!hours && !!pickedDate && !span) || !!avail?.blocked;

  // No booking a time that has already passed today (Asia/Beirut, so it's
  // correct whatever timezone the customer's device is in). The DB trigger is
  // the hard guard; this just hides past slots so they can't be picked.
  const nowRef = new Date();
  const todayBeirut = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut",
  }).format(nowRef);
  const nowBeirut = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Beirut",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(nowRef);
  const isPastSlot = (slot: string) =>
    pickedDate === todayBeirut && slot <= nowBeirut;

  async function joinWaitlist() {
    if (waitBusy || !serviceId || !pickedDate) return;
    setWaitBusy(true);
    const { data, error: err } = await createClient().rpc(
      "join_booking_waitlist",
      {
        p_store_id: storeId,
        p_product_id: serviceId,
        p_date: pickedDate,
        p_doctor_id: doctorId && doctorId !== "any" ? doctorId : null,
        p_customer_name: prefillName || null,
        p_phone: null,
      },
    );
    setWaitBusy(false);
    const res = data as { ok: boolean; code?: string } | null;
    if (err || !res?.ok) {
      setError(
        res?.code === "already_waiting"
          ? dict.booking.waitlist.already
          : dict.auth.errorGeneric,
      );
      return;
    }
    setWaitJoined(true);
  }

  function addMinutes(hhmm: string, mins: number) {
    const [h, m] = hhmm.split(":").map(Number);
    const t = h * 60 + m + mins;
    return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }
  function rangesOverlap(r: BusyRange, a: number, b: number) {
    const s = new Date(r.s).getTime();
    const e = new Date(r.e).getTime();
    return s < b && e > a;
  }
  // Per-slot verdict under the selected service's allocation mode.
  function slotState(slot: string): { blocked: boolean; remaining?: number } {
    if (isPastSlot(slot)) return { blocked: true };
    if (!engineMode || !avail) return { blocked: taken.includes(slot) };
    if (avail.blocked) return { blocked: true };
    const a = new Date(`${pickedDate}T${slot}:00`).getTime();
    const b = a + (effDuration + avail.buffer) * 60000;
    if (avail.windows) {
      const end = addMinutes(slot, effDuration);
      const fits = avail.windows.some(
        (w) => slot >= w.s.slice(0, 5) && end <= w.e.slice(0, 5),
      );
      if (!fits) return { blocked: true };
    }
    if (engineMode === "request_based") return { blocked: false };
    if (engineMode === "capacity_based") {
      const used = avail.busy.filter((r) => rangesOverlap(r, a, b)).length;
      const cap = avail.capacity ?? 1;
      return { blocked: used >= cap, remaining: Math.max(0, cap - used) };
    }
    if (engineMode === "pooled_providers" && doctorId === "any") {
      const lists = Object.values(avail.busy_by_provider ?? {});
      if (lists.length === 0) return { blocked: true };
      const someoneFree = lists.some(
        (rs) => !rs.some((r) => rangesOverlap(r, a, b)),
      );
      return { blocked: !someoneFree };
    }
    return { blocked: avail.busy.some((r) => rangesOverlap(r, a, b)) };
  }

  // The whole chosen day is unavailable: either the merchant is closed, or
  // every generated slot is blocked. request_based never counts as full
  // (it's a request, not a fixed seat).
  const dayFull =
    !!hours &&
    !!pickedDate &&
    !!serviceId &&
    engineMode !== "request_based" &&
    (dayClosed ||
      (!!slots && slots.length > 0 && slots.every((s) => slotState(s).blocked)));

  // ── Phone step flow ────────────────────────────────────────────────────────
  // A step is only worth a screen when it asks a real question: a store with a
  // single provider has no choice to offer, so it never gets a provider step.
  const steps: Step[] =
    doctors.length > 1
      ? ["service", "provider", "date", "time", "details", "review"]
      : ["service", "date", "time", "details", "review"];
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  // What each step must have answered before the customer may move on. This
  // gates navigation only — the submit button keeps its own guard, and the DB
  // is still the authority on whether the slot is really free.
  const stepReady: Record<Step, boolean> = {
    service: !!serviceId && !needsOption,
    provider: !!doctorId,
    date: !!pickedDate,
    time: !!time && !slotState(time).blocked,
    details: !!name.trim() && !!phone.trim(),
    review: true,
  };
  const stepLabels: Record<Step, string> = {
    service: dict.booking.steps.service,
    provider: dict.booking.steps.provider,
    date: dict.booking.steps.date,
    time: dict.booking.steps.time,
    details: dict.booking.steps.details,
    review: dict.booking.steps.review,
  };
  // Inactive blocks stay mounted and merely hidden: `display:none` fields are
  // still submitted with the form, so stepping forward and back can never drop
  // an answer, and a failed submission leaves every field as the customer left
  // it. Above `lg` nothing is hidden — the single panel is unchanged.
  const stepShell = (s: Step) => (step === s ? "" : "hidden lg:block");
  const goTo = (s: Step) => {
    const i = steps.indexOf(s);
    if (i >= 0) setStepIdx(i);
  };

  const dateFmt = new Intl.DateTimeFormat(lang, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const dateLabel = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00`));
  // Three weeks of taps instead of a native date roller. Generated from the
  // same Beirut "today" the `min` attribute uses, so the sheet can never offer
  // a day the input itself would reject.
  const dayOptions = Array.from({ length: 21 }, (_, i) => {
    const d = new Date(`${todayBeirut}T00:00:00`);
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { iso, label: dateFmt.format(d), closed: !!hours && !daySpan(hours, d) };
  });

  const providerLabel =
    doctorId === "any"
      ? dict.booking.anyProvider
      : (doctors.find((d) => d.id === doctorId)?.name ?? "");
  const serviceLabel = selectedService
    ? localized(selectedService.name, selectedService.nameEn, lang) +
      (selectedOption ? ` — ${selectedOption.label}` : "")
    : "";

  async function refreshTaken(date: string, doctor: string, service: string) {
    // Nothing to conflict against until a service (or a doctor) is chosen.
    if (!date || (!doctor && !service)) {
      setTaken([]);
      setAvail(null);
      return;
    }
    // New engine (service declares an allocation mode): one RPC returns mode,
    // real duration, blocking ranges and provider windows.
    const svcMode =
      services.find((s) => s.id === service)?.allocationMode ?? null;
    if (service && svcMode) {
      const { data } = await createClient().rpc("get_booking_busy", {
        p_store_id: storeId,
        p_product_id: service,
        p_date: date,
        p_doctor_id: doctor && doctor !== "any" ? doctor : null,
        p_any: doctor === "any",
      });
      setAvail((data as Avail | null) ?? null);
      setTaken([]);
      return;
    }
    setAvail(null);
    const { data } = await createClient().rpc("booked_times", {
      p_store_id: storeId,
      p_date: date,
      p_doctor_id: doctor && doctor !== "any" ? doctor : null,
      p_product_id: service || null,
    });
    setTaken(((data as string[] | null) ?? []).sort());
  }

  async function onDateChange(date: string) {
    setError(null);
    setPickedDate(date);
    setTime("");
    await refreshTaken(date, doctorId, serviceId);
  }

  async function onDoctorChange(doctor: string) {
    setDoctorId(doctor);
    setTime("");
    // If the current service isn't offered by the new provider, clear it
    // ("any available" imposes no filter).
    let svc = serviceId;
    if (doctor !== "any" && svc && !offeredBy(svc, doctor)) {
      svc = "";
      setServiceId("");
    }
    await refreshTaken(pickedDate, doctor, svc);
  }

  async function onServiceChange(service: string) {
    setServiceId(service);
    // A single option is the only choice there is; several must be picked.
    const opts = services.find((s) => s.id === service)?.options ?? [];
    setOptionId(opts.length === 1 ? opts[0].id : "");
    setTime("");
    // The discount is tied to the service price — reset it when the service
    // changes so a stale discount can't carry over.
    setCoupon(null);
    setCouponError(null);
    // Pooled team services default to "any available" — the engine assigns.
    let doctor = doctorId;
    const mode = services.find((s) => s.id === service)?.allocationMode ?? null;
    if (mode === "pooled_providers" && doctors.length > 0) {
      doctor = "any";
      setDoctorId("any");
    } else if (doctorId === "any") {
      doctor = doctors[0]?.id ?? "";
      setDoctorId(doctor);
    }
    await refreshTaken(pickedDate, doctor, service);
  }

  const selectedPrice = selectedOption?.price ?? selectedService?.price ?? 0;

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code || !serviceId) return;
    setCouponBusy(true);
    setCouponError(null);
    const { data } = await createClient().rpc("validate_coupon", {
      p_store_id: storeId,
      p_code: code,
      p_subtotal: selectedPrice,
    });
    setCouponBusy(false);
    const row = (data as { valid: boolean; discount: number }[] | null)?.[0];
    if (row?.valid) {
      setCoupon({ code, discount: Number(row.discount) || 0 });
    } else {
      setCoupon(null);
      setCouponError(dict.booking.couponInvalid);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A phone keyboard's "Go" submits the form from whatever field has focus.
    // That would skip the review step — the only place stating that this is a
    // request awaiting confirmation and what the cancellation window is — so on
    // the step flow an early submit advances instead of booking. The step flow
    // exists only below `lg`, which is exactly what this asks.
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 1024px)").matches &&
      step !== "review"
    ) {
      if (stepReady[step]) setStepIdx((i) => Math.min(i + 1, steps.length - 1));
      return;
    }
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      router.push(`/${lang}/login`);
      return;
    }
    const serviceId = String(form.get("service_id"));
    const service = services.find((s) => s.id === serviceId);
    if (needsOption) {
      setError(dict.booking.chooseOptionFirst);
      setLoading(false);
      return;
    }
    const bookedName = service
      ? selectedOption
        ? `${service.name} — ${selectedOption.label}`
        : service.name
      : null;
    const chosenDate = String(form.get("date")) || "";
    const chosenTime = String(form.get("time")) || "";

    // Guard against a past time (e.g. slot picked, then time passed).
    if (chosenTime && isPastSlot(chosenTime)) {
      setError(dict.booking.pastSlot);
      setLoading(false);
      return;
    }

    // New engine: one atomic RPC computes the real range, assigns pooled
    // providers, checks hours/capacity, and the DB constraints win any race.
    if (service?.allocationMode) {
      const { data: res, error: rpcErr } = await supabase.rpc("place_booking", {
        p_store_id: storeId,
        p_product_id: serviceId,
        p_date: chosenDate,
        p_time: chosenTime,
        p_doctor_id: doctorId && doctorId !== "any" ? doctorId : null,
        p_any: doctorId === "any",
        p_customer_name:
          String(form.get("customer_name")).trim() || customerName,
        p_phone: phone.trim() || null,
        p_notes: String(form.get("notes")) || null,
        p_coupon: coupon?.code ?? null,
        // 0321: optional and last, so the server keeps accepting calls
        // without it (the old 10-argument function was dropped, not kept
        // beside this one, so PostgREST has one candidate).
        p_variant_id: selectedOption?.id ?? null,
      });
      const r = res as { ok?: boolean; code?: string; id?: string } | null;
      if (rpcErr || !r?.ok) {
        const code = r?.code ?? "";
        setError(
          rpcErr?.message?.includes("past_booking")
            ? dict.booking.pastSlot
            : code === "slot_taken"
            ? dict.booking.slotTaken
            : code === "capacity_full"
              ? dict.booking.capacityFull
              : code === "no_provider_free"
                ? dict.booking.noProviderFree
                : code === "outside_hours"
                  ? dict.booking.outsideHours
                  : code === "option_unavailable"
                    ? dict.booking.optionUnavailable
                    : dict.auth.errorGeneric,
        );
        if (code === "slot_taken" || code === "capacity_full") {
          await refreshTaken(chosenDate, doctorId, serviceId);
        }
        setLoading(false);
        return;
      }
      // place_booking's signature is a contract with the deployed app, so it
      // cannot take this as an 11th argument (0297 explains why that would
      // break every existing 10-argument call). It goes in a second,
      // deliberately narrow call against the id place_booking just returned.
      // Failure is swallowed on purpose: the appointment already exists and is
      // valid without this answer, and turning an optional extra into "booking
      // failed" would be a lie.
      if (asksPatientStatus && patientStatus && r?.id) {
        await supabase.rpc("set_booking_intake", {
          p_booking_id: r.id,
          p_patient_status: patientStatus,
        });
      }
    } else {
    // Legacy path — re-check the slot right before inserting (someone may
    // have taken it while the form was open).
    if (chosenDate && chosenTime) {
      const { data: freshTaken } = await supabase.rpc("booked_times", {
        p_store_id: storeId,
        p_date: chosenDate,
        p_doctor_id: doctorId || null,
        p_product_id: serviceId || null,
      });
      if (((freshTaken as string[] | null) ?? []).includes(chosenTime)) {
        setTaken(((freshTaken as string[] | null) ?? []).sort());
        setError(dict.booking.slotTaken);
        setLoading(false);
        return;
      }
    }
    const { error: bookingError } = await supabase.from("bookings").insert({
      store_id: storeId,
      customer_id: user.id,
      product_id: serviceId || null,
      service_name: bookedName,
      // The option, never a price: this path writes from the browser, so a
      // price here would be whatever the customer sent. place_booking (the
      // engine path) records the price server-side.
      variant_id: selectedOption?.id ?? null,
      doctor_id: doctorId || null,
      requested_date: String(form.get("date")) || null,
      requested_time: String(form.get("time")) || null,
      customer_name: String(form.get("customer_name")).trim() || customerName,
      phone: phone.trim() || null,
      notes: String(form.get("notes")) || null,
      coupon_code: coupon?.code ?? null,
      discount: coupon?.discount ?? 0,
      // Legacy services insert directly, so this needs no second call here.
      patient_status: (asksPatientStatus && patientStatus) || null,
    });
    if (bookingError) {
      // 23505 = the DB slot-conflict unique index fired (someone grabbed the
      // slot in the race window). Show the friendly "slot taken" message.
      if (bookingError.code === "23505") {
        await refreshTaken(chosenDate, doctorId, serviceId);
        setError(dict.booking.slotTaken);
      } else if (bookingError.message?.includes("past_booking")) {
        setError(dict.booking.pastSlot);
      } else {
        setError(dict.auth.errorGeneric);
      }
      setLoading(false);
      return;
    }
    }
    // Pre-build a WhatsApp message so the customer can notify the clinic
    // instantly instead of relying on the merchant checking the dashboard.
    if (whatsapp) {
      const date = String(form.get("date")) || "";
      const time = String(form.get("time")) || "";
      const notes = String(form.get("notes")) || "";
      const msg = [
        `${dict.booking.waGreeting} ${storeName}`.trim(),
        bookedName ? `• ${bookedName}` : "",
        [date, time].filter(Boolean).join(" "),
        notes,
      ]
        .filter(Boolean)
        .join("\n");
      setBookedWaUrl(waLink(whatsapp, msg));
    }
    setLoading(false);
    setBooked(true);
    router.refresh();
  }

  if (booked) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success-soft p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-strong text-success-strong-foreground">
          <Check className="h-6 w-6" />
        </div>
        <TagSource kind="booking" storeId={storeId} />
        <h3 className="mt-3 text-lg font-extrabold">
          {dict.booking.bookedTitle}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {dict.booking.bookedNote}
        </p>
        <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          {bookedWaUrl && (
            <a
              href={bookedWaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl bg-whatsapp px-5 py-3 text-sm font-bold text-whatsapp-foreground transition-colors hover:bg-whatsapp-hover"
            >
              <MessageCircle className="h-4 w-4" />
              {dict.booking.notifyMerchantWa}
            </a>
          )}
          <Link
            href={`/${lang}/bookings`}
            className="rounded-xl border border-border bg-surface px-5 py-3 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
          >
            {dict.booking.viewMyBookings}
          </Link>
        </div>
      </div>
    );
  }

  // A section's services (or the whole flat list) rendered with the same card.
  function renderServices(list: Service[]) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {list.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4"
          >
            {s.imageUrl ? (
              <Image src={s.imageUrl} alt={localized(s.name, s.nameEn, lang)} width={64} height={64} className="h-16 w-16 shrink-0 rounded-xl object-cover" sizes="64px" />
            ) : (
              <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${style.cover}`}>
                <Icon className="h-7 w-7 text-foreground/20" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-bold">{localized(s.name, s.nameEn, lang)}</h3>
              {attributeSummary(category, s.attributes, lang) && (
                <p className="truncate text-xs text-muted-foreground">
                  {attributeSummary(category, s.attributes, lang)}
                </p>
              )}
              <p className="mt-0.5 text-sm font-bold">
                {s.options && s.options.length > 0
                  ? dict.booking.fromPrice.replace(
                      "{price}",
                      formatUsd(lowestOptionPrice(s.price, s.options)),
                    )
                  : formatUsd(s.price)}
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // One slot grid, rendered twice: inline above `lg`, inside the sheet below
  // it. Two copies of this markup would eventually disagree about which slots
  // are bookable, and that disagreement is a double booking.
  function slotGrid(inSheet: boolean) {
    return (
      <div
        className={
          inSheet ? "grid grid-cols-3 gap-2 pb-2" : "mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4"
        }
      >
        {(slots ?? []).map((s) => {
          const st = slotState(s);
          const isTaken = st.blocked;
          return (
            <button
              key={s}
              type="button"
              disabled={isTaken}
              onClick={() => {
                setTime(s);
                setTimeSheet(false);
              }}
              dir="ltr"
              className={`flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 py-2 text-sm font-bold tabular-nums transition-colors ${
                isTaken
                  ? "cursor-not-allowed border-border bg-surface-muted text-muted-foreground line-through opacity-60"
                  : time === s
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary/50"
              }`}
            >
              {s}
              {st.remaining != null &&
                st.remaining > 0 &&
                avail?.capacity != null &&
                st.remaining < avail.capacity && (
                  <span className="block text-[10px] font-semibold opacity-80">
                    {dict.booking.spotsLeft.replace("{n}", String(st.remaining))}
                  </span>
                )}
            </button>
          );
        })}
      </div>
    );
  }

  // Group into service groups when defined; else one flat list (no regression).
  const groups = groupBySection(services, sections);

  const whenLabel = [pickedDate ? dateLabel(pickedDate) : "", time]
    .filter(Boolean)
    .join(" · ");
  const netPrice = Math.max(0, selectedPrice - (coupon?.discount ?? 0));
  // The first question still unanswered. Named rather than counted, so the
  // review step can say what is missing instead of just refusing to submit.
  const firstIncomplete = steps.find((s) => !stepReady[s]);
  // Every review line is also the way back to the step that set it.
  const reviewRows: { target: Step; label: string; value: string }[] = [
    { target: "service", label: dict.booking.selectService, value: serviceLabel },
    { target: "date", label: dict.booking.date, value: whenLabel },
    {
      target: "details",
      label: dict.booking.yourName,
      value: [name, phone].filter(Boolean).join(" · "),
    },
  ];
  if (doctors.length > 0) {
    reviewRows.splice(1, 0, {
      target: "provider",
      label: dict.booking.selectDoctor,
      value: providerLabel,
    });
  }

  return (
    <div>
      {sections.length > 0 ? (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.section?.id ?? "__other"}>
              <h3 className="mb-4 text-lg font-bold">
                {g.section
                  ? localized(g.section.name, g.section.nameEn, lang)
                  : dict.store.otherSection}
              </h3>
              {renderServices(g.items)}
            </section>
          ))}
        </div>
      ) : (
        renderServices(services)
      )}

      <div className="mt-8">
        <h3 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <CalendarCheck className="h-5 w-5 text-primary" />
          {dict.booking.title}
        </h3>
        {customerName ? (
          <>
          <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-surface p-5">
            {/* Phones only: what is being booked, restated at every step. The
                commonest booking mistake is confirming the wrong service or
                the wrong day, and one line of recap removes it. */}
            <div className="lg:hidden">
              <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface-muted/50 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {serviceLabel || dict.booking.steps.noService}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[providerLabel, whenLabel].filter(Boolean).join(" · ") ||
                      dict.booking.steps.noWhen}
                  </p>
                </div>
                {selectedPrice > 0 && (
                  <p className="shrink-0 text-sm font-extrabold tabular-nums">
                    <Money value={netPrice} />
                  </p>
                )}
              </div>
              <div className="mt-3 flex items-center gap-1.5" aria-hidden>
                {steps.map((s, i) => (
                  <span
                    key={s}
                    className={`h-1 flex-1 rounded-full ${i <= stepIdx ? "bg-primary" : "bg-border"}`}
                  />
                ))}
              </div>
              <p className="mt-2 text-label text-muted-foreground">
                {dict.booking.steps.counter
                  .replace("{n}", String(stepIdx + 1))
                  .replace("{total}", String(steps.length))}
              </p>
              <h4 className="text-h4">{stepLabels[step]}</h4>
            </div>

            <div className={stepShell("service")}>
              <label className={labelClass} htmlFor="service_id">
                {dict.booking.selectService}
              </label>
              <select
                id="service_id"
                name="service_id"
                required
                value={serviceId}
                onChange={(e) => onServiceChange(e.target.value)}
                className={fieldClass}
              >
                <option value="" disabled>
                  {dict.booking.selectService}
                </option>
                {visibleServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {localized(s.name, s.nameEn, lang)}
                  </option>
                ))}
              </select>
              {/* 0321: a service with several prices — the customer picks
                  which one before a slot, because the option can change the
                  slot's length as well as the price. */}
              {serviceOptions.length > 0 && (
                <fieldset className="mt-3">
                  <legend className={labelClass}>{dict.booking.chooseOption}</legend>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {serviceOptions.map((o) => {
                      const on = o.id === optionId;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setOptionId(o.id);
                            setTime("");
                            setCoupon(null);
                            setCouponError(null);
                          }}
                          className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-start text-sm transition-colors ${
                            on
                              ? "border-primary bg-primary-soft font-bold text-primary"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{o.label}</span>
                            {o.durationMinutes != null && (
                              <span className="block text-xs text-muted-foreground">
                                {dict.booking.optionDuration.replace("{n}", String(o.durationMinutes))}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-bold tabular-nums">
                            {formatUsd(o.price ?? selectedService?.price ?? 0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </div>
            {doctors.length > 0 && (
              <div className={stepShell("provider")}>
                <label className={labelClass} htmlFor="doctor_id">
                  {dict.booking.selectDoctor}
                </label>
                <select
                  id="doctor_id"
                  value={doctorId}
                  onChange={(e) => onDoctorChange(e.target.value)}
                  className={fieldClass}
                >
                  {engineMode === "pooled_providers" && (
                    <option value="any">{dict.booking.anyProvider}</option>
                  )}
                  {Object.entries(doctorGroups).map(([spec, docs]) =>
                    spec ? (
                      <optgroup key={spec} label={spec}>
                        {docs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      docs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))
                    ),
                  )}
                </select>
              </div>
            )}
            <div className={stepShell("date")}>
              <label className={`${labelClass} hidden lg:block`} htmlFor="date">
                {dict.booking.date}
              </label>
              <button
                type="button"
                onClick={() => setDateSheet(true)}
                aria-label={dict.booking.date}
                className={triggerClass}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CalendarCheck className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">
                    {pickedDate
                      ? dateLabel(pickedDate)
                      : dict.booking.steps.chooseDate}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-bold text-primary">
                  {dict.booking.steps.change}
                </span>
              </button>
              {/* The native input stays mounted below `lg` too: it carries the
                  `date` field the form submits, and hidden fields still post. */}
              <input
                id="date"
                name="date"
                type="date"
                required
                min={todayBeirut}
                value={pickedDate}
                onChange={(e) => onDateChange(e.target.value)}
                className={`${fieldClass} hidden lg:block`}
              />
            </div>

            <div className={`${stepShell("time")} space-y-4`}>
              {hours ? (
                <>
                  <input type="hidden" name="time" value={time} />
                  {pickedDate ? (
                    <div>
                      <span className={`${labelClass} hidden lg:block`}>
                        {dict.booking.pickSlot}
                      </span>
                      {dayClosed ? (
                        <p className="mt-2 rounded-xl bg-surface-muted p-3 text-sm font-semibold text-muted-foreground">
                          {dict.booking.noSlots}
                        </p>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setTimeSheet(true)}
                            aria-label={dict.booking.pickSlot}
                            className={triggerClass}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Clock className="h-4 w-4 shrink-0 text-primary" />
                              <span className="truncate tabular-nums" dir="ltr">
                                {time || dict.booking.steps.chooseTime}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs font-bold text-primary">
                              {dict.booking.steps.change}
                            </span>
                          </button>
                          <div className="hidden lg:block">{slotGrid(false)}</div>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-surface-muted p-3 text-sm font-semibold text-muted-foreground lg:hidden">
                      {dict.booking.steps.pickDateFirst}
                    </p>
                  )}
                </>
              ) : (
                <div>
                  <label className={labelClass} htmlFor="time">
                    {dict.booking.time}
                  </label>
                  <input
                    id="time"
                    name="time"
                    type="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className={fieldClass}
                  />
                </div>
              )}
              {engineMode && avail && (
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  {dict.booking.durationLabel.replace("{n}", String(effDuration))}
                </p>
              )}
              {dayFull &&
                (waitJoined ? (
                  <div className="rounded-xl bg-success-soft px-4 py-3 text-sm font-bold text-success">
                    {dict.booking.waitlist.joined}
                  </div>
                ) : (
                  <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
                    <p className="text-sm font-bold text-warning">
                      {dict.booking.waitlist.fullTitle}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {dict.booking.waitlist.fullNote}
                    </p>
                    <button
                      type="button"
                      onClick={joinWaitlist}
                      disabled={waitBusy}
                      className="mt-2.5 h-11 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
                    >
                      {dict.booking.waitlist.join}
                    </button>
                  </div>
                ))}
              {!hours && taken.length > 0 && (
                <div className="rounded-xl bg-warning-soft p-3">
                  <p className="text-xs font-bold text-warning">
                    {dict.booking.takenTimes}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {taken.map((tt) => (
                      <span
                        key={tt}
                        dir="ltr"
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          tt === time
                            ? "bg-danger-strong text-danger-strong-foreground"
                            : "bg-warning-soft text-warning"
                        }`}
                      >
                        {tt}
                      </span>
                    ))}
                  </div>
                  {time && taken.includes(time) && (
                    <p className="mt-1.5 text-xs font-bold text-danger">
                      {dict.booking.slotTaken}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className={`${stepShell("details")} space-y-4`}>
              <div>
                <label className={labelClass} htmlFor="customer_name">
                  {dict.booking.yourName}
                </label>
                <input
                  id="customer_name"
                  name="customer_name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={dict.booking.yourNamePlaceholder}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="customer_phone">
                  {dict.booking.yourPhone}
                </label>
                <input
                  id="customer_phone"
                  name="customer_phone"
                  type="tel"
                  inputMode="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+961 …"
                  className={fieldClass}
                />
              </div>
              {/* Clinics only, and never preselected — a default here would be
                  the practice answering on the patient's behalf, and "new"
                  guessed wrong is a slot that runs over. */}
              {asksPatientStatus && (
                <fieldset>
                  <legend className={labelClass}>
                    {dict.booking.patientStatus}
                  </legend>
                  <div className="mt-1.5 flex gap-2">
                    {(
                      [
                        ["new", dict.booking.patientNew],
                        ["returning", dict.booking.patientReturning],
                      ] as const
                    ).map(([value, text]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={patientStatus === value}
                        onClick={() =>
                          setPatientStatus(
                            patientStatus === value ? "" : value,
                          )
                        }
                        className={`min-h-11 flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${
                          patientStatus === value
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-surface hover:border-primary/50"
                        }`}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dict.booking.patientStatusHint}
                  </p>
                </fieldset>
              )}
              <div>
                <label className={labelClass} htmlFor="notes">
                  {dict.booking.notes}
                </label>
                <textarea id="notes" name="notes" rows={2} placeholder={dict.booking.notesPlaceholder} className={fieldClass} />
              </div>

              {/* Coupon — validated against the selected service price. */}
              {serviceId && selectedPrice > 0 && (
                <div>
                  <label className={labelClass} htmlFor="booking-coupon">
                    {dict.booking.couponLabel}
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="booking-coupon"
                      type="text"
                      value={couponInput}
                      onChange={(e) => {
                        setCouponInput(e.target.value);
                        setCoupon(null);
                        setCouponError(null);
                      }}
                      placeholder={dict.booking.couponPlaceholder}
                      className={fieldClass.replace("mt-1.5", "mt-0")}
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      disabled={couponBusy || !couponInput.trim()}
                      className="h-11 shrink-0 rounded-xl border border-border px-4 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                    >
                      {dict.booking.couponApply}
                    </button>
                  </div>
                  {couponError && (
                    <p className="mt-1.5 text-xs font-semibold text-danger">
                      {couponError}
                    </p>
                  )}
                  {coupon && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-success-soft px-3 py-2 text-sm font-bold text-success">
                      <span>
                        {dict.booking.discountLabel}: −{formatUsd(coupon.discount)}
                      </span>
                      <span className="text-foreground">
                        {dict.booking.netLabel}:{" "}
                        <Money value={Math.max(0, selectedPrice - coupon.discount)} />
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`${stepShell("review")} space-y-4`}>
              {/* Phones: the booking restated in full, each line a way back to
                  the step that set it. */}
              <dl className="divide-y divide-border rounded-xl border border-border lg:hidden">
                {reviewRows.map(({ target, label, value }) => (
                  <div
                    key={target}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="truncate text-sm font-bold">{value || "—"}</dd>
                    </div>
                    <button
                      type="button"
                      onClick={() => goTo(target)}
                      className="relative shrink-0 text-xs font-bold text-primary before:absolute before:-inset-1.5 before:content-['']"
                    >
                      {dict.booking.steps.change}
                    </button>
                  </div>
                ))}
                {selectedPrice > 0 && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <dt className="text-xs text-muted-foreground">
                      {dict.booking.steps.price}
                    </dt>
                    <dd className="text-sm font-extrabold tabular-nums">
                      <Money value={netPrice} />
                    </dd>
                  </div>
                )}
              </dl>

              {/* Request-or-confirmation and the cancellation window, stated
                  before the button rather than discovered afterwards. Every
                  booking lands as `pending`, so nothing here promises an
                  instant confirmation — request_based additionally means the
                  time itself is not final. */}
              <div className="rounded-xl border border-info/30 bg-info-soft px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-bold text-info">
                  <Info className="h-4 w-4 shrink-0" />
                  {engineMode === "request_based"
                    ? dict.booking.confirmMode.requestTitle
                    : dict.booking.confirmMode.heldTitle}
                </p>
                <p className="mt-1 text-xs font-medium text-info">
                  {engineMode === "request_based"
                    ? dict.booking.requestNote
                    : dict.booking.confirmMode.heldNote}
                </p>
                <p className="mt-2.5 flex items-start gap-2 border-t border-info/20 pt-2.5 text-xs font-semibold text-info">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  {cancelHours > 0
                    ? dict.booking.cancelPolicy.hours.replace(
                        "{n}",
                        String(cancelHours),
                      )
                    : dict.booking.cancelPolicy.anytime}
                </p>
              </div>

              {/* Shown at every width, because the submit button below is now
                  disabled until the form is complete — and above `lg` that
                  replaces the browser's own "please fill this field" bubble.
                  A greyed-out button with no stated reason is worse than the
                  bubble it replaced, so the reason is always on screen. */}
              {firstIncomplete && (
                <button
                  type="button"
                  onClick={() => goTo(firstIncomplete)}
                  className="flex min-h-11 w-full items-center rounded-xl border border-warning/30 bg-warning-soft px-4 text-start text-sm font-bold text-warning"
                >
                  {dict.booking.steps.incomplete.replace(
                    "{step}",
                    stepLabels[firstIncomplete],
                  )}
                </button>
              )}

              {error && (
                <p className="text-sm font-medium text-danger">{error}</p>
              )}
              <button
                type="submit"
                disabled={
                  loading ||
                  (!!time && slotState(time).blocked) ||
                  (!!hours && !time) ||
                  !!firstIncomplete
                }
                className="h-12 w-full rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60 lg:h-auto lg:w-auto lg:py-3"
              >
                {loading ? dict.booking.submitting : dict.booking.submit}
              </button>
              <p className="text-xs text-muted-foreground">
                {dict.booking.payOnArrival}
              </p>
            </div>

            {/* Step controls. `type="button"` throughout — only the review
                step's submit may post the form. */}
            <div className="flex items-center gap-3 lg:hidden">
              {stepIdx > 0 && (
                <button
                  type="button"
                  onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                  className="h-12 shrink-0 rounded-xl border border-border px-5 text-sm font-bold transition-colors hover:border-primary hover:text-primary"
                >
                  {dict.booking.steps.back}
                </button>
              )}
              {step !== "review" && (
                <button
                  type="button"
                  disabled={!stepReady[step]}
                  onClick={() =>
                    setStepIdx((i) => Math.min(steps.length - 1, i + 1))
                  }
                  className="h-12 flex-1 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
                >
                  {dict.booking.steps.next}
                </button>
              )}
            </div>
          </form>

          {/* Date and time move into sheets on phones: a 3-column grid inside
              a 5-inch panel is a row of 90px targets, and the day list has no
              room at all beside it. The sheet is `lg:hidden` itself, so the
              inline grid above `lg` is untouched.
              Both sheets portal outside the form — nothing in them is a form
              field; they only set the state the form's own inputs render. */}
          <BottomSheet
            open={dateSheet}
            onClose={() => setDateSheet(false)}
            title={dict.booking.steps.chooseDate}
            closeLabel={dict.common.close}
          >
            <div className="space-y-2 pb-2">
              {dayOptions.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  disabled={d.closed}
                  onClick={() => {
                    setDateSheet(false);
                    void onDateChange(d.iso);
                  }}
                  className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 text-start text-sm font-semibold transition-colors ${
                    d.closed
                      ? "cursor-not-allowed border-border bg-surface-muted text-muted-foreground opacity-60"
                      : pickedDate === d.iso
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:border-primary/50"
                  }`}
                >
                  <span className="truncate">{d.label}</span>
                  {d.closed ? (
                    <span className="shrink-0 text-xs font-bold">
                      {dict.booking.steps.closed}
                    </span>
                  ) : (
                    pickedDate === d.iso && (
                      <Check className="h-4 w-4 shrink-0" />
                    )
                  )}
                </button>
              ))}
              {/* Three weeks covers almost every appointment; anything further
                  out falls back to the platform picker. */}
              <label className={`${labelClass} block pt-2`} htmlFor="date_sheet">
                {dict.booking.steps.otherDate}
              </label>
              <input
                id="date_sheet"
                type="date"
                min={todayBeirut}
                value={pickedDate}
                onChange={(e) => {
                  setDateSheet(false);
                  void onDateChange(e.target.value);
                }}
                className={fieldClass}
              />
            </div>
          </BottomSheet>

          <BottomSheet
            open={timeSheet}
            onClose={() => setTimeSheet(false)}
            title={dict.booking.pickSlot}
            closeLabel={dict.common.close}
          >
            {dayClosed ? (
              <p className="rounded-xl bg-surface-muted p-3 text-sm font-semibold text-muted-foreground">
                {dict.booking.noSlots}
              </p>
            ) : (
              <>
                {engineMode && avail && (
                  <p className="flex items-center gap-1.5 pb-3 text-xs font-semibold text-muted-foreground">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    {dict.booking.durationLabel.replace("{n}", String(effDuration))}
                  </p>
                )}
                {slotGrid(true)}
              </>
            )}
          </BottomSheet>
          </>
        ) : (
          <Link
            href={`/${lang}/login`}
            // 42px, same two pixels short as the review sign-in link it is a
            // twin of; taken from the hit box so the pill is unchanged.
            className="relative inline-block rounded-xl border border-border px-5 py-2.5 text-sm font-semibold transition-colors before:absolute before:-inset-y-px before:content-[''] hover:border-primary hover:text-primary"
          >
            {dict.booking.loginToBook}
          </Link>
        )}
      </div>
    </div>
  );
}
