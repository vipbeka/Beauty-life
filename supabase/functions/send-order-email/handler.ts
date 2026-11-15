// Pure request logic for send-order-email (no Deno/network imports → unit-testable).
import { adminMail, customerMail, testMail, str, type Mail, type Rec, type Settings } from "./templates.ts";

export interface User { id: string; email?: string; app_metadata?: Record<string, unknown> }

export interface Deps {
  env: (k: string) => string | undefined;
  getSettings(): Promise<Settings>;
  getRecord(table: string, id: string): Promise<Rec | null>;
  getOrderItems(orderId: string): Promise<Rec[]>;
  /** Insert a pending email_log row. Returns false if dedupe_key already exists. Throws if table missing. */
  claim(row: { dedupe_key: string; event: string; record_id: string; role: string; recipient: string; source: string }): Promise<boolean>;
  finish(dedupeKey: string, ok: boolean, info: { message_id?: string; error?: string }): Promise<void>;
  countRecent(filter: { minutes: number; source?: string; recipient?: string }): Promise<number>;
  emailLogReady(): Promise<boolean>;
  getUser(jwt: string): Promise<User | null>;
  isAdminUserId(id: string): Promise<boolean>;
  sendBrevo(apiKey: string, body: Record<string, unknown>): Promise<{ messageId?: string }>;
  now(): number;
}

export interface Result { status: number; body: Record<string, unknown> }

const TABLE: Record<string, string> = {
  order_created: "orders", return_created: "returns", warranty_created: "warranty_claims",
  consultation_created: "consultations", testimonial_created: "testimonials",
};
const ADMIN_TOGGLE: Record<string, string> = {
  order_created: "notifyOnOrder", return_created: "notifyOnReturn", warranty_created: "notifyOnWarranty",
  consultation_created: "notifyOnConsultation", testimonial_created: "notifyOnTestimonial",
};
const CUSTOMER_TOGGLE: Record<string, string> = {
  order_created: "customerNotifyOrder", confirmed: "customerNotifyConfirm", processing: "customerNotifyProcessing",
  shipped: "customerNotifyShipped", delivered: "customerNotifyDelivered", cancelled: "customerNotifyCancelled",
  payment_paid: "customerNotifyPayment", payment_refunded: "customerNotifyRefund",
};
const PUBLIC_EVENTS = new Set(Object.keys(TABLE));
const ADMIN_EVENTS = new Set(["order_status", "payment_paid", "payment_refunded", "test", "health"]);
const ID_RE = /^[A-Za-z0-9_\-.:]{1,128}$/;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

export function emails(v: unknown): string[] {
  return str(v).split(/[;,\n]+/).map((x) => x.trim()).filter((x, i, a) => x && EMAIL_RE.test(x) && a.indexOf(x) === i);
}

function bad(status: number, error: string, extra: Record<string, unknown> = {}): Result {
  return { status, body: { ok: false, error, ...extra } };
}

async function resolveAdmin(d: Deps, jwt: string | null): Promise<User | null> {
  if (!jwt) return null;
  const u = await d.getUser(jwt).catch(() => null);
  if (!u) return null;
  if (u.app_metadata && u.app_metadata.role === "admin") return u;
  if (await d.isAdminUserId(u.id).catch(() => false)) return u;
  const allow = (d.env("ADMIN_EMAILS") ?? "beauty@admin.com,admin@beautylife.com")
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return u.email && allow.includes(u.email.toLowerCase()) ? u : null;
}

function brevoBody(sender: { email: string; name: string }, to: string[], mail: Mail, tags: string[], replyTo?: string) {
  const b: Record<string, unknown> = {
    sender, to: to.map((email) => ({ email })), subject: mail.subject,
    htmlContent: mail.html, textContent: mail.text, tags: ["beautylife", ...tags],
  };
  if (replyTo && EMAIL_RE.test(replyTo)) b.replyTo = { email: replyTo };
  return b;
}

interface Job { role: "admin" | "customer"; key: string; apiKey: string; dedupe: string; to: string[]; body: Record<string, unknown> }

async function runJob(d: Deps, job: Job, recordId: string, event: string, source: string) {
  const claimed = await d.claim({ dedupe_key: job.dedupe, event, record_id: recordId, role: job.role, recipient: job.to.join(","), source });
  if (!claimed) return { role: job.role, status: "duplicate" };
  try {
    const r = await d.sendBrevo(job.apiKey, job.body);
    await d.finish(job.dedupe, true, { message_id: r.messageId });
    return { role: job.role, status: "sent", to: job.to };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await d.finish(job.dedupe, false, { error: msg.slice(0, 500) });
    return { role: job.role, status: "failed", error: msg.slice(0, 200) };
  }
}

export async function handle(d: Deps, body: Rec, jwt: string | null): Promise<Result> {
  const event = str(body.event);
  if (!PUBLIC_EVENTS.has(event) && !ADMIN_EVENTS.has(event)) return bad(400, "unknown_event");

  const adminKey = str(d.env("BREVO_API_KEY"));
  const customerKey = str(d.env("BREVO_CUSTOMER_API_KEY"));
  const admin = ADMIN_EVENTS.has(event) || event === "order_created" ? await resolveAdmin(d, jwt) : null;
  if (ADMIN_EVENTS.has(event) && !admin) return bad(403, "admin_only");

  const s = await d.getSettings();

  if (event === "health") {
    return { status: 200, body: { ok: true, secrets: { BREVO_API_KEY: !!adminKey, BREVO_CUSTOMER_API_KEY: !!customerKey },
      email_log: await d.emailLogReady().catch(() => false),
      settings_legacy_keys_present: { brevoApiKey: !!str(s.brevoApiKey), customerBrevoApiKey: !!str(s.customerBrevoApiKey) } } };
  }

  if (!adminKey) return bad(503, "not_configured");
  if (!(await d.emailLogReady().catch(() => false))) return bad(503, "email_log_missing");

  const adminTo = emails(d.env("NOTIFY_TO_EMAIL") || s.notificationRecipientEmail);
  const adminSender = { email: str(d.env("BREVO_SENDER_EMAIL") || s.notificationSenderEmail || s.email),
    name: str(s.notificationSenderName || s.storeName) || "Beauty Life" };
  const custSender = { email: str(d.env("BREVO_CUSTOMER_SENDER_EMAIL") || s.customerSenderEmail || s.customerNotificationSenderEmail || adminSender.email),
    name: str(s.customerSenderName || s.storeName) || "Beauty Life" };

  if (event === "test") {
    if (!adminTo.length || !EMAIL_RE.test(adminSender.email)) return bad(422, "missing_recipient_or_sender");
    if (await d.countRecent({ minutes: 10, source: "test" }) >= 6) return bad(429, "rate_limited");
    const stamp = String(d.now());
    const jobs: Job[] = [{ role: "admin", key: "admin", apiKey: adminKey, dedupe: `test:admin:${stamp}`, to: adminTo,
      body: brevoBody(adminSender, adminTo, testMail(s, "مفتاح الإدارة BREVO_API_KEY"), ["test"]) }];
    if (customerKey) jobs.push({ role: "customer", key: "customer", apiKey: customerKey, dedupe: `test:customer:${stamp}`, to: adminTo,
      body: brevoBody(EMAIL_RE.test(custSender.email) ? custSender : adminSender, adminTo, testMail(s, "مفتاح العملاء BREVO_CUSTOMER_API_KEY"), ["test"]) });
    const results = [];
    for (const j of jobs) results.push(await runJob(d, j, "test", "test", "test"));
    return { status: results.every((r) => r.status === "sent") ? 200 : 502, body: { ok: results.every((r) => r.status === "sent"), to: adminTo, results } };
  }

  const id = str(body.id);
  if (!ID_RE.test(id)) return bad(400, "bad_id");
  const table = PUBLIC_EVENTS.has(event) ? TABLE[event] : "orders";
  const rec = await d.getRecord(table, id);
  if (!rec) return bad(404, "not_found");

  const source = admin ? "admin" : "anon";
  if (!admin) {
    // Public callers may only trigger mail for records they just created.
    if (event === "order_created" && str(body.order_number) !== str(rec.order_number)) return bad(404, "not_found");
    const created = Date.parse(str(rec.created_at));
    const freshMin = Number(d.env("FRESH_MINUTES") ?? 30);
    if (!Number.isFinite(created) || d.now() - created > freshMin * 60_000) return bad(409, "stale_record");
    if (await d.countRecent({ minutes: 10, source: "anon" }) >= Number(d.env("ANON_LIMIT_10MIN") ?? 60)) return bad(429, "rate_limited");
  }

  const orderRows = table === "orders" && !(Array.isArray(rec.items) && (rec.items as unknown[]).length) ? await d.getOrderItems(id) : [];
  const jobs: Job[] = [];
  const skipped: Record<string, string> = {};

  // Admin notification (creation events only)
  if (PUBLIC_EVENTS.has(event)) {
    if (s.brevoEnabled === false || s[ADMIN_TOGGLE[event]] === false) skipped.admin = "disabled";
    else if (!adminTo.length || !EMAIL_RE.test(adminSender.email)) skipped.admin = "missing_recipient_or_sender";
    else {
      const replyTo = event === "order_created" ? str(rec.customer_email) : event === "consultation_created" ? str(rec.email) : "";
      jobs.push({ role: "admin", key: "admin", apiKey: adminKey, dedupe: `${event}:admin:${id}`, to: adminTo,
        body: brevoBody(adminSender, adminTo, adminMail(event, rec, s, orderRows), [event], replyTo) });
    }
  }

  // Customer notification (orders only)
  const kind = event === "order_created" ? "order_created" : event === "order_status" ? str(rec.status).toLowerCase() : event;
  if (event === "order_created" || event === "order_status" || event === "payment_paid" || event === "payment_refunded") {
    const to = str(rec.customer_email);
    const toggle = CUSTOMER_TOGGLE[kind === "canceled" ? "cancelled" : kind];
    if (event === "payment_paid" && str(rec.payment_status).toLowerCase() !== "paid") skipped.customer = "status_mismatch";
    else if (event === "payment_refunded" && !/^refund/.test(str(rec.payment_status).toLowerCase())) skipped.customer = "status_mismatch";
    else if (!toggle) skipped.customer = "no_template_for_status";
    else if (!customerKey) skipped.customer = "customer_key_not_configured";
    else if (s.customerBrevoEnabled === false || s[toggle] === false) skipped.customer = "disabled";
    else if (!EMAIL_RE.test(to)) skipped.customer = "no_customer_email";
    else if (!EMAIL_RE.test(custSender.email)) skipped.customer = "missing_sender";
    else if (source === "anon" && await d.countRecent({ minutes: 60, recipient: to }) >= 5) skipped.customer = "recipient_rate_limited";
    else {
      const mail = customerMail(kind, rec, s, orderRows);
      if (!mail) skipped.customer = "no_template_for_status";
      else jobs.push({ role: "customer", key: "customer", apiKey: customerKey, dedupe: `${event}:customer:${id}${event === "order_status" ? ":" + kind : ""}`,
        to: [to], body: brevoBody(custSender, [to], mail, ["customer", event]) });
    }
  }

  const results = [];
  for (const j of jobs) results.push(await runJob(d, j, id, event, source));
  const failed = results.some((r) => r.status === "failed");
  return { status: failed ? 502 : 200, body: { ok: !failed, results, skipped } };
}
