/* التتبع يطلب رقم الطلب والموبايل معًا. بيانات العملاء مش بتتحمّل للزائر. */
(function () {
  "use strict";

  function client() {
    return window.SB && window.SB.client ? window.SB.client : null;
  }

  function hookTrack() {
    if (typeof window.trackOrder !== "function" || window.trackOrder.__secure)
      return;
    var orig = window.trackOrder;
    var wrapped = async function () {
      var input = document.getElementById("trackInput");
      var phoneEl = document.getElementById("trackPhone");
      var num = input ? input.value.trim() : "";
      var phone = phoneEl ? phoneEl.value.trim() : "";
      if (phoneEl && (!num || phone.replace(/\D/g, "").length < 8)) {
        window.toast &&
          window.toast("اكتب رقم الطلب ورقم الموبايل معًا", "error");
        return;
      }
      if (
        phoneEl &&
        client() &&
        window.BL &&
        typeof window.BL.rememberTrackedOrder === "function"
      ) {
        try {
          var rpc = await client().rpc("track_order", {
            p_order_number: num,
            p_phone: phone,
          });
          if (!rpc.error && rpc.data) window.BL.rememberTrackedOrder(rpc.data);
        } catch (e) {}
      }
      return orig();
    };
    wrapped.__secure = true;
    window.trackOrder = wrapped;
  }

  function hookCoupon() {
    if (typeof window.applyCoupon !== "function" || window.applyCoupon.__secure)
      return;
    var orig = window.applyCoupon;
    var wrapped = async function () {
      var input = document.getElementById("couponInput");
      var code = input ? input.value.trim() : "";
      var subtotal =
        window.BL && window.BL.cartSubtotal ? Number(window.BL.cartSubtotal() || 0) : 0;
      if (code && client() && window.BL) {
        try {
          var rpc = await client().rpc("check_coupon", {
            p_code: code,
            p_subtotal: subtotal,
          });
          if (!rpc.error && rpc.data && window.BL.rememberCouponResult) {
            window.BL.rememberCouponResult(code, rpc.data);
          }
        } catch (e) {}
      }
      return orig();
    };
    wrapped.__secure = true;
    window.applyCoupon = wrapped;
  }

  function boot() {
    hookTrack();
    hookCoupon();
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("bl:ready", boot);
})();
