// create-checkout — pure logic (unit-tested). The browser sends only product ids + qty, coupon code,
// destination, customer details and the chosen method. Every price/discount/shipping figure comes
// from the database (public.create_checkout_order). Online gateways are gated by PAYMENTS_MODE.

export type Rec = Record<string, unknown>;
export interface User { id: string; email?: string; app_metadata?: Record<string, unknown> }
export type Method = "cod" | "card" | "wallet" | "valu" | "stripe" | "instapay" | "bank";

export interface Deps {
  env: (k: string) => string | undefined;
  getSettings(): Promise<Rec>;
  getUser(jwt: string): Promise<User | null>;
  isAdminUserId(id: string): Promise<boolean>;
  rpcCheckout(payload: Rec): Promise<{ data?: Rec; error?: string }>;
  updateTxn(id: string, patch: Rec): Promise<void>;
  paymobIntention(secretKey: string, body: Rec): Promise<{ id?: string; client_secret?: string }>;
  stripeSession(secretKey: string, form: Record<string, string>): Promise<{ id?: string; url?: string }>;
  notifyOrderCreated(orderId: string, orderNumber: string): void;
}
export interface Result { status: number; body: Rec }

const METHODS: Method[] = ["cod", "card", "wallet", "valu", "stripe", "instapay", "bank"];
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const ok = (body: Rec, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, error: string, extra: Rec = {}): Result => ({ status, body: { ok: false, error, ...extra } });

export function paymentsMode(env: Deps["env"]): "off" | "sandbox" | "live" {
  const m = s(env("PAYMENTS_MODE")).toLowerCase();
  return m === "live" || m === "sandbox" ? m : "off";
}

/** Live mode must use live keys; sandbox must use test keys (prevents test keys in production and vice-versa). */
export function keyMatchesMode(key: string, mode: string): boolean {
  if (!key) return false;
  const isTest = /_test_/i.test(key);
  return mode === "live" ? !isTest : isTest;
}

function realBank(st: Rec): Rec | null {
  const acc = s(st.bankAccountNumber), iban = s(st.bankIBAN);
  const fake = (x: string) => !x || /^[0\s-]+$/.test(x) || /^EG0+$/i.test(x.replace(/\s/g, ""));
  if (fake(acc) && fake(iban)) return null;
  return { bank_name: s(st.bankName), account_name: s(st.bankAccountName), account_number: fake(acc) ? "" : acc,
    iban: fake(iban) ? "" : iban, swift: s(st.bankSwift) };
}

export interface Ctx { mode: string; privileged: boolean; shipType: "local" | "international"; settings: Rec }

export function availableMethods(d: Deps, c: Ctx): Method[] {
  const e = (k: string) => s(d.env(k));
  const online = c.mode === "live" || (c.mode === "sandbox" && c.privileged);
  const out: Method[] = [];
  if (c.settings.codEnabled !== false && c.shipType === "local") out.push("cod");
  if (!online) return out;
  const paymob = keyMatchesMode(e("PAYMOB_SECRET_KEY"), c.mode) && !!e("PAYMOB_PUBLIC_KEY");
  if (paymob && e("PAYMOB_INTEGRATION_CARD")) out.push("card");
  if (paymob && e("PAYMOB_INTEGRATION_WALLET") && c.shipType === "local") out.push("wallet");
  if (paymob && e("PAYMOB_INTEGRATION_VALU") && c.shipType === "local") out.push("valu");
  if (keyMatchesMode(e("STRIPE_SECRET_KEY"), c.mode) && (c.shipType === "international" || e("STRIPE_LOCAL") === "true")) out.push("stripe");
  if (s(c.settings.instapayAddress) || e("INSTAPAY_ADDRESS")) out.push("instapay");
  if (realBank(c.settings)) out.push("bank");
  return out;
}

async function isPrivileged(d: Deps, jwt: string | null, phone: string): Promise<boolean> {
  const list = s(d.env("SANDBOX_ALLOWED_PHONES")).split(",").map((x) => x.replace(/\D/g, "")).filter(Boolean);
  const p = phone.replace(/\D/g, "");
  if (p && list.some((x) => p.endsWith(x.slice(-10)))) return true;
  if (!jwt) return false;
  const u = await d.getUser(jwt).catch(() => null);
  if (!u) return false;
  if (u.app_metadata?.role === "admin") return true;
  return await d.isAdminUserId(u.id).catch(() => false);
}

const ERR: Record<string, [number, string]> = {
  empty_cart: [422, "السلة فاضية"],
  cart_too_large: [422, "عدد الأصناف كبير جدًا"],
  bad_qty: [422, "الكمية غير صحيحة"],
  product_unavailable: [409, "أحد المنتجات لم يعد متاحًا — حدّث السلة"],
  out_of_stock: [409, "أحد المنتجات نفدت كميته"],
  bad_price: [409, "سعر أحد المنتجات غير مضبوط — تواصل معنا"],
  coupon_invalid: [422, "كود الخصم غير صالح أو منتهي"],
  international_disabled: [422, "الشحن الدولي غير متاح حاليًا"],
  missing_customer: [422, "كمّل الاسم والموبايل والعنوان"],
  rate_limited: [429, "طلبات كثيرة من نفس الرقم — حاول بعد قليل"],
  bad_method: [422, "طريقة الدفع غير متاحة"],
};
export function mapDbError(msg: string): Result {
  const code = (msg.match(/([a-z_]+)(?::|$)/) || [])[1] || "";
  const hit = ERR[code];
  return hit ? fail(hit[0], code, { message: hit[1] }) : fail(500, "checkout_failed", { message: "تعذر إنشاء الطلب — حاول مرة أخرى" });
}

function cleanItems(raw: unknown): { product_id: string; qty: number }[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) return null;
  const out: { product_id: string; qty: number }[] = [];
  for (const x of raw as Rec[]) {
    const id = s(x?.product_id ?? x?.id);
    const qty = Math.floor(Number(x?.qty));
    if (!/^[A-Za-z0-9_\-.:]{1,128}$/.test(id) || !(qty >= 1 && qty <= 99)) return null;
    const prev = out.find((o) => o.product_id === id);
    if (prev) prev.qty = Math.min(99, prev.qty + qty); else out.push({ product_id: id, qty });
  }
  return out;
}

function splitName(full: string) {
  const parts = full.split(/\s+/).filter(Boolean);
  return { first: parts[0] || "Customer", last: parts.slice(1).join(" ") || "BeautyLife" };
}

export async function handle(d: Deps, body: Rec, jwt: string | null): Promise<Result> {
  const action = s(body.action) || "create";
  const shipType = s(body.ship_type) === "international" ? "international" : "local";
  const customer = (body.customer && typeof body.customer === "object" ? body.customer : {}) as Rec;
  const mode = paymentsMode(d.env);
  const settings = await d.getSettings();
  const privileged = mode === "sandbox" ? await isPrivileged(d, jwt, s(customer.phone)) : false;
  const methods = availableMethods(d, { mode, privileged, shipType, settings });

  if (action === "config") {
    const bank = methods.includes("bank") ? realBank(settings) : null;
    return ok({ mode, sandbox_access: privileged, ship_type: shipType, methods, currency: "EGP",
      instapay: methods.includes("instapay") ? (s(settings.instapayAddress) || s(d.env("INSTAPAY_ADDRESS"))) : null, bank });
  }

  const items = cleanItems(body.items);
  if (!items) return fail(422, "bad_items", { message: "بيانات السلة غير صحيحة" });
  const payload: Rec = {
    items, coupon_code: s(body.coupon_code).slice(0, 64), ship_type: shipType,
    governorate: s(body.governorate).slice(0, 64), country: s(body.country).slice(0, 64),
  };

  if (action === "quote") {
    const r = await d.rpcCheckout({ ...payload, dry_run: true });
    if (r.error) return mapDbError(r.error);
    return ok({ quote: r.data, methods });
  }
  if (action !== "create") return fail(400, "unknown_action");

  const method = s(body.payment_method).toLowerCase() as Method;
  if (!METHODS.includes(method) || !methods.includes(method)) return fail(422, "method_unavailable", { message: "طريقة الدفع غير متاحة حاليًا", methods });

  const cust = {
    name: s(customer.name).slice(0, 120), phone: s(customer.phone).slice(0, 32), email: s(customer.email).slice(0, 160),
    address: s(customer.address).slice(0, 400), city: s(customer.city).slice(0, 80), notes: s(customer.notes).slice(0, 1000),
  };
  if (shipType === "local" && !/^01[0-9]{9}$/.test(cust.phone.replace(/\s/g, ""))) return fail(422, "bad_phone", { message: "رقم الموبايل المصري غير صحيح" });
  if (cust.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(cust.email)) return fail(422, "bad_email", { message: "الإيميل غير صحيح" });

  const r = await d.rpcCheckout({ ...payload, payment_method: method, customer: cust, is_live: mode === "live" });
  if (r.error || !r.data) return mapDbError(r.error || "");
  const o = r.data;
  const orderId = s(o.order_id), orderNumber = s(o.order_number), token = s(o.public_token), txn = s(o.txn_id);
  const amountCents = Number(o.amount_cents);
  d.notifyOrderCreated(orderId, orderNumber);

  const base = { order_number: orderNumber, token, total: o.total, subtotal: o.subtotal, discount: o.discount,
    shipping_fee: o.shipping_fee, payment_method: method };
  const site = s(d.env("SITE_URL")) || "https://beautylife-eg.com";
  const returnUrl = `${site}/payment-callback.html?order=${encodeURIComponent(orderNumber)}&t=${encodeURIComponent(token)}`;

  if (method === "cod") return ok({ kind: "cod", ...base });

  if (method === "instapay" || method === "bank") {
    return ok({ kind: "transfer", ...base, reference: orderNumber,
      instapay: method === "instapay" ? (s(settings.instapayAddress) || s(d.env("INSTAPAY_ADDRESS"))) : null,
      bank: method === "bank" ? realBank(settings) : null });
  }

  try {
    if (method === "stripe") {
      const sess = await d.stripeSession(s(d.env("STRIPE_SECRET_KEY")), {
        "mode": "payment", "success_url": returnUrl, "cancel_url": returnUrl, "client_reference_id": txn,
        "metadata[txn_id]": txn, "metadata[order_number]": orderNumber, "payment_intent_data[metadata][txn_id]": txn,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "egp",
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": `Beauty Life — ${orderNumber}`,
        ...(cust.email ? { "customer_email": cust.email } : {}),
      });
      if (!sess.url || !sess.id) throw new Error("stripe_no_url");
      await d.updateTxn(txn, { provider_intent_id: sess.id });
      return ok({ kind: "redirect", ...base, redirect_url: sess.url });
    }

    const integ = s(d.env(method === "card" ? "PAYMOB_INTEGRATION_CARD" : method === "wallet" ? "PAYMOB_INTEGRATION_WALLET" : "PAYMOB_INTEGRATION_VALU"));
    const nm = splitName(cust.name);
    const api = s(d.env("PAYMOB_API_BASE")) || "https://accept.paymob.com";
    const intent = await d.paymobIntention(s(d.env("PAYMOB_SECRET_KEY")), {
      amount: amountCents, currency: "EGP", payment_methods: [Number(integ) || integ],
      items: [{ name: `Order ${orderNumber}`, amount: amountCents, description: "Beauty Life order", quantity: 1 }],
      billing_data: { first_name: nm.first, last_name: nm.last, phone_number: cust.phone, email: cust.email || "no-email@beautylife-eg.com",
        street: cust.address || "NA", building: "NA", apartment: "NA", floor: "NA", city: cust.city || "NA",
        state: s(body.governorate) || "NA", country: shipType === "local" ? "EG" : (s(body.country) || "NA") },
      special_reference: txn,
      notification_url: `${s(d.env("SUPABASE_URL"))}/functions/v1/paymob-webhook`,
      redirection_url: returnUrl,
    });
    if (!intent.client_secret) throw new Error("paymob_no_client_secret");
    await d.updateTxn(txn, { provider_intent_id: s(intent.id) || null });
    const url = `${api}/unifiedcheckout/?publicKey=${encodeURIComponent(s(d.env("PAYMOB_PUBLIC_KEY")))}&clientSecret=${encodeURIComponent(intent.client_secret)}`;
    return ok({ kind: "redirect", ...base, redirect_url: url });
  } catch (e) {
    await d.updateTxn(txn, { status: "failed", raw: { gateway_error: String(e instanceof Error ? e.message : e).slice(0, 300) } }).catch(() => {});
    return fail(502, "gateway_error", { ...base, message: "تعذر فتح بوابة الدفع — طلبك محفوظ وسنتواصل معك لإتمام الدفع" });
  }
}
