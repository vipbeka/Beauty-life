// Supabase Edge Function: create-checkout  (verify_jwt = true; called with the site's anon key)
// Secrets: PAYMENTS_MODE=off|sandbox|live (default off), SITE_URL,
//   PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_INTEGRATION_CARD, PAYMOB_INTEGRATION_WALLET, PAYMOB_INTEGRATION_VALU, PAYMOB_API_BASE,
//   STRIPE_SECRET_KEY, STRIPE_LOCAL, INSTAPAY_ADDRESS, SANDBOX_ALLOWED_PHONES, ALLOWED_ORIGINS
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle, type Deps } from "./handler.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const ORIGINS = ["https://beautylife-eg.com", "https://www.beautylife-eg.com", "https://beautylife1-890ae.web.app", "https://beautylife1-890ae.firebaseapp.com"];
function cors(origin: string | null) {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const okOrigin = origin && (ORIGINS.concat(extra).includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /^https:\/\/beautylife1-890ae--[a-z0-9-]+\.web\.app$/.test(origin));
  return { "Access-Control-Allow-Origin": okOrigin ? origin! : ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text(); let j: Record<string, unknown> = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  } finally { clearTimeout(t); }
}

const deps: Deps = {
  env: (k) => Deno.env.get(k),
  async getSettings() {
    const { data } = await db.from("settings").select("value").eq("key", "store").maybeSingle();
    return (data?.value ?? {}) as Record<string, unknown>;
  },
  async getUser(jwt) {
    const { data, error } = await db.auth.getUser(jwt);
    return error || !data?.user ? null : { id: data.user.id, email: data.user.email ?? undefined, app_metadata: data.user.app_metadata };
  },
  async isAdminUserId(id) {
    const { data, error } = await db.from("admin_users").select("user_id").eq("user_id", id).maybeSingle();
    return !error && !!data;
  },
  async rpcCheckout(payload) {
    const { data, error } = await db.rpc("create_checkout_order", { p: payload });
    return error ? { error: error.message } : { data: data as Record<string, unknown> };
  },
  async updateTxn(id, patch) {
    if (!id) return;
    await db.from("payment_transactions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  },
  async paymobIntention(secretKey, body) {
    const base = Deno.env.get("PAYMOB_API_BASE") || "https://accept.paymob.com";
    return await postJson(`${base}/v1/intention/`, { authorization: `Token ${secretKey}` }, body) as { id?: string; client_secret?: string };
  },
  async stripeSession(secretKey, form) {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST", headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`stripe ${r.status}: ${j?.error?.message ?? ""}`);
    return { id: j.id, url: j.url };
  },
  notifyOrderCreated(orderId, orderNumber) {
    const p = fetch(`${SB_URL}/functions/v1/send-order-email`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ event: "order_created", id: orderId, order_number: orderNumber }),
    }).catch((e) => console.error("notify failed", e));
    try { (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(p); } catch { /* ignore */ }
  },
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405, headers: h });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  try {
    const r = await handle(deps, body, jwt);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: h });
  } catch (e) {
    console.error("create-checkout error", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), { status: 500, headers: h });
  }
});
