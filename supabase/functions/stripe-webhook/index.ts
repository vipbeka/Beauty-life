// Supabase Edge Function: stripe-webhook  (deploy with verify_jwt = false — Stripe calls it directly;
// authenticity is proven by Stripe-Signature). Secret: STRIPE_WEBHOOK_SECRET.
// Stripe dashboard → Developers → Webhooks → endpoint:
//   https://gyeqbsoqmghxxnnfjizd.supabase.co/functions/v1/stripe-webhook
// Events: checkout.session.completed, checkout.session.async_payment_succeeded,
//         checkout.session.async_payment_failed, checkout.session.expired, charge.refunded
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle, type Deps } from "./handler.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const deps: Deps = {
  env: (k) => Deno.env.get(k),
  now: () => Date.now(),
  async applyEvent(txn, status, amountCents, currency, providerTxnId, raw) {
    const { data, error } = await db.rpc("apply_payment_event", {
      p_txn: txn, p_status: status, p_amount_cents: amountCents == null || !Number.isFinite(amountCents) ? null : Math.round(amountCents),
      p_currency: currency, p_provider_txn_id: providerTxnId, p_raw: raw,
    });
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  },
  async findTxnByProviderTxn(id) {
    const { data } = await db.from("payment_transactions").select("id").eq("provider_txn_id", id).maybeSingle();
    return data?.id ?? null;
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
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const raw = await req.text();
  try {
    const r = await handle(deps, raw, req.headers.get("stripe-signature") ?? "");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("stripe-webhook error", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), { status: 500 });
  }
});
