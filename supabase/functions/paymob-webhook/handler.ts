// paymob-webhook — Paymob "transaction processed" callback. Only HMAC-SHA512-verified calls can change
// a payment; amount + currency must equal the stored transaction (checked again inside the DB function).

export type Rec = Record<string, unknown>;
export interface Deps {
  env: (k: string) => string | undefined;
  applyEvent(txn: string, status: string, amountCents: number, currency: string, providerTxnId: string, raw: Rec): Promise<Rec>;
  logEvent(row: Rec): Promise<void>;
  notifyPaid(orderId: string): void;
}

// Field order defined by Paymob for the transaction callback HMAC.
export const PAYMOB_HMAC_FIELDS = [
  "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id",
  "is_3d_secure", "is_auth", "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner",
  "pending", "source_data.pan", "source_data.sub_type", "source_data.type", "success",
];

function pick(obj: Rec, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Rec)[k] : undefined), obj);
}
export function paymobConcat(obj: Rec): string {
  return PAYMOB_HMAC_FIELDS.map((f) => { const v = pick(obj, f); return v == null ? "" : String(v); }).join("");
}

export async function hmacHex(alg: "SHA-512" | "SHA-256", secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: alg }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function paymobStatus(obj: Rec): "paid" | "failed" | "refunded" | null {
  if (obj.is_refunded === true || obj.is_voided === true) return "refunded";
  if (obj.pending === true) return null;
  if (obj.success === true) return "paid";
  if (obj.success === false) return "failed";
  return null;
}

export async function handle(d: Deps, body: Rec, hmacParam: string): Promise<{ status: number; body: Rec }> {
  const secret = String(d.env("PAYMOB_HMAC_SECRET") ?? "");
  const obj = (body.obj && typeof body.obj === "object" ? body.obj : {}) as Rec;
  if (!secret) return { status: 503, body: { ok: false, error: "not_configured" } };

  const expected = await hmacHex("SHA-512", secret, paymobConcat(obj));
  const valid = !!hmacParam && safeEqual(expected, hmacParam.toLowerCase());
  const order = (obj.order && typeof obj.order === "object" ? obj.order : {}) as Rec;
  const ref = String(order.merchant_order_id ?? obj.special_reference ?? "");
  const txn = UUID.test(ref) ? ref : "";

  if (!valid) {
    await d.logEvent({ provider: "paymob", signature_ok: false, event_type: String(body.type ?? ""), txn_id: txn || null, payload: body });
    return { status: 401, body: { ok: false, error: "bad_signature" } };
  }
  const status = paymobStatus(obj);
  if (!txn || !status) {
    await d.logEvent({ provider: "paymob", signature_ok: true, event_type: status ? "unmatched" : "pending_or_unknown", txn_id: txn || null, payload: body });
    return { status: 200, body: { ok: true, ignored: true } };
  }
  const result = await d.applyEvent(txn, status, Number(obj.amount_cents), String(obj.currency ?? ""), String(obj.id ?? ""), obj);
  await d.logEvent({ provider: "paymob", signature_ok: true, event_type: status, txn_id: txn, result, payload: body });
  if (result.changed === true && status === "paid" && result.order_id) d.notifyPaid(String(result.order_id));
  return { status: 200, body: { ok: true, result } };
}
