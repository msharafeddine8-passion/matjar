import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import { SITE_URL } from "@/lib/site";

// Outgoing e-mail. Two providers, whichever is configured:
//   • RESEND_API_KEY (+ EMAIL_FROM)                 — resend.com HTTP API
//   • SMTP_HOST, SMTP_USER, SMTP_PASS (+ SMTP_PORT) — any mailbox, e.g. Hostinger
//     (smtp.hostinger.com, port 465) with a noreply@matjarlb.com mailbox.
// With neither, sendEmail() returns "not_configured" and nothing is sent.

export type SendResult = "sent" | "not_configured" | "failed";

function fromAddress(): string {
  return process.env.EMAIL_FROM || process.env.SMTP_USER || "noreply@matjarlb.com";
}

export function emailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY ||
      (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  );
}

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  const from = `متجر Matjar <${fromAddress()}>`;
  try {
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, html, text }),
      });
      return res.ok ? "sent" : "failed";
    }
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const port = Number(process.env.SMTP_PORT || 465);
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transport.sendMail({ from, to, subject, html, text });
      return "sent";
    }
    return "not_configured";
  } catch {
    return "failed";
  }
}

// ----------------------------------------------------------- unsubscribe links
// Signed with PUSH_HOOK_SECRET so a link cannot be forged for another account.
export function optoutToken(uid: string): string {
  const secret = process.env.PUSH_HOOK_SECRET ?? "";
  return createHmac("sha256", secret).update(`optout:${uid}`).digest("hex").slice(0, 32);
}

export function optoutTokenValid(uid: string, token: string): boolean {
  if (!process.env.PUSH_HOOK_SECRET) return false;
  const a = Buffer.from(optoutToken(uid));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ----------------------------------------------------------- content
type Data = Record<string, unknown>;

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function money(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return "$" + n.toFixed(2).replace(/\.00$/, "");
}

export type EmailContent = { subject: string; heading: string; lines: string[]; cta: string; url: string; nudge: boolean };

// Wording mirrors push_on_notification (0327) so the bell, the push and the
// e-mail say the same thing. Returns null for types that are not e-mailed.
export function emailContentFor(type: string, data: Data): EmailContent | null {
  const store = s(data.store_name) ?? "متجرك";
  const who = s(data.customer_name) ?? "زبون";
  const m = s(data.store_id) ? `/ar/merchant/${data.store_id}` : "/ar/merchant";
  const base = (subject: string, heading: string, lines: string[], url: string, cta = "افتح لوحة التحكم"): EmailContent => ({
    subject, heading, lines, cta, url, nudge: false,
  });

  switch (type) {
    case "order_new": {
      const total = money(data.total);
      return base(
        `طلب جديد على ${store}${total ? ` · ${total}` : ""}`,
        "وصلك طلب جديد 🛒",
        [`${who} طلب من ${store}.`, ...(s(data.ref) ? [`رقم الطلب: #${data.ref}`] : []), ...(total ? [`المجموع: ${total}`] : [])],
        `${m}/orders`, "شوف الطلب",
      );
    }
    case "booking_new": {
      const when = [s(data.requested_date), s(data.requested_time)?.slice(0, 5)].filter(Boolean).join(" ");
      return base(
        `حجز جديد على ${store}`,
        "وصلك حجز جديد 📅",
        [`${who} حجز ${s(data.service_name) ?? "موعد"}.`, ...(when ? [`الموعد: ${when}`] : [])],
        `${m}/bookings`, "شوف الحجز",
      );
    }
    case "service_request_new":
      return base(`طلب خدمة جديد على ${store}`, "وصلك طلب خدمة 🧰", [`${who} طالب خدمة — ابعتلو عرض سعر.`], `${m}/requests`, "شوف الطلب");
    case "lead_new":
      return base(`استفسار جديد على ${store}`, "حدا عم يستفسر 💬", ["في زبون مهتم وعم يستفسر — ردّ عليه بسرعة."], `${m}/leads`);
    case "stay_new":
      return base(`حجز إقامة جديد على ${store}`, "حجز إقامة جديد 🏨", ["وصلك طلب حجز إقامة."], `${m}/stays`);
    case "rental_new":
      return base(`حجز سيارة جديد على ${store}`, "حجز سيارة جديد 🚗", ["وصلك طلب استئجار."], `${m}/rentals`);
    case "ticket_new":
      return base(`تذاكر مبيعة على ${store}`, "تذاكر مبيعة 🎟️", ["حدا اشترى تذاكر لفعاليّتك."], `${m}/tickets`);
    case "membership_new":
      return base(`اشتراك جديد على ${store}`, "اشتراك جديد 💪", ["حدا اشترك بخطّة عندك."], `${m}/members`);
    case "enroll_new":
      return base(`تسجيل جديد على ${store}`, "تسجيل جديد 🎓", ["حدا سجّل بدورة عندك."], `${m}/courses`);
    case "automation":
      if (data.kind !== "merchant_nudge") return null;
      return {
        subject: s(data.title) ?? "تذكير من متجر",
        heading: s(data.title) ?? "تذكير من متجر",
        lines: [s(data.body) ?? ""],
        cta: data.nudge === "empty" ? "ضيف منتج هلّق" : "افتح متجرك",
        url: s(data.url) ?? m,
        nudge: true,
      };
    default:
      return null;
  }
}

export function renderEmail(c: EmailContent, uid: string): { html: string; text: string } {
  const link = SITE_URL + c.url;
  const optout = `${SITE_URL}/api/email/optout?u=${uid}&t=${optoutToken(uid)}`;
  const footer = c.nudge
    ? `<p style="margin:24px 0 0;font-size:12px;color:#888">ما بدك تذكيرات؟ <a href="${optout}" style="color:#888">وقّف التذكيرات</a> (بتضلّ توصلك إيميلات الطلبات).</p>`
    : `<p style="margin:24px 0 0;font-size:12px;color:#888">وصلك هالإيميل لأنك صاحب متجر أو موظّف عليه بمتجر.</p>`;
  const html = `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#f5f5f4;font-family:Tahoma,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:16px;padding:28px 24px;text-align:right;color:#1c1917">
<p style="margin:0 0 4px;font-size:13px;color:#a8a29e">متجر · matjarlb.com</p>
<h1 style="margin:0 0 16px;font-size:22px">${esc(c.heading)}</h1>
${c.lines.map((l) => `<p style="margin:0 0 8px;font-size:16px;line-height:1.7">${esc(l)}</p>`).join("")}
<a href="${link}" style="display:inline-block;margin-top:16px;background:#1c1917;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px">${esc(c.cta)}</a>
${footer}
</div></div></body></html>`;
  const text = [c.heading, ...c.lines, "", `${c.cta}: ${link}`, ...(c.nudge ? ["", `وقّف التذكيرات: ${optout}`] : [])].join("\n");
  return { html, text };
}
