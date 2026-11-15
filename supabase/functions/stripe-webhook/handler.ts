// stripe-webhook — only events with a valid Stripe-Signature (HMAC-SHA256, 5-minute tolerance) are processed.

export type Rec = Record<string, unknown>;
export interface Deps {
  env: (k: string) => string | undefined;
  now(): number;
  applyEvent(txn: string, status: string, amountCents: number | null, currency: string, providerTxnId: string, raw: Rec): Promise<Rec>;
  findTxnByProviderTxn(providerTxnId: string): Promise<string | null>;
  logEvent(row: Rec): Promise<void>;
  notifyPaid(orderId: string): void;
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyStripe(rawBody: string, header: string, secret: string, nowMs: number, toleranceSec = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find((p) => p[0] === "t")?.[1];
  const v1s = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || !v1s.length || Math.abs(nowMs / 1000 - Number(t)) > toleranceSec) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return v1s.some((v) => safeEqual(expected, v));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handle(d: Deps, rawBody: string, sigHeader: string): Promise<{ status: number; body: Rec }> {
  const secret = String(d.env("STRIPE_WEBHOOK_SECRET") ?? "");
  if (!secret) return { status: 503, body: { ok: false, error: "not_configured" } };
  let ev: Rec = {};
  try { ev = JSON.parse(rawBody); } catch { return { status: 400, body: { ok: false, error: "bad_json" } }; }
  const valid = await verifyStripe(rawBody, sigHeader, secret, d.now());
  const type = String(ev.type ?? "");
  if (!valid) {
    await d.logEvent({ provider: "stripe", signature_ok: false, event_type: type, payload: ev });
    return { status: 400, body: { ok: false, error: "bad_signature" } };
  }
  const obj = ((ev.data as Rec)?.object ?? {}) as Rec;
  const meta = (obj.metadata ?? {}) as Rec;
  let txn = String(meta.txn_id ?? obj.client_reference_id ?? "");
  let status: string | null = null, amount: number | null = null, providerTxn = "";

  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    if (obj.payment_status === "paid") status = "paid";
    amount = Number(obj.amount_total); providerTxn = String(obj.payment_intent ?? obj.id ?? "");
  } else if (type === "checkout.session.async_payment_failed") {
    status = "failed"; providerTxn = String(obj.payment_intent ?? "");
  } else if (type === "checkout.session.expired") {
    status = "cancelled";
  } else if (type === "charge.refunded") {
    status = "refunded"; providerTxn = String(obj.payment_intent ?? "");
    if (!UUID.test(txn) && providerTxn) txn = (await d.findTxnByProviderTxn(providerTxn)) ?? "";
  }

  if (!status || !UUID.test(txn)) {
    await d.logEvent({ provider: "stripe", signature_ok: true, event_type: type || "unknown", txn_id: UUID.test(txn) ? txn : null, payload: ev });
    return { status: 200, body: { ok: true, ignored: true } };
  }
  const result = await d.applyEvent(txn, status, amount, String(obj.currency ?? "egp"), providerTxn, obj);
  await d.logEvent({ provider: "stripe", signature_ok: true, event_type: type, txn_id: txn, result, payload: ev });
  if (result.changed === true && status === "paid" && result.order_id) d.notifyPaid(String(result.order_id));
  return { status: 200, body: { ok: true, result } };
}
