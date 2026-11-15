/* Beauty Life — server-side email bridge.
 * Sends notification *requests* (event + record id) to the Supabase Edge Function
 * `send-order-email`. The function loads the record from the database and sends the
 * email with the Brevo key stored in Supabase Secrets. No API key ever reaches the browser.
 *
 * Returns true when the server handled the event (sent, deduplicated, or disabled in
 * settings). Returns false only when the function is unreachable/not configured, so the
 * legacy path can act as a temporary fallback during rollout.
 */
(function () {
  "use strict";
  var FN = "send-order-email";
  var TIMEOUT_MS = 10000;
  var unavailableUntil = 0;

  function client() {
    return window.SB && window.SB.client ? window.SB.client : null;
  }

  function withTimeout(p, ms) {
    return Promise.race([
      p,
      new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error("timeout")); }, ms);
      })
    ]);
  }

  async function call(body) {
    var c = client();
    if (!c || !c.functions) return { ok: false, reason: "no_client" };
    if (Date.now() < unavailableUntil) return { ok: false, reason: "unavailable" };
    try {
      var res = await withTimeout(c.functions.invoke(FN, { body: body }), TIMEOUT_MS);
      if (res && res.error) {
        var status = res.error.context && res.error.context.status;
        // Not deployed / not configured: back off for this page view.
        if (status === 404 || status === 503) unavailableUntil = Date.now() + 5 * 60 * 1000;
        return { ok: false, reason: "http_" + (status || "error") };
      }
      var data = res ? res.data : null;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) {} }
      return data && data.ok === true ? data : { ok: false, reason: (data && data.error) || "bad_response" };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : "invoke_failed" };
    }
  }

  function debug(v) {
    try { localStorage.setItem("bl_last_server_mail_debug", JSON.stringify(Object.assign({ at: new Date().toISOString() }, v))); } catch (e) {}
  }

  async function run(body) {
    var r = await call(body);
    debug({ request: body, result: r });
    return !!(r && r.ok === true);
  }

  var ADMIN_REF = {
    order_created: function (t) { return t.order; },
    return_created: function (t) { return t.return_request; },
    warranty_created: function (t) { return t.warranty_claim; },
    consultation_created: function (t) { return t.consultation; },
    testimonial_created: function (t) { return t.testimonial; }
  };

  window.BLServerMail = {
    adminEvent: async function (event, payload) {
      var pick = ADMIN_REF[event];
      var rec = pick ? pick(payload || {}) : null;
      if (!rec || !rec.id) return false;
      return run({ event: event, id: String(rec.id), order_number: rec.order_number ? String(rec.order_number) : undefined });
    },
    customerEvent: async function (event, order) {
      if (!order || !order.id) return false;
      var map = { order_created: "order_created", status: "order_status", payment_paid: "payment_paid", payment_refunded: "payment_refunded" };
      var ev = map[event];
      if (!ev) return false;
      return run({ event: ev, id: String(order.id), order_number: order.order_number ? String(order.order_number) : undefined });
    },
    test: function () { return call({ event: "test" }); },
    health: function () { return call({ event: "health" }); }
  };

  /* ---------- Admin settings UI: replace API-key inputs with a secure notice ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function lockKeyInput(id, label) {
    var input = document.getElementById(id);
    if (!input || input.dataset.serverLocked) return;
    input.dataset.serverLocked = "1";
    input.value = "";
    input.disabled = true;
    var group = input.closest(".form-group") || input.parentNode;
    group.style.display = "none";
    var note = document.createElement("div");
    note.className = "notify-note-v10";
    note.setAttribute("data-server-mail-note", id);
    note.innerHTML = '<i class="fas fa-lock"></i> ' + esc(label) +
      ' محفوظ الآن بأمان في Supabase Secrets على السيرفر ولا يظهر للزوار. ' +
      '<button type="button" class="btn btn-ghost btn-sm" style="margin-inline-start:8px">' +
      '<i class="fas fa-paper-plane"></i> إرسال إيميل تجريبي من السيرفر</button> <small data-r></small>';
    group.parentNode.insertBefore(note, group.nextSibling);
    var btn = note.querySelector("button"), out = note.querySelector("[data-r]");
    btn.addEventListener("click", async function () {
      btn.disabled = true; out.textContent = "جارٍ الإرسال...";
      var r = await window.BLServerMail.test();
      btn.disabled = false;
      out.textContent = r && r.ok ? "✓ تم الإرسال إلى " + (r.to || []).join(", ") : "✗ فشل: " + ((r && (r.error || r.reason)) || "غير معروف");
      if (window.toast) window.toast(out.textContent, r && r.ok ? "success" : "error");
    });
  }

  function patchAdminUI() {
    if (!document.querySelector(".admin-shell")) return;
    lockKeyInput("set_brevoApiKey", "مفتاح Brevo لإشعارات الإدارة");
    lockKeyInput("set_customerBrevoApiKey", "مفتاح Brevo لرسائل العملاء");
  }

  function boot() {
    patchAdminUI();
    var n = 0, iv = setInterval(function () { patchAdminUI(); if (++n > 30) clearInterval(iv); }, 1000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("bl:settings-updated", function () { setTimeout(patchAdminUI, 50); });
})();
