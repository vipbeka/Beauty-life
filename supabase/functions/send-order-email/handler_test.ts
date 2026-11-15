// deno test supabase/functions/send-order-email/handler_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handle, type Deps } from "./handler.ts";

const NOW = Date.parse("2026-11-15T10:00:00Z");
const fresh = new Date(NOW - 60_000).toISOString();

function mk(opts: { env?: Record<string, string>; settings?: Record<string, unknown>; records?: Record<string, Record<string, unknown>>; users?: Record<string, { id: string; email?: string; app_metadata?: Record<string, unknown> }>; logReady?: boolean; brevoFail?: boolean; recent?: number } = {}) {
  const env: Record<string, string> = { BREVO_API_KEY: "adm-key", BREVO_CUSTOMER_API_KEY: "cus-key", ...(opts.env ?? {}) };
  const log = new Map<string, Record<string, unknown>>();
  const sent: { key: string; body: Record<string, unknown> }[] = [];
  const records = opts.records ?? {};
  const d: Deps = {
    env: (k) => env[k],
    now: () => NOW,
    getSettings: () => Promise.resolve({ storeName: "Beauty Life", notificationRecipientEmail: "owner@example.com, ops@example.com", notificationSenderEmail: "noreply@beautylife-eg.com", customerSenderEmail: "hello@beautylife-eg.com", ...(opts.settings ?? {}) }),
    getRecord: (t, id) => Promise.resolve(records[`${t}:${id}`] ?? null),
    getOrderItems: () => Promise.resolve([]),
    claim: (row) => { if (opts.logReady === false) throw new Error("relation does not exist"); if (log.has(row.dedupe_key)) return Promise.resolve(false); log.set(row.dedupe_key, { ...row, status: "pending" }); return Promise.resolve(true); },
    finish: (key, ok, info) => { const r = log.get(key)!; if (ok) { r.status = "sent"; } else { log.delete(key); log.set(`${key}:failed`, { ...r, status: "failed", error: info.error }); } return Promise.resolve(); },
    countRecent: () => Promise.resolve(opts.recent ?? 0),
    emailLogReady: () => Promise.resolve(opts.logReady !== false),
    getUser: (jwt) => Promise.resolve(opts.users?.[jwt] ?? null),
    isAdminUserId: () => Promise.resolve(false),
    sendBrevo: (key, body) => { if (opts.brevoFail) return Promise.reject(new Error("Key not found")); sent.push({ key, body }); return Promise.resolve({ messageId: "m" + sent.length }); },
  };
  return { d, log, sent };
}

const order = (extra: Record<string, unknown> = {}) => ({
  "orders:o1": { id: "o1", order_number: "BL-123456-ABC", created_at: fresh, customer_name: '<img src=x onerror=alert(1)>', customer_phone: "01012345678",
    customer_email: "buyer@example.com", payment_method: "cod", status: "pending", payment_status: "unpaid", subtotal: 100, shipping_fee: 0, total: 100,
    items: [{ name: "<b>Laser</b>", qty: "<svg onload=1>", price: 100 }], ...extra },
});
const ADMIN = { tok: { id: "u1", email: "beauty@admin.com", app_metadata: { role: "admin" } } };

Deno.test("rejects unknown event and bad id", async () => {
  const { d } = mk();
  assertEquals((await handle(d, { event: "x" }, null)).status, 400);
  assertEquals((await handle(d, { event: "order_created", id: "o1');drop" }, null)).status, 400);
});

Deno.test("admin-only events reject anon, non-admin users, and email-only 'admins'", async () => {
  const { d } = mk({ users: { u: { id: "u2", email: "admin@beautylife.com" } } });
  for (const ev of ["health", "test", "order_status", "payment_paid", "payment_refunded"]) {
    assertEquals((await handle(d, { event: ev, id: "o1" }, null)).status, 403, ev);
    assertEquals((await handle(d, { event: ev, id: "o1" }, "u")).status, 403, ev);
  }
});

Deno.test("503 when key secret missing or email_log missing (client falls back)", async () => {
  assertEquals((await handle(mk({ env: { BREVO_API_KEY: "" }, records: order() }).d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null)).status, 503);
  assertEquals((await handle(mk({ logReady: false, records: order() }).d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null)).status, 503);
});

Deno.test("anon order_created sends admin+customer, escaped, with the right keys; second call deduped", async () => {
  const { d, sent } = mk({ records: order() });
  const r = await handle(d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null);
  assertEquals(r.status, 200);
  assertEquals(sent.length, 2);
  const adm = sent.find((s) => s.key === "adm-key")!, cus = sent.find((s) => s.key === "cus-key")!;
  assertEquals((adm.body.to as { email: string }[]).map((x) => x.email), ["owner@example.com", "ops@example.com"]);
  assertEquals((adm.body.replyTo as { email: string }).email, "buyer@example.com");
  assertEquals((cus.body.to as { email: string }[])[0].email, "buyer@example.com");
  for (const s of sent) {
    const html = String(s.body.htmlContent);
    assert(!html.includes("<img src=x"), "name must be escaped");
    assert(!html.includes("<svg"), "qty must not be injected");
    assert(!html.includes("<b>Laser</b>"), "item name must be escaped");
  }
  const again = await handle(d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null);
  assertEquals(again.status, 200);
  assertEquals(sent.length, 2, "no duplicate emails");
  assertEquals((again.body.results as { status: string }[]).map((x) => x.status), ["duplicate", "duplicate"]);
});

Deno.test("anon cannot mail arbitrary/old records", async () => {
  const { d, sent } = mk({ records: order() });
  assertEquals((await handle(d, { event: "order_created", id: "o1", order_number: "BL-WRONG" }, null)).status, 404);
  assertEquals((await handle(d, { event: "order_created", id: "nope", order_number: "x" }, null)).status, 404);
  const old = mk({ records: order({ created_at: new Date(NOW - 2 * 3600_000).toISOString() }) });
  assertEquals((await handle(old.d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null)).status, 409);
  assertEquals(sent.length + old.sent.length, 0);
});

Deno.test("anon global rate limit", async () => {
  const { d } = mk({ records: order(), recent: 999 });
  assertEquals((await handle(d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null)).status, 429);
});

Deno.test("admin order_status sends one customer email per status", async () => {
  const { d, sent } = mk({ records: order({ status: "shipped", created_at: "2020-01-01T00:00:00Z" }), users: ADMIN });
  const r = await handle(d, { event: "order_status", id: "o1" }, "tok");
  assertEquals(r.status, 200);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].key, "cus-key");
  assert(String(sent[0].body.subject).startsWith("تم شحن طلبك"));
  await handle(d, { event: "order_status", id: "o1" }, "tok");
  assertEquals(sent.length, 1, "same status not re-sent");
});

Deno.test("payment_paid requires paid status; disabled toggles respected; missing customer key skips only customer", async () => {
  const a = mk({ records: order(), users: ADMIN });
  const r = await handle(a.d, { event: "payment_paid", id: "o1" }, "tok");
  assertEquals((r.body.skipped as Record<string, string>).customer, "status_mismatch");
  const b = mk({ records: order(), settings: { notifyOnOrder: false, customerNotifyOrder: false } });
  const rb = await handle(b.d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null);
  assertEquals(b.sent.length, 0); assertEquals(rb.body.ok, true);
  const c = mk({ records: order(), env: { BREVO_CUSTOMER_API_KEY: "" } });
  const rc = await handle(c.d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null);
  assertEquals(c.sent.length, 1); assertEquals((rc.body.skipped as Record<string, string>).customer, "customer_key_not_configured");
});

Deno.test("Brevo failure → 502, dedupe key freed so a retry can send", async () => {
  const f = mk({ records: order(), brevoFail: true });
  const r = await handle(f.d, { event: "order_created", id: "o1", order_number: "BL-123456-ABC" }, null);
  assertEquals(r.status, 502);
  assertEquals(f.log.has("order_created:admin:o1"), false);
});

Deno.test("test + health for admins (health never returns key values)", async () => {
  const { d, sent } = mk({ users: { tok: { id: "u9", email: "x@y.com", app_metadata: { role: "admin" } } }, settings: { brevoApiKey: "xkeysib-LEGACY" } });
  const h = await handle(d, { event: "health" }, "tok");
  assertEquals(h.status, 200);
  assert(!JSON.stringify(h.body).includes("xkeysib"));
  assert(!JSON.stringify(h.body).includes("adm-key"));
  assertEquals((h.body.settings_legacy_keys_present as Record<string, boolean>).brevoApiKey, true);
  const t = await handle(d, { event: "test" }, "tok");
  assertEquals(t.status, 200);
  assertEquals(sent.map((s) => s.key), ["adm-key", "cus-key"]);
});

Deno.test("other creation events: admin only, replyTo for consultation", async () => {
  const { d, sent } = mk({ records: { "consultations:c1": { id: "c1", created_at: fresh, name: "Dr <x>", phone: "010", email: "doc@example.com", message: "hi" } } });
  const r = await handle(d, { event: "consultation_created", id: "c1" }, null);
  assertEquals(r.status, 200); assertEquals(sent.length, 1);
  assertEquals((sent[0].body.replyTo as { email: string }).email, "doc@example.com");
  assert(!String(sent[0].body.htmlContent).includes("Dr <x>"));
});
