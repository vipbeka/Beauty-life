// Supabase Edge Function: send-order-email
// Sends Beauty Life notification emails server-side via Brevo.
// Secrets: BREVO_API_KEY (required), BREVO_CUSTOMER_API_KEY (optional; customer emails),
// optional: NOTIFY_TO_EMAIL, BREVO_SENDER_EMAIL, BREVO_CUSTOMER_SENDER_EMAIL, ADMIN_EMAILS,
//           ALLOWED_ORIGINS, FRESH_MINUTES, ANON_LIMIT_10MIN.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle, type Deps } from "./handler.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const DEFAULT_ORIGINS = [
  "https://beautylife-eg.com", "https://www.beautylife-eg.com",
  "https://beautylife1-890ae.web.app", "https://beautylife1-890ae.firebaseapp.com",
];
function allowedOrigin(origin: string | null): string {
  const list = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean).concat(DEFAULT_ORIGINS);
  if (origin && (list.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /^https:\/\/beautylife1-890ae--[a-z0-9-]+\.web\.app$/.test(origin))) return origin; // Firebase preview channels
  return DEFAULT_ORIGINS[0];
}
function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const deps: Deps = {
  env: (k) => Deno.env.get(k),
  now: () => Date.now(),
  async getSettings() {
    const { data, error } = await db.from("settings").select("key,value");
    if (error) throw error;
    const row = (data ?? []).find((r) => r.key === "store") ?? (data ?? [])[0];
    return (row?.value ?? {}) as Record<string, unknown>;
  },
  async getRecord(table, id) {
    const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async getOrderItems(orderId) {
    const { data } = await db.from("order_items").select("*").eq("order_id", orderId);
    return data ?? [];
  },
  async claim(row) {
    const { data, error } = await db.from("email_log").upsert({ ...row, status: "pending" }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  },
  async finish(key, ok, info) {
    // On failure, free the dedupe key (rename it) so a later retry can send.
    const patch = ok ? { status: "sent", message_id: info.message_id ?? null, sent_at: new Date().toISOString() }
      : { status: "failed", error: info.error ?? null, dedupe_key: `${key}:failed:${Date.now()}` };
    await db.from("email_log").update(patch).eq("dedupe_key", key);
  },
  async countRecent({ minutes, source, recipient }) {
    let q = db.from("email_log").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - minutes * 60_000).toISOString());
    if (source) q = q.eq("source", source);
    if (recipient) q = q.eq("recipient", recipient);
    const { count } = await q;
    return count ?? 0;
  },
  async emailLogReady() {
    const { error } = await db.from("email_log").select("id", { head: true, count: "exact" }).limit(1);
    return !error;
  },
  async getUser(jwt) {
    const { data, error } = await db.auth.getUser(jwt);
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? undefined, app_metadata: data.user.app_metadata };
  },
  async isAdminUserId(id) {
    const { data, error } = await db.from("admin_users").select("user_id").eq("user_id", id).maybeSingle();
    return !error && !!data;
  },
  async sendBrevo(apiKey, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST", signal: ctl.signal,
        headers: { "accept": "application/json", "content-type": "application/json", "api-key": apiKey },
        body: JSON.stringify(body),
      });
      const txt = await r.text();
      let j: Record<string, unknown> = {};
      try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
      if (!r.ok) throw new Error(String(j.message ?? j.code ?? `Brevo HTTP ${r.status}`));
      return { messageId: j.messageId as string | undefined };
    } finally { clearTimeout(t); }
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
    const res = await handle(deps, body, jwt);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: h });
  } catch (e) {
    console.error("send-order-email error", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), { status: 500, headers: h });
  }
});
