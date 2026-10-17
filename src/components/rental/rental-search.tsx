"use client";

import { useState } from "react";
import Image from "next/image";
import {
  CalendarRange,
  Car,
  CheckCircle2,
  Gauge,
  MapPin,
  Search,
  ShieldCheck,
  ShieldOff,
  Users,
} from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/notify";
import { formatUsd } from "@/lib/currency";
import { rentalRefusal, todayIso, type RentalRefusal } from "@/lib/rental";

// Customer-facing car rental search + booking (MJ-003, migration 0298).
//
// Deliberately the same shape as StaySearch: pick a date range, see what is
// free, book it. The engine underneath is the same engine — a unit, a
// [from, to) range, per-period pricing and a btree_gist exclusion constraint —
// and reusing the shape means a customer who has booked a chalet on Matjar
// already knows how to rent a car on it.
//
// Two things this screen must say out loud that the stay screen does not:
//
//   THE DEPOSIT IS NOT OURS. Matjar processes no cards and holds no funds. The
//   merchant states a deposit, collects it in cash at pickup and returns it
//   when the car comes back. It is therefore rendered OUTSIDE the total, with a
//   sentence saying who takes it and who does not, rather than as a line item
//   that would read like a charge.
//
//   THE INSURANCE IS NOT OURS EITHER. `insurance_included` and its note are
//   what the merchant typed. Matjar does not verify cover and is not an
//   insurer, so the block says whose statement it is.
//
// Availability is never decided here. `search_rentals` answers it and the
// exclusion constraint enforces it; `dates_taken` coming back from the RPC is
// the constraint speaking, not a race this component lost.

type Vehicle = {
  vehicle_id: string;
  name: string;
  name_en: string | null;
  vehicle_type: string | null;
  transmission: string | null;
  fuel: string | null;
  seats: number;
  model_year: number | null;
  images: string[];
  features: string[];
  days: number;
  base_total: number;
  delivery_fee: number;
  deposit: number;
  grand_total: number;
  min_days: number;
  min_driver_age: number;
  daily_km_limit: number | null;
  extra_km_price: number;
  insurance_included: boolean;
  insurance_note: string | null;
  pickup_location: string | null;
  pickup_time: string | null;
  return_time: string | null;
};

export function RentalSearch({
  storeId,
  lang,
  dict,
}: {
  storeId: string;
  lang: Locale;
  dict: Pick<Dictionary, "common" | "rental">;
}) {
  const t = dict.rental;
  const today = todayIso();
  const [pickup, setPickup] = useState("");
  const [ret, setRet] = useState("");
  const [driverAge, setDriverAge] = useState(30);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [picked, setPicked] = useState<Vehicle | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState(false);

  const rangeReady = !!pickup && !!ret && ret > pickup;

  async function search() {
    if (!rangeReady) return;
    setSearching(true);
    setPicked(null);
    const { data, error } = await createClient().rpc("search_rentals", {
      p_store_id: storeId,
      p_pickup: pickup,
      p_return: ret,
      p_driver_age: driverAge,
    });
    setSearching(false);
    setSearched(true);
    if (error) {
      notifyError(dict.common.actionFailed);
      setVehicles([]);
      return;
    }
    setVehicles((data ?? []) as Vehicle[]);
  }

  async function book(v: Vehicle) {
    if (name.trim().length < 2 || phone.trim().length < 4 || booking) return;
    // The same four refusals the RPC raises, checked before the round trip so
    // the customer is told in their own words rather than by a failed request.
    const refusal = rentalRefusal({
      pricing: { baseDailyPrice: 0, minDays: v.min_days, minDriverAge: v.min_driver_age },
      pickup,
      ret,
      driverAge,
      today,
    });
    if (refusal) {
      notifyError(refusalLabel(refusal));
      return;
    }
    setBooking(true);
    const { error } = await createClient().rpc("place_rental_booking", {
      p_vehicle_id: v.vehicle_id,
      p_pickup: pickup,
      p_return: ret,
      p_driver_age: driverAge,
      p_name: name.trim(),
      p_phone: phone.trim(),
      p_notes: notes.trim() || null,
    });
    setBooking(false);
    if (error) {
      const m = error.message || "";
      notifyError(
        m.includes("dates_taken")
          ? t.datesTaken
          : m.includes("min_days")
            ? t.minDays
            : m.includes("driver_too_young")
              ? t.driverTooYoung
              : m.includes("rate_limited")
                ? t.rateLimited
                : m.includes("invalid_range")
                  ? t.invalidRange
                  : dict.common.actionFailed,
      );
      return;
    }
    setDone(true);
  }

  function refusalLabel(r: RentalRefusal): string {
    if (r === "min_days") return t.minDays;
    if (r === "driver_too_young") return t.driverTooYoung;
    if (r === "past_date") return t.pastDate;
    return t.invalidRange;
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
        <h3 className="mt-2 text-lg font-extrabold">{t.sentTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t.sentNote}</p>
        <button
          onClick={() => {
            setDone(false);
            setPicked(null);
            setVehicles([]);
            setSearched(false);
            setNotes("");
          }}
          className="relative mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors before:absolute before:-inset-x-2 before:-inset-y-2.5 before:content-[''] hover:bg-surface-muted"
        >
          {t.another}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-5">
      <h3 className="flex items-center gap-2 text-lg font-extrabold">
        <CalendarRange className="h-5 w-5 text-primary" />
        {t.title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <label className="text-sm font-semibold">
          {t.pickup}
          <input
            type="date"
            min={today}
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
            dir="ltr"
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold">
          {t.returnDate}
          <input
            type="date"
            min={pickup || today}
            value={ret}
            onChange={(e) => setRet(e.target.value)}
            dir="ltr"
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold">
          {t.driverAge}
          <input
            type="number"
            min={16}
            max={99}
            value={driverAge}
            onChange={(e) => setDriverAge(Math.max(16, Number(e.target.value)))}
            dir="ltr"
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-primary"
          />
        </label>
        <div className="flex items-end">
          <Button
            onClick={search}
            loading={searching}
            disabled={!rangeReady}
            leftIcon={<Search className="h-4 w-4" />}
            full
          >
            {t.search}
          </Button>
        </div>
      </div>

      {searched && (
        <div className="mt-5">
          {vehicles.length ? (
            <div className="space-y-3">
              {vehicles.map((v) => {
                const isPicked = picked?.vehicle_id === v.vehicle_id;
                const label =
                  lang === "en" && v.name_en?.trim() ? v.name_en : v.name;
                return (
                  <div
                    key={v.vehicle_id}
                    className={`rounded-2xl border bg-surface p-3 transition-colors ${
                      isPicked ? "border-primary" : "border-border"
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                        {v.images?.[0] ? (
                          <Image
                            src={v.images[0]}
                            alt={label}
                            fill
                            className="object-cover"
                            sizes="96px"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <Car className="h-6 w-6" />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-bold">{label}</span>
                          <span
                            dir="ltr"
                            className="shrink-0 font-extrabold tabular-nums text-primary"
                          >
                            {formatUsd(v.grand_total, { cents: true })}
                          </span>
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            <span dir="ltr" className="tabular-nums">
                              {v.seats}
                            </span>
                            &nbsp;{t.seats}
                          </span>
                          <span dir="ltr" className="tabular-nums">
                            {v.days}
                          </span>
                          <span>{t.days}</span>
                          {v.transmission && <span>{v.transmission}</span>}
                          {v.model_year && (
                            <span dir="ltr" className="tabular-nums">
                              {v.model_year}
                            </span>
                          )}
                        </p>

                        {/* Mileage: the merchant's policy, stated plainly. */}
                        <p className="mt-1 inline-flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <Gauge className="h-3.5 w-3.5 shrink-0" />
                          {v.daily_km_limit == null ? (
                            <span>{t.unlimitedKm}</span>
                          ) : (
                            <>
                              <span dir="ltr" className="tabular-nums">
                                {v.daily_km_limit}
                              </span>
                              <span>{t.kmPerDay}</span>
                              {v.extra_km_price > 0 && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span dir="ltr" className="tabular-nums">
                                    {formatUsd(v.extra_km_price, { cents: true })}
                                  </span>
                                  <span>{t.extraKm}</span>
                                </>
                              )}
                            </>
                          )}
                        </p>

                        {/* Insurance: whose statement it is, said out loud. */}
                        <p className="mt-1 inline-flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          {v.insurance_included ? (
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" />
                          ) : (
                            <ShieldOff className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>
                            {v.insurance_included
                              ? t.insuranceIncluded
                              : t.insuranceExcluded}
                          </span>
                          {v.insurance_note && <span>· {v.insurance_note}</span>}
                        </p>

                        {v.pickup_location && (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span>{v.pickup_location}</span>
                            {v.pickup_time && (
                              <span dir="ltr" className="tabular-nums">
                                {v.pickup_time}
                              </span>
                            )}
                          </p>
                        )}

                        <p className="mt-1 text-xs text-muted-foreground">
                          <span dir="ltr" className="tabular-nums">
                            {formatUsd(v.base_total, { cents: true })}
                          </span>
                          {v.delivery_fee > 0 && (
                            <>
                              {" + "}
                              <span dir="ltr" className="tabular-nums">
                                {formatUsd(v.delivery_fee, { cents: true })}
                              </span>{" "}
                              {t.delivery}
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* The deposit sits OUTSIDE the price block on purpose: it
                        is not money Matjar takes, and it is not part of the
                        total. */}
                    {v.deposit > 0 && (
                      <p className="mt-2 rounded-xl bg-surface-muted p-2.5 text-xs text-muted-foreground">
                        <span className="font-bold text-foreground">
                          {t.deposit}:{" "}
                          <span dir="ltr" className="tabular-nums">
                            {formatUsd(v.deposit, { cents: true })}
                          </span>
                        </span>{" "}
                        {t.depositNote}
                      </p>
                    )}

                    <button
                      onClick={() => setPicked(isPicked ? null : v)}
                      className={`relative mt-3 w-full rounded-lg px-4 py-2.5 text-sm font-bold transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] ${
                        isPicked
                          ? "border border-primary text-primary"
                          : "bg-primary text-primary-foreground hover:bg-primary-hover"
                      }`}
                    >
                      {isPicked ? t.cancel : t.book}
                    </button>

                    {isPicked && (
                      <div className="mt-3 grid gap-2 border-t border-border pt-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t.name}
                            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                          <input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder={t.phone}
                            inputMode="tel"
                            dir="ltr"
                            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-primary"
                          />
                        </div>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder={t.notesHint}
                          rows={2}
                          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold">
                            {t.total}:{" "}
                            <span dir="ltr" className="tabular-nums">
                              {formatUsd(v.grand_total, { cents: true })}
                            </span>
                          </span>
                          <Button
                            onClick={() => book(v)}
                            loading={booking}
                            disabled={
                              name.trim().length < 2 || phone.trim().length < 4
                            }
                          >
                            {t.confirm}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              {t.noVehicles}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
