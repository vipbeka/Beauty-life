// Supabase Edge Function: paymob-webhook  (deploy with verify_jwt = false — Paymob calls it directly;
// authenticity is proven by the HMAC). Secret: PAYMOB_HMAC_SECRET.
// Paymob dashboard → Developers → Payment Integrations → "Transaction processed callback":
//   https://gyeqbsoqmghxxnnfjizd.supabase.co/functions/v1/paymob-webhook
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle, type Deps } from "./handler.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const deps: Deps = {
  env: (k) => Deno.env.get(k),
  async applyEvent(txn, status, amountCents, currency, providerTxnId, raw) {
    const { data, error } = await db.rpc("apply_payment_event", {
      p_txn: txn, p_status: status, p_amount_cents: Number.isFinite(amountCents) ? Math.round(amountCents) : null,
      p_currency: currency, p_provider_txn_id: providerTxnId, p_raw: raw,
    });
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  },
  async logEvent(row) { await db.from("payment_events").insert(row); },
  notifyPaid(orderId) {
    const p = fetch(`${SB_URL}/functions/v1/send-order-email`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ event: "payment_paid", id: orderId }),
    }).catch((e) => console.error("notify paid failed", e));
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(p); } catch { /* ignore */ }
  },
};

Deno.serve(async (req) => {
  if (req.method === "GET") return new Response("ok", { status: 200 }); // browser redirect callbacks are not trusted
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, error: "bad_json" }), { status: 400 }); }
  const hmac = new URL(req.url).searchParams.get("hmac") ?? "";
  try {
    const r = await handle(deps, body, hmac);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("paymob-webhook error", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), { status: 500 }); // Paymob retries
  }
});
