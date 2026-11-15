import { assert, assertEquals } from "jsr:@std/assert@1";
import { handle, hmacHex, paymobConcat, paymobStatus, type Deps } from "./handler.ts";

const TXN = "11111111-2222-3333-4444-555555555555";
const obj = {
  id: 987654, pending: false, amount_cents: 115000, success: true, is_auth: false, is_capture: false, is_standalone_payment: true,
  is_voided: false, is_refunded: false, is_3d_secure: true, integration_id: 111, has_parent_transaction: false,
  created_at: "2026-11-15T12:00:00.000000", currency: "EGP", error_occured: false, owner: 42,
  order: { id: 555, merchant_order_id: TXN }, source_data: { pan: "2346", type: "card", sub_type: "MasterCard" },
};
function mk(applied: Record<string, unknown> = { ok: true, changed: true, status: "paid", order_id: "o_1" }) {
  const log: Record<string, unknown>[] = [], apply: unknown[][] = [], paid: string[] = [];
  const d: Deps = {
    env: (k) => ({ PAYMOB_HMAC_SECRET: "HMACSECRET" } as Record<string, string>)[k],
    applyEvent: (...a) => { apply.push(a); return Promise.resolve(applied); },
    logEvent: (r) => { log.push(r); return Promise.resolve(); },
    notifyPaid: (id) => { paid.push(id); },
  };
  return { d, log, apply, paid };
}

Deno.test("concatenation follows Paymob's documented field order", () => {
  assertEquals(paymobConcat(obj), "1150002026-11-15T12:00:00.000000EGPfalsefalse987654111truefalsefalsefalsetruefalse55542false2346MasterCardcardtrue");
});

Deno.test("valid HMAC → paid applied with DB amount check inputs, email triggered", async () => {
  const { d, apply, paid } = mk();
  const sig = await hmacHex("SHA-512", "HMACSECRET", paymobConcat(obj));
  const r = await handle(d, { type: "TRANSACTION", obj }, sig);
  assertEquals(r.status, 200);
  assertEquals(apply[0], [TXN, "paid", 115000, "EGP", "987654", obj]);
  assertEquals(paid, ["o_1"]);
});

Deno.test("forged / tampered callbacks are rejected and nothing is applied", async () => {
  const { d, apply, log } = mk();
  const sig = await hmacHex("SHA-512", "HMACSECRET", paymobConcat(obj));
  const tampered = { ...obj, amount_cents: 100 };
  assertEquals((await handle(d, { type: "TRANSACTION", obj: tampered }, sig)).status, 401);
  assertEquals((await handle(d, { type: "TRANSACTION", obj }, "")).status, 401);
  assertEquals((await handle(d, { type: "TRANSACTION", obj }, "00" + sig.slice(2))).status, 401);
  assertEquals(apply.length, 0);
  assert(log.every((l) => l.signature_ok === false));
});

Deno.test("status mapping + replay is a no-op email-wise", async () => {
  assertEquals(paymobStatus({ success: true, pending: false }), "paid");
  assertEquals(paymobStatus({ success: false, pending: false }), "failed");
  assertEquals(paymobStatus({ success: true, pending: true }), null);
  assertEquals(paymobStatus({ success: true, pending: false, is_refunded: true }), "refunded");
  const { d, paid } = mk({ ok: true, changed: false, status: "paid", order_id: "o_1" });
  const sig = await hmacHex("SHA-512", "HMACSECRET", paymobConcat(obj));
  await handle(d, { type: "TRANSACTION", obj }, sig);
  assertEquals(paid.length, 0, "replayed webhook must not resend the email");
});

Deno.test("not configured → 503 (Paymob retries later)", async () => {
  const d: Deps = { env: () => undefined, applyEvent: () => Promise.resolve({}), logEvent: () => Promise.resolve(), notifyPaid: () => {} };
  assertEquals((await handle(d, { obj }, "x")).status, 503);
});
