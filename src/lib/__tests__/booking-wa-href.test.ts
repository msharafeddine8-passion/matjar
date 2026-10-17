import { describe, expect, it } from "vitest";
import { bookingWaHref, isWaStoredKey, WA_TEMPLATE_KEYS } from "@/lib/wa-templates";

const b = {
  phone: "03 123 456",
  customerName: "Rami",
  storeName: "Salon Nour",
  service: "Haircut",
  date: "2026-10-20",
  time: "15:30:00",
};

function text(href: string | null): string {
  expect(href).toBeTruthy();
  return decodeURIComponent(new URL(href!).searchParams.get("text") ?? "");
}

describe("bookingWaHref", () => {
  it("builds a declined message to a Lebanese number", () => {
    const href = bookingWaHref("booking_declined", b, "en");
    expect(href!.startsWith("https://wa.me/961")).toBe(true);
    const t = text(href);
    expect(t).toContain("Rami");
    expect(t).toContain("Haircut");
    expect(t).toContain("15:30");
    expect(t).not.toMatch(/\{[a-z_]+\}/);
  });

  it("drops the link line for the rescheduled message (guests have no page)", () => {
    const t = text(bookingWaHref("booking_rescheduled", b, "ar"));
    expect(t).toContain("15:30");
    expect(t).not.toContain("{link}");
    expect(t).not.toMatch(/تفاصيل الموعد/);
  });

  it("is null without a dialable phone", () => {
    expect(bookingWaHref("booking_confirmation", { ...b, phone: null }, "ar")).toBeNull();
    expect(bookingWaHref("booking_confirmation", { ...b, phone: "12" }, "ar")).toBeNull();
  });
});

describe("stored vs default-only template keys", () => {
  it("the booking follow-up keys are stored since 0336 widened the CHECKs", () => {
    expect(isWaStoredKey("booking_declined")).toBe(true);
    expect(isWaStoredKey("booking_rescheduled")).toBe(true);
    expect(isWaStoredKey("booking_reminder")).toBe(true);
    expect(WA_TEMPLATE_KEYS).toContain("booking_declined");
  });
});
