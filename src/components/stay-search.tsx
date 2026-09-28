"use client";

import { useState } from "react";
import Image from "next/image";
import { CalendarRange, Users, BedDouble, Search, CheckCircle2 } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/get-dictionary";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/notify";
import { beirutYmd } from "@/lib/quick-panel";

type Unit = {
  unit_id: string;
  name: string;
  name_en: string | null;
  unit_type: string | null;
  max_guests: number;
  bedrooms: number;
  bathrooms: number;
  images: string[];
  nights: number;
  base_total: number;
  cleaning_fee: number;
  deposit: number;
  grand_total: number;
};

function money(n: number) {
  return `$${Number(n).toLocaleString("en-US")}`;
}

// Customer-facing accommodation search + booking (Model D, migration 0191).
// Pick dates + guests → available units with a full price breakdown → request
// to book. Guest-capable; the RPC prices and guards conflicts server-side.
export function StaySearch({
  storeId,
  lang,
  dict,
}: {
  storeId: string;
  lang: Locale;
  dict: Dictionary;
}) {
  const t = dict.stay;
  const today = beirutYmd(new Date());
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(2);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [picked, setPicked] = useState<Unit | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState(false);

  async function search() {
    if (!checkIn || !checkOut || checkOut <= checkIn) return;
    setSearching(true);
    setPicked(null);
    const { data, error } = await createClient().rpc("search_stay", {
      p_store_id: storeId,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_guests: guests,
    });
    setSearching(false);
    setSearched(true);
    if (error) {
      notifyError(dict.common.actionFailed);
      setUnits([]);
      return;
    }
    setUnits((data ?? []) as Unit[]);
  }

  async function book() {
    if (!picked || name.trim().length < 2 || phone.trim().length < 4 || booking)
      return;
    setBooking(true);
    const { error } = await createClient().rpc("place_stay_booking", {
      p_unit_id: picked.unit_id,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_adults: guests,
      p_children: 0,
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
          : m.includes("min_stay")
            ? t.minStay
            : m.includes("over_capacity")
              ? t.overCapacity
              : dict.common.actionFailed,
      );
      return;
    }
    setDone(true);
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
            setUnits([]);
            setSearched(false);
            setNotes("");
          }}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
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
          {t.checkIn}
          <input
            type="date"
            min={today}
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold">
          {t.checkOut}
          <input
            type="date"
            min={checkIn || today}
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="text-sm font-semibold">
          {t.guests}
          <input
            type="number"
            min={1}
            max={50}
            value={guests}
            onChange={(e) => setGuests(Math.max(1, Number(e.target.value)))}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <div className="flex items-end">
          <Button
            onClick={search}
            loading={searching}
            disabled={!checkIn || !checkOut || checkOut <= checkIn}
            leftIcon={<Search className="h-4 w-4" />}
            full
          >
            {t.search}
          </Button>
        </div>
      </div>

      {searched && (
        <div className="mt-5">
          {units.length ? (
            <div className="space-y-3">
              {units.map((u) => {
                const isPicked = picked?.unit_id === u.unit_id;
                const label =
                  lang === "en" && u.name_en?.trim() ? u.name_en : u.name;
                return (
                  <div
                    key={u.unit_id}
                    className={`rounded-2xl border bg-surface p-3 transition-colors ${
                      isPicked ? "border-primary" : "border-border"
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                        {u.images?.[0] ? (
                          <Image
                            src={u.images[0]}
                            alt={label}
                            fill
                            className="object-cover"
                            sizes="96px"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <BedDouble className="h-6 w-6" />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-bold">{label}</span>
                          <span className="shrink-0 font-extrabold text-primary">
                            {money(u.grand_total)}
                          </span>
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {u.max_guests}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <BedDouble className="h-3.5 w-3.5" />
                            {u.bedrooms}
                          </span>
                          <span>
                            {u.nights} {t.nights}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {money(u.base_total)} + {money(u.cleaning_fee)}{" "}
                          {t.cleaning}
                          {u.deposit > 0
                            ? ` · ${t.deposit} ${money(u.deposit)}`
                            : ""}
                        </p>
                        {/* The deposit sat in the same muted line as the base
                            total and the cleaning fee, reading as part of what
                            Matjar is charging. It is not: the guest hands it to
                            the property in cash and the property gives it back.
                            0298 says exactly this for car rentals, and this is
                            the one other place the shape genuinely transfers —
                            better here before a property sets one than after. */}
                        {u.deposit > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t.depositNote}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setPicked(isPicked ? null : u)}
                      className={`mt-3 w-full rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
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
                            className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
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
                            {t.total}: {money(u.grand_total)}
                          </span>
                          <Button
                            onClick={book}
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
              {t.noUnits}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
