/* Beauty Life — Checkout v2 (server-priced, multi-method).
 * The browser sends only product ids + quantities; the Edge Function `create-checkout` prices
 * everything from the database and returns either a COD confirmation, transfer instructions
 * (InstaPay / bank) or a secure gateway redirect (Paymob card/wallet/ValU, Stripe).
 * Payment methods shown = what the server allows (PAYMENTS_MODE off → COD only).
 * Zero-downtime: if the function is not deployed/reachable, the previous checkout runs unchanged.
 */
(function () {
  "use strict";
  var FN = "create-checkout";
  var state = { cfg: null, ship: null, method: "cod", unavailable: false, legacySubmit: null, busy: false };

  var METHOD_UI = {
    cod:      ["fa-money-bill-wave", "الدفع عند الاستلام", "كاش عند التسليم"],
    card:     ["fa-credit-card", "بطاقة بنكية", "Visa · Mastercard · Meeza"],
    wallet:   ["fa-mobile-screen", "محفظة إلكترونية", "فودافون كاش وغيرها"],
    valu:     ["fa-calendar-check", "تقسيط ValU", "قسّط مشترياتك"],
    stripe:   ["fa-globe", "بطاقة دولية", "دفع آمن من خارج مصر"],
    instapay: ["fa-bolt", "إنستاباي", "تحويل فوري"],
    bank:     ["fa-building-columns", "تحويل بنكي", "على حساب الشركة"]
  };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(m, t) { if (window.toast) window.toast(m, t); }
  function money(v) {
    var s = (window.BL && BL.getSettings && BL.getSettings()) || {};
    return Number(v || 0).toLocaleString("en-EG") + " " + (s.currency || "ج.م");
  }
  function client() { return window.SB && window.SB.client ? window.SB.client : null; }
  function shipType() { var t = $("shipIntlTab"); return t && t.classList.contains("selected") ? "international" : "local"; }

  /* ---- server call: {ok, status, data, unavailable, timeout} ----
     Direct fetch (not supabase-js functions.invoke): avoids waiting on the auth-session lock,
     which can stall ~10s when another tab (e.g. the admin panel) holds it. */
  function bearer() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(k)) continue;
        var v = JSON.parse(localStorage.getItem(k) || "null");
        var tok = v && (v.access_token || (v.currentSession && v.currentSession.access_token));
        var exp = v && (v.expires_at || (v.currentSession && v.currentSession.expires_at));
        if (tok && (!exp || exp * 1000 > Date.now() + 30000)) return tok;
      }
    } catch (e) {}
    return window.SB.anonKey;
  }
  async function call(body, timeoutMs) {
    if (!window.SB || !window.SB.url || !window.SB.anonKey) return { ok: false, unavailable: true, data: {} };
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 25000) : null;
    try {
      var r = await fetch(String(window.SB.url).replace(/\/+$/, "") + "/functions/v1/" + FN, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: window.SB.anonKey, authorization: "Bearer " + bearer() },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined
      });
      var d = {};
      try { d = await r.json(); } catch (e) {}
      if (!r.ok) return { ok: false, status: r.status, data: d || {}, unavailable: r.status === 404 || r.status === 503 };
      return { ok: !!(d && d.ok), status: 200, data: d || {} };
    } catch (e) {
      var timedOut = e && e.name === "AbortError";
      return { ok: false, status: 0, data: {}, timeout: timedOut, unavailable: !timedOut };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ---- payment method tiles ---- */
  function render() {
    var box = document.querySelector("#checkoutModal .pay-methods");
    if (!box || !state.cfg) return;
    var methods = state.cfg.methods || [];
    ["payCodTab", "payVisaTab"].forEach(function (id) { var el = $(id); if (el) el.classList.add("bl-v2-hidden"); });
    var visa = $("visaBox"); if (visa) visa.classList.add("bl-v2-hidden");
    var host = $("blPayV2");
    if (!host) { host = document.createElement("div"); host.id = "blPayV2"; box.parentNode.insertBefore(host, box.nextSibling); }
    if (methods.indexOf(state.method) < 0) state.method = methods[0] || "";
    var chip = state.cfg.mode === "sandbox" && state.cfg.sandbox_access
      ? '<div class="bl-sandbox-chip"><i class="fas fa-flask"></i> وضع تجريبي — المدفوعات لا تُخصم فعليًا</div>' : "";
    if (!methods.length) {
      host.innerHTML = chip + '<div class="bl-pay-note"><i class="fas fa-circle-info"></i> الدفع الإلكتروني لهذا النوع من الشحن غير متاح حاليًا — أكّد طلبك وهنتواصل معاك لترتيب الدفع.</div>';
      return;
    }
    host.innerHTML = chip + '<div class="pay-methods bl-pay-v2" role="radiogroup" aria-label="طريقة الدفع">' + methods.map(function (m) {
      var u = METHOD_UI[m] || ["fa-wallet", m, ""];
      var sel = m === state.method;
      return '<div class="pay-method' + (sel ? " selected" : "") + '" role="radio" tabindex="0" aria-checked="' + sel + '" data-method="' + esc(m) + '">' +
        '<i class="fas ' + u[0] + '"></i><b>' + esc(u[1]) + "</b><small>" + esc(u[2]) + "</small></div>";
    }).join("") + "</div>" + (state.method && state.method !== "cod"
      ? '<p class="form-hint bl-pay-secure"><i class="fas fa-lock"></i> ' +
        (state.method === "instapay" || state.method === "bank"
          ? "بعد تأكيد الطلب هتظهر لك بيانات التحويل ورقم مرجعي للطلب."
          : "هيتم تحويلك لصفحة دفع آمنة — بيانات الكارت لا تمر على موقعنا ولا تُخزَّن عندنا.") + "</p>" : "");
    Array.prototype.forEach.call(host.querySelectorAll("[data-method]"), function (el) {
      function pick() { state.method = el.getAttribute("data-method"); render(); }
      el.addEventListener("click", pick);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
  }

  var inflight = {};
  function loadConfig() {
    if (state.unavailable) return Promise.resolve();
    var ship = shipType();
    if (inflight[ship]) return inflight[ship];
    var phone = ($("co_phone") && $("co_phone").value || "").trim();
    inflight[ship] = call({ action: "config", ship_type: ship, customer: { phone: phone } }, 10000).then(function (r) {
      if (r.unavailable) { state.unavailable = true; return; }
      if (!r.ok) return;
      state.cfg = r.data; state.ship = ship;
      render();
    }).finally(function () { delete inflight[ship]; });
    return inflight[ship];
  }

  /* ---- submit ---- */
  function appliedCoupon() {
    var input = $("couponInput"), msg = $("couponMsg");
    var code = input ? input.value.trim() : "";
    return code && msg && msg.querySelector(".fa-circle-check") ? code : "";
  }
  function setBtn(on, html) {
    var b = $("submitOrderBtn");
    if (!b) return;
    b.disabled = !!on;
    b.innerHTML = html || '<i class="fas fa-check"></i> تأكيد الطلب';
  }
  function showSuccess(d) {
    if (window.BL) BL.saveCart([]);
    if (typeof window.renderCart === "function") window.renderCart();
    if ($("checkoutStep1")) $("checkoutStep1").classList.add("hidden");
    if ($("checkoutStep2")) $("checkoutStep2").classList.remove("hidden");
    if ($("orderNumDisplay")) $("orderNumDisplay").textContent = d.order_number;
    var msg = $("orderSuccessMsg");
    var old = $("blTransferBox"); if (old) old.remove();
    if (d.kind === "transfer") {
      if (msg) msg.textContent = "طلبك اتسجل. حوّل المبلغ واكتب رقم الطلب في ملاحظة التحويل، وهنأكد الدفع ونجهّز طلبك.";
      var rows = [["المبلغ المطلوب", money(d.total)], ["رقم مرجعي (اكتبه في التحويل)", d.reference]];
      if (d.instapay) rows.push(["عنوان إنستاباي", d.instapay]);
      if (d.bank) {
        if (d.bank.bank_name) rows.push(["البنك", d.bank.bank_name]);
        if (d.bank.account_name) rows.push(["اسم الحساب", d.bank.account_name]);
        if (d.bank.account_number) rows.push(["رقم الحساب", d.bank.account_number]);
        if (d.bank.iban) rows.push(["IBAN", d.bank.iban]);
        if (d.bank.swift) rows.push(["SWIFT", d.bank.swift]);
      }
      var box = document.createElement("div");
      box.id = "blTransferBox"; box.className = "bank-box bl-transfer-box";
      box.innerHTML = '<h4><i class="fas fa-' + (d.instapay ? "bolt" : "building-columns") + '"></i> بيانات التحويل</h4>' +
        rows.map(function (r) { return '<div class="bank-row"><span>' + esc(r[0]) + '</span><b dir="ltr">' + esc(r[1]) + "</b></div>"; }).join("");
      if (msg && msg.parentNode) msg.parentNode.insertBefore(box, msg.nextSibling);
    } else if (msg) {
      msg.textContent = "هنتواصل معاك في أقرب وقت لتأكيد الطلب. الإجمالي " + money(d.total) + " — الدفع عند الاستلام.";
    }
    toast("تم استلام طلبك بنجاح ✓", "success");
  }

  async function submitV2() {
    if (state.busy) return;
    if (!state.unavailable && (!state.cfg || state.ship !== shipType())) await loadConfig();
    if (state.unavailable || !state.cfg || state.ship !== shipType() || !(state.cfg.methods || []).length || !state.method) {
      return state.legacySubmit ? state.legacySubmit.apply(this, arguments) : undefined;
    }
    var s = (window.BL && BL.getSettings && BL.getSettings()) || {};
    if (s.storeOpen === false) return toast(s.storeClosedMessage || "الموقع مغلق حالياً للصيانة", "error");
    var cart = window.BL ? BL.getCart() : [];
    if (!cart.length) return toast("سلتك فاضية", "error");
    var ship = shipType();
    var v = function (id) { return $(id) ? String($(id).value || "").trim() : ""; };
    var region = ship === "international" ? v("co_country") : v("co_governorate");
    if (!v("co_name") || !v("co_phone") || !v("co_address") || !region)
      return toast("كمّل البيانات المطلوبة (الاسم، الموبايل، العنوان، " + (ship === "international" ? "الدولة" : "المحافظة") + ")", "error");
    if (ship === "local" && !/^01[0-9]{9}$/.test(v("co_phone").replace(/\s+/g, "")))
      return toast("رقم الموبايل المصري غير صحيح — مثال: 01012345678", "error");

    state.busy = true;
    setBtn(true, '<i class="fas fa-spinner fa-spin"></i> جارٍ تأكيد الطلب...');
    var slow = setTimeout(function () { setBtn(true, '<i class="fas fa-spinner fa-spin"></i> لحظات… جارٍ تأكيد طلبك'); }, 4000);
    var r = await call({
      action: "create", ship_type: ship, payment_method: state.method, coupon_code: appliedCoupon(),
      governorate: ship === "local" ? region : "", country: ship === "international" ? region : "",
      items: cart.map(function (i) { return { product_id: i.product_id || i.id, qty: Number(i.qty) || 1 }; }),
      customer: { name: v("co_name"), phone: v("co_phone"), email: v("co_email"), address: v("co_address"), city: v("co_city"), notes: v("co_notes") }
    }, 30000);
    clearTimeout(slow);
    state.busy = false;

    if (r.timeout) {
      setBtn(false);
      return toast("الاتصال بطيء — لو ظهر لك رقم طلب أو وصلك إيميل فالطلب اتسجل. لو لأ حاول تاني أو كلمنا واتساب", "error");
    }

    if (r.unavailable && (r.status === 404 || r.status === 503 || !r.status)) {
      state.unavailable = true;
      setBtn(false);
      return state.legacySubmit ? state.legacySubmit() : toast("تعذر تأكيد الطلب — حاول تاني", "error");
    }
    if (!r.ok) {
      setBtn(false);
      if (r.status === 409 && window.BL && BL.refresh) BL.refresh();
      var m = (r.data && r.data.message) || "حصل خطأ أثناء تأكيد الطلب — حاول تاني";
      if (r.data && r.data.order_number) m += " (رقم الطلب: " + r.data.order_number + ")";
      return toast(m, "error");
    }
    var d = r.data;
    if (d.kind === "redirect" && d.redirect_url) {
      setBtn(true, '<i class="fas fa-spinner fa-spin"></i> جارٍ فتح بوابة الدفع الآمنة...');
      if (window.BL) BL.saveCart([]);
      window.location.assign(d.redirect_url);
      return;
    }
    setBtn(false);
    showSuccess(d);
  }

  /* ---- install over the current checkout (after site-upgrade-v10 has set its functions) ---- */
  function install() {
    if (!$("checkoutModal") || !window.BL) return false;
    if (typeof window.submitOrder === "function" && !window.submitOrder.__v2) {
      state.legacySubmit = window.submitOrder;
      var w = function () { return submitV2.apply(this, arguments); };
      w.__v2 = true;
      window.submitOrder = w;
    }
    ["openCheckout", "selectShipType"].forEach(function (name) {
      var f = window[name];
      if (typeof f === "function" && !f.__v2) {
        var w = function () { var r = f.apply(this, arguments); setTimeout(loadConfig, 0); return r; };
        w.__v2 = true;
        window[name] = w;
      }
    });
    return true;
  }
  function boot() {
    install(); setTimeout(install, 800); setTimeout(install, 2500);
    /* Warm the server function + cache CORS preflight so the real order is instant. */
    if ($("checkoutModal") && !state.warmed) {
      state.warmed = true;
      setTimeout(function () { if (window.SB && window.SB.url) loadConfig(); }, 2500);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.addEventListener("bl:ready", boot);
  window.BLCheckoutV2 = { state: state, reload: loadConfig };
})();
