import { assertEquals } from "jsr:@std/assert@1";
import { handle, hmacHex, verifyStripe, type Deps } from "./handler.ts";

const TXN = "11111111-2222-3333-4444-555555555555";
const NOW = 1_800_000_000_000;
async function signed(ev: unknown, secret = "whsec_test", t = Math.floor(NOW / 1000)) {
  const raw = JSON.stringify(ev);
  return { raw, header: `t=${t},v1=${await hmacHex(secret, `${t}.${raw}`)}` };
}
function mk() {
  const apply: unknown[][] = [], paid: string[] = [];
  const d: Deps = {
    env: (k) => ({ STRIPE_WEBHOOK_SECRET: "whsec_test" } as Record<string, string>)[k], now: () => NOW,
    applyEvent: (...a) => { apply.push(a); return Promise.resolve({ ok: true, changed: true, order_id: "o_1" }); },
    findTxnByProviderTxn: (id) => Promise.resolve(id === "pi_1" ? TXN : null),
    logEvent: () => Promise.resolve(), notifyPaid: (id) => { paid.push(id); },
  };
  return { d, apply, paid };
}
const completed = { type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", amount_total: 115000, currency: "egp", payment_intent: "pi_1", client_reference_id: TXN, metadata: { txn_id: TXN } } } };

Deno.test("valid signature → paid with Stripe amount (DB re-checks it)", async () => {
  const { d, apply, paid } = mk();
  const s = await signed(completed);
  assertEquals((await handle(d, s.raw, s.header)).status, 200);
  assertEquals(apply[0].slice(0, 5), [TXN, "paid", 115000, "egp", "pi_1"]);
  assertEquals(paid, ["o_1"]);
});

Deno.test("bad secret, tampered body, or stale timestamp are rejected", async () => {
  const { d, apply } = mk();
  const wrong = await signed(completed, "whsec_other");
  assertEquals((await handle(d, wrong.raw, wrong.header)).status, 400);
  const s = await signed(completed);
  assertEquals((await handle(d, s.raw.replace("115000", "100"), s.header)).status, 400);
  const old = await signed(completed, "whsec_test", Math.floor(NOW / 1000) - 3600);
  assertEquals(await verifyStripe(old.raw, old.header, "whsec_test", NOW), false);
  assertEquals(apply.length, 0);
});

Deno.test("refund found via payment_intent; unrelated events ignored", async () => {
  const { d, apply } = mk();
  const s = await signed({ type: "charge.refunded", data: { object: { payment_intent: "pi_1", currency: "egp" } } });
  await handle(d, s.raw, s.header);
  assertEquals(apply[0].slice(0, 2), [TXN, "refunded"]);
  const x = await signed({ type: "customer.created", data: { object: {} } });
  assertEquals((await handle(d, x.raw, x.header)).body.ignored, true);
});
