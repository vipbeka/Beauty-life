// Email templates for send-order-email. Every dynamic value is HTML-escaped.
// Brand: navy #0b1b3a / gold #d4af5a, RTL, Arabic.

export type Row = [string, unknown];
export type Settings = Record<string, unknown>;
export type Rec = Record<string, unknown>;

export interface Item { name: string; qty: number; price: number; line: number; variant: string; warranty: string }
export interface Mail { subject: string; html: string; text: string }

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

export function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function first(...vals: unknown[]): string {
  for (const v of vals) { const s = str(v); if (s) return s; }
  return "";
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function money(v: unknown, s: Settings): string {
  const n = num(v);
  return n == null ? "—" : n.toLocaleString("en-EG") + " " + (str(s.currency) || "ج.م");
}

export function items(order: Rec, fallbackRows: Rec[] = []): Item[] {
  let raw: unknown = order.items;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = []; } }
  let list: Rec[] = Array.isArray(raw) ? raw as Rec[] : [];
  if (!list.length && fallbackRows.length) {
    list = fallbackRows.map((r) => ({ name: r.product_name, qty: r.quantity, price: r.price, ...(r.meta as Rec || {}) }));
  }
  return list.map((x) => {
    const qty = Math.max(1, Math.floor(num(x.qty ?? x.quantity) ?? 1));
    const price = num(x.price ?? x.unit_price) ?? 0;
    return {
      name: first(x.name, x.product_name, x.title, x.product_id, "منتج"),
      qty, price, line: qty * price,
      variant: first(x.variant, x.option, x.color, x.model),
      warranty: first(x.warranty, x.warranty_days ? `${x.warranty_days} يوم` : ""),
    };
  });
}

const NAVY = "#0b1b3a", GOLD = "#d4af5a", BORDER = "#e3e9f0", MUTED = "#6b7688";
const td = `padding:10px 12px;border:1px solid ${BORDER};`;

function rowsHtml(rows: Row[]): string {
  return rows.filter((r) => str(r[1]) !== "").map((r) =>
    `<tr><td style="${td}background:#f2f5f9;font-weight:700;white-space:nowrap;">${esc(r[0])}</td><td style="${td}">${esc(r[1])}</td></tr>`
  ).join("");
}

function rowsText(rows: Row[]): string {
  return rows.filter((r) => str(r[1]) !== "").map((r) => `${r[0]}: ${str(r[1])}`).join("\n");
}

function itemsHtml(list: Item[], s: Settings): string {
  if (!list.length) return "";
  const th = (t: string, a = "right") => `<th style="${td}background:${NAVY};color:#fff;text-align:${a};font-size:13px;">${esc(t)}</th>`;
  const body = list.map((it, i) =>
    `<tr style="background:${i % 2 ? "#f8fafc" : "#fff"}"><td style="${td}font-weight:700;">${esc(it.name)}` +
    (it.variant ? `<div style="font-size:12px;color:${MUTED}">${esc(it.variant)}</div>` : "") +
    (it.warranty ? `<div style="font-size:12px;color:#0e9f6e">${esc(it.warranty)}</div>` : "") +
    `</td><td style="${td}text-align:center;">${esc(it.qty)}</td><td style="${td}text-align:center;">${esc(money(it.price, s))}</td>` +
    `<td style="${td}text-align:center;font-weight:700;">${esc(money(it.line, s))}</td></tr>`
  ).join("");
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;"><thead><tr>${th("المنتج / الجهاز")}${th("الكمية", "center")}${th("سعر الوحدة", "center")}${th("الإجمالي", "center")}</tr></thead><tbody>${body}</tbody></table>`;
}

function itemsText(list: Item[], s: Settings): string {
  if (!list.length) return "";
  return "الأصناف:\n" + list.map((it, i) => `  ${i + 1}) ${it.name}${it.variant ? ` [${it.variant}]` : ""} × ${it.qty} = ${money(it.line, s)}`).join("\n");
}

function frame(store: string, title: string, intro: string, inner: string): string {
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#f2f5f9;padding:24px;color:#1a2333;text-align:right;">` +
    `<div style="max-width:720px;margin:auto;background:#fff;border:1px solid ${BORDER};border-radius:18px;overflow:hidden;">` +
    `<div style="background:${NAVY};color:#fff;padding:22px 24px;border-bottom:4px solid ${GOLD};">` +
    `<div style="font-size:13px;color:${GOLD};font-weight:700;letter-spacing:.5px;">${esc(store)}</div>` +
    `<h2 style="margin:8px 0 0;font-size:20px;">${esc(title)}</h2></div>` +
    `<div style="padding:22px 24px;">${intro ? `<p style="margin:0 0 14px;line-height:1.8;">${esc(intro)}</p>` : ""}${inner}</div>` +
    `<div style="padding:14px 24px;background:#f8fafc;color:${MUTED};font-size:12px;border-top:1px solid ${BORDER};">${esc(store)}</div>` +
    `</div></div>`;
}

const PAY: Record<string, string> = {
  cod: "الدفع عند الاستلام (COD)", visa: "فيزا / كارت", card: "فيزا / كارت",
  wallet: "محفظة إلكترونية", instapay: "إنستاباي", bank: "تحويل بنكي", stripe: "Stripe",
};

function orderTotals(o: Rec, list: Item[], s: Settings): Row[] {
  const sub = num(o.subtotal) ?? list.reduce((a, b) => a + b.line, 0);
  const ship = num(o.shipping_fee ?? o.shipping_cost);
  const disc = num(o.discount);
  const rows: Row[] = [];
  if (list.length) rows.push(["عدد الأصناف", `${list.length} صنف`]);
  rows.push(["إجمالي المنتجات", money(sub, s)]);
  rows.push(["سعر الشحن", ship == null ? "غير محدد" : ship > 0 ? money(ship, s) : "مجاني (0)"]);
  if (disc && disc > 0) rows.push(["الخصم", "- " + money(disc, s)]);
  if (str(o.coupon_code)) rows.push(["كود الخصم", o.coupon_code]);
  rows.push(["الإجمالي النهائي", money(o.total, s)]);
  return rows;
}

function storeName(s: Settings) { return str(s.storeName) || "Beauty Life"; }

/** Admin notification for a newly created record. */
export function adminMail(event: string, rec: Rec, s: Settings, orderItemRows: Rec[] = []): Mail {
  const store = storeName(s);
  let subject = `تنبيه جديد - ${store}`, title = "وصل تنبيه جديد من الموقع", rows: Row[] = [], list: Item[] = [];
  if (event === "order_created") {
    list = items(rec, orderItemRows);
    const addr = [rec.address ?? rec.customer_address, rec.city, rec.governorate, rec.country].map(str).filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).join(" — ");
    subject = `طلب جديد - ${store}`; title = "تم استلام طلب جديد";
    rows = [
      ["رقم الطلب", first(rec.order_number, rec.id)], ["اسم العميل", rec.customer_name], ["الموبايل", rec.customer_phone],
      ["إيميل العميل", rec.customer_email], ["طريقة الدفع", PAY[str(rec.payment_method).toLowerCase()] || first(rec.payment_method, "—")],
      ["العنوان", addr || "—"], ["ملاحظات العميل", rec.notes], ...orderTotals(rec, list, s),
    ];
  } else if (event === "return_created") {
    subject = `طلب استرجاع جديد - ${store}`; title = "تم استلام طلب استرجاع جديد";
    rows = [["رقم الطلب", first(rec.order_number, rec.order_id)], ["اسم العميل", rec.customer_name], ["الموبايل", rec.customer_phone],
      ["نوع الطلب", first(rec.return_type, "refund")], ["السبب", rec.reason], ["الحالة", first(rec.status, "pending")]];
  } else if (event === "warranty_created") {
    subject = `مطالبة ضمان جديدة - ${store}`; title = "تم استلام مطالبة ضمان جديدة";
    rows = [["رقم الطلب", first(rec.order_number, rec.order_id)], ["اسم العميل", rec.customer_name], ["الموبايل", rec.customer_phone],
      ["المنتج", first(rec.product_name, rec.product_id)], ["نوع العطل", rec.issue_type], ["الوصف", first(rec.description, rec.issue)]];
  } else if (event === "testimonial_created") {
    subject = `تقييم جديد - ${store}`; title = "وصل تقييم أو رأي جديد من عميل";
    rows = [["الاسم", rec.name], ["المدينة", rec.city], ["التقييم", rec.rating != null ? `${rec.rating}/5` : "—"],
      ["نوع الرأي", first(rec.review_type, "site")], ["رقم الطلب", rec.order_number], ["النص", rec.text]];
  } else if (event === "consultation_created") {
    subject = `استشارة جديدة - ${store}`; title = "وصلت استشارة جديدة من عميل";
    rows = [["الاسم", rec.name], ["الموبايل", rec.phone], ["العيادة / المدينة", first(rec.clinic_name, rec.city)],
      ["الجهاز المطلوب", first(rec.device_interest, rec.device)], ["الميزانية", rec.budget_egp != null ? money(rec.budget_egp, s) : ""],
      ["الرسالة", rec.message]];
  }
  const inner = itemsHtml(list, s) + `<table style="width:100%;border-collapse:collapse;">${rowsHtml(rows)}</table>`;
  const text = [title, itemsText(list, s), rowsText(rows)].filter(Boolean).join("\n\n");
  return { subject, html: frame(store, title, "", inner), text };
}

const CUSTOMER: Record<string, [string, string, (store: string) => string]> = {
  order_created: ["تم استلام طلبك", "تم استلام طلبك بنجاح", (st) => `شكرًا لطلبك من ${st}. استلمنا بيانات طلبك وسنتواصل معك قريبًا.`],
  confirmed: ["تم تأكيد طلبك", "تم تأكيد طلبك", (st) => `تم تأكيد طلبك من فريق ${st}.`],
  processing: ["بدأ تجهيز طلبك", "طلبك قيد التجهيز", (st) => `بدأ فريق ${st} تجهيز طلبك بعناية.`],
  shipped: ["تم شحن طلبك", "طلبك في الطريق إليك", () => "تم شحن طلبك وسيتم التواصل معك بخصوص التسليم."],
  delivered: ["تم تسليم طلبك", "تم تسليم طلبك", (st) => `نشكرك لاختيار ${st}. نأمل أن تنال مشترياتك رضاك.`],
  cancelled: ["تم إلغاء طلبك", "تم إلغاء طلبك", () => "تم تحديث طلبك إلى حالة الإلغاء. إذا كان لديك استفسار فتواصل معنا."],
  payment_paid: ["تم تأكيد الدفع", "تم تأكيد عملية الدفع", () => "تم تأكيد استلام دفعتك بنجاح وسيبدأ تجهيز الطلب."],
  payment_refunded: ["تم تأكيد الاسترجاع", "تم تأكيد الاسترجاع ورد المبلغ", () => "تم تحديث طلب الاسترجاع الخاص بك. تواصل معنا إذا احتجت إلى مساعدة."],
};

/** Customer email. `kind` is order_created | confirmed | processing | shipped | delivered | cancelled | payment_paid | payment_refunded. */
export function customerMail(kind: string, order: Rec, s: Settings, orderItemRows: Rec[] = []): Mail | null {
  const t = CUSTOMER[kind === "canceled" ? "cancelled" : kind];
  if (!t) return null;
  const store = storeName(s), no = first(order.order_number, order.id);
  const list = items(order, orderItemRows);
  const rows: Row[] = [["رقم الطلب", no], ["اسم العميل", order.customer_name], ["الإجمالي", money(order.total, s)]];
  const inner = itemsHtml(list, s) + `<table style="width:100%;border-collapse:collapse;">${rowsHtml(rows)}</table>`;
  return {
    subject: `${t[0]} #${no} - ${store}`,
    html: frame(store, t[1], t[2](store), inner),
    text: [t[1], t[2](store), itemsText(list, s), rowsText(rows)].filter(Boolean).join("\n\n"),
  };
}

export function testMail(s: Settings, which: string): Mail {
  const store = storeName(s);
  const title = `إيميل تجريبي — ${which}`;
  const intro = "تم إرسال هذه الرسالة من السيرفر (Supabase Edge Function) باستخدام المفتاح المحفوظ في Secrets. لو وصلتك يبقى الإعداد سليم.";
  return { subject: `[اختبار] ${title} - ${store}`, html: frame(store, title, intro, ""), text: `${title}\n\n${intro}` };
}
