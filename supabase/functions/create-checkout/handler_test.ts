import { assert, assertEquals } from "jsr:@std/assert@1";
import { availableMethods, handle, keyMatchesMode, mapDbError, type Deps } from "./handler.ts";

function mk(env: Record<string, string> = {}, settings: Record<string, unknown> = {}, opts: { rpcError?: string; admin?: boolean; gatewayFail?: boolean } = {}) {
  const calls: Record<string, unknown[]> = { rpc: [], txn: [], paymob: [], stripe: [], notify: [] };
  const d: Deps = {
    env: (k) => env[k],
    getSettings: () => Promise.resolve({ codEnabled: true, bankAccountNumber: "0000000000000000", bankIBAN: "EG000000000000000000000000000", ...settings }),
    getUser: (jwt) => Promise.resolve(jwt === "admin" ? { id: "a", app_metadata: { role: "admin" } } : jwt === "user" ? { id: "u", email: "admin@beautylife.com" } : null),
    isAdminUserId: () => Promise.resolve(false),
    rpcCheckout: (p) => {
      calls.rpc.push(p);
      if (opts.rpcError) return Promise.resolve({ error: opts.rpcError });
      return Promise.resolve({ data: { ok: true, order_id: "o_1", order_number: "BL-000001-AAA", public_token: "tok-1", txn_id: p.payment_method === "cod" ? null : "11111111-2222-3333-4444-555555555555",
        subtotal: 1000, discount: 0, shipping_fee: 150, total: 1150, amount_cents: 115000 } });
    },
    updateTxn: (id, patch) => { calls.txn.push([id, patch]); return Promise.resolve(); },
    paymobIntention: (_k, b) => { calls.paymob.push(b); return opts.gatewayFail ? Promise.reject(new Error("down")) : Promise.resolve({ id: "pi_1", client_secret: "cs_123" }); },
    stripeSession: (_k, f) => { calls.stripe.push(f); return Promise.resolve({ id: "cs_test_1", url: "https://checkout.stripe.com/x" }); },
    notifyOrderCreated: (id, n) => { calls.notify.push([id, n]); },
  };
  return { d, calls };
}
const cart = { items: [{ product_id: "p1", qty: 1, price: 1 }], customer: { name: "Test Buyer", phone: "01012345678", address: "1 St", email: "b@example.com" } };
const PAYMOB = { PAYMOB_SECRET_KEY: "egy_sk_test_abc", PAYMOB_PUBLIC_KEY: "egy_pk_test_abc", PAYMOB_INTEGRATION_CARD: "111", PAYMOB_INTEGRATION_WALLET: "222", PAYMOB_INTEGRATION_VALU: "333", SUPABASE_URL: "https://x.supabase.co", SITE_URL: "https://beautylife-eg.com" };

Deno.test("PAYMENTS_MODE off (default): only COD offered, online methods rejected", async () => {
  const { d } = mk(PAYMOB, { instapayAddress: "beauty@instapay" });
  const c = await handle(d, { action: "config" }, "admin");
  assertEquals(c.body.methods, ["cod"]);
  const r = await handle(d, { ...cart, payment_method: "card" }, "admin");
  assertEquals(r.status, 422); assertEquals(r.body.error, "method_unavailable");
});

Deno.test("sandbox: online methods only for admins / allow-listed phones; test keys required", async () => {
  const { d } = mk({ ...PAYMOB, PAYMENTS_MODE: "sandbox", SANDBOX_ALLOWED_PHONES: "01099999999" }, { instapayAddress: "beauty@instapay" });
  assertEquals((await handle(d, { action: "config" }, null)).body.methods, ["cod"]);
  assertEquals((await handle(d, { action: "config" }, "user")).body.methods, ["cod"], "email-only 'admin' is not privileged");
  assertEquals((await handle(d, { action: "config" }, "admin")).body.methods, ["cod", "card", "wallet", "valu", "instapay"]);
  assertEquals((await handle(d, { action: "config", customer: { phone: "01099999999" } }, null)).body.methods, ["cod", "card", "wallet", "valu", "instapay"]);
  const live = mk({ ...PAYMOB, PAYMENTS_MODE: "live" });
  assertEquals((await handle(live.d, { action: "config" }, null)).body.methods, ["cod"], "test keys are refused in live mode");
  assert(keyMatchesMode("egy_sk_live_x", "live") && !keyMatchesMode("sk_test_x", "live") && keyMatchesMode("sk_test_x", "sandbox"));
});

Deno.test("client prices are ignored: only ids+qty reach the DB", async () => {
  const { d, calls } = mk();
  const r = await handle(d, { ...cart, items: [{ product_id: "p1", qty: 2, price: 1, name: "hack" }, { id: "p1", qty: 1 }], total: 1, subtotal: 1, payment_method: "cod" }, null);
  assertEquals(r.status, 200); assertEquals(r.body.kind, "cod"); assertEquals(r.body.total, 1150);
  const sent = calls.rpc[0] as Record<string, unknown>;
  assertEquals(sent.items, [{ product_id: "p1", qty: 3 }]);
  assert(!("total" in sent) && !("subtotal" in sent));
  assertEquals(calls.notify.length, 1);
});

Deno.test("input validation", async () => {
  const { d } = mk();
  assertEquals((await handle(d, { ...cart, items: [{ product_id: "p1');--", qty: 1 }], payment_method: "cod" }, null)).body.error, "bad_items");
  assertEquals((await handle(d, { ...cart, items: [{ product_id: "p1", qty: 0 }], payment_method: "cod" }, null)).body.error, "bad_items");
  assertEquals((await handle(d, { ...cart, customer: { ...cart.customer, phone: "123" }, payment_method: "cod" }, null)).body.error, "bad_phone");
  assertEquals((await handle(d, { ...cart, payment_method: "bitcoin" }, null)).body.error, "method_unavailable");
});

Deno.test("DB errors map to safe Arabic messages", async () => {
  assertEquals(mapDbError("product_unavailable:p9").status, 409);
  assertEquals(mapDbError("coupon_invalid").body.error, "coupon_invalid");
  assertEquals(mapDbError("rate_limited").status, 429);
  assertEquals(mapDbError("weird internal detail").body.error, "checkout_failed");
  assertEquals(mapDbError("Could not find the function public.create_checkout_order(p) in the schema cache").status, 503);
  const { d } = mk({}, {}, { rpcError: "out_of_stock:p1" });
  assertEquals((await handle(d, { ...cart, payment_method: "cod" }, null)).status, 409);
});

Deno.test("card (sandbox admin): Paymob intention with DB amount + signed callback URL + redirect", async () => {
  const { d, calls } = mk({ ...PAYMOB, PAYMENTS_MODE: "sandbox" });
  const r = await handle(d, { ...cart, payment_method: "card" }, "admin");
  assertEquals(r.body.kind, "redirect");
  assert(String(r.body.redirect_url).startsWith("https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_abc&clientSecret=cs_123"));
  const b = calls.paymob[0] as Record<string, unknown>;
  assertEquals(b.amount, 115000); assertEquals(b.payment_methods, [111]);
  assertEquals(b.special_reference, "11111111-2222-3333-4444-555555555555");
  assertEquals(b.notification_url, "https://x.supabase.co/functions/v1/paymob-webhook");
  assertEquals(b.redirection_url, "https://beautylife-eg.com/payment-callback.html?order=BL-000001-AAA&t=tok-1");
  assertEquals((calls.txn[0] as unknown[])[1], { provider_intent_id: "pi_1" });
});

Deno.test("gateway down: order kept, txn failed, friendly 502", async () => {
  const { d, calls } = mk({ ...PAYMOB, PAYMENTS_MODE: "sandbox" }, {}, { gatewayFail: true });
  const r = await handle(d, { ...cart, payment_method: "wallet" }, "admin");
  assertEquals(r.status, 502); assertEquals(r.body.order_number, "BL-000001-AAA");
  assertEquals(((calls.txn[0] as unknown[])[1] as Record<string, unknown>).status, "failed");
});

Deno.test("stripe (international) + instapay/bank transfer instructions", async () => {
  const s = mk({ PAYMENTS_MODE: "sandbox", STRIPE_SECRET_KEY: "sk_test_1", SITE_URL: "https://beautylife-eg.com" }, { instapayAddress: "beauty@instapay", bankAccountNumber: "1234567890", bankName: "NBE" });
  const intl = await handle(s.d, { ...cart, ship_type: "international", country: "KSA", customer: { ...cart.customer, phone: "+966500000000" }, payment_method: "stripe" }, "admin");
  assertEquals(intl.body.kind, "redirect");
  assertEquals((s.calls.stripe[0] as Record<string, string>)["line_items[0][price_data][unit_amount]"], "115000");
  const ip = await handle(s.d, { ...cart, payment_method: "instapay" }, "admin");
  assertEquals(ip.body.kind, "transfer"); assertEquals(ip.body.instapay, "beauty@instapay"); assertEquals(ip.body.reference, "BL-000001-AAA");
  const bank = await handle(s.d, { ...cart, payment_method: "bank" }, "admin");
  assertEquals((bank.body.bank as Record<string, string>).account_number, "1234567890");
});

Deno.test("fake bank placeholders never enable bank transfer", () => {
  const { d } = mk();
  const m = availableMethods(d, { mode: "live", privileged: false, shipType: "local", settings: { bankAccountNumber: "0000000000000000", bankIBAN: "EG000000000000000000000000000" } });
  assert(!m.includes("bank"));
});
