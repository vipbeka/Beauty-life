/* Beauty Life — single-source-of-truth finishing layer.
 * - Placeholder slots (.sk / .sk-block) show a neutral skeleton until the DB settings load.
 * - After load, anything the database doesn't provide is hidden (never a fake number).
 * - Cart prices are re-validated against the products table whenever products load/update.
 */
(function () {
  "use strict";
  var finalized = false;

  function $(id) { return document.getElementById(id); }
  function settings() { try { return (window.BL && BL.getSettings && BL.getSettings()) || {}; } catch (e) { return {}; } }
  function hideIfEmpty(el, container) {
    if (!el) return;
    var empty = !String(el.textContent || "").trim();
    var box = container || el;
    box.hidden = empty;
    box.style.display = empty ? "none" : "";
  }

  function apply() {
    var s = settings();
    ["footPhone", "footEmail", "footAddress"].forEach(function (id) {
      var el = $(id);
      if (el) hideIfEmpty(el, el.closest("li"));
    });
    var ann = $("announceText");
    if (ann) hideIfEmpty(ann, ann.closest(".top-announce"));
    var wa = $("waFloat");
    if (wa) { var w = String(s.whatsapp || "").replace(/\D/g, ""); wa.hidden = !w; wa.style.display = w ? "" : "none"; }
    var nav = $("navPhone");
    if (nav) { var ph = String(s.phone || "").trim(); nav.hidden = !ph; nav.style.display = ph ? "" : "none"; }
    var stats = document.querySelector(".hero-stats");
    if (stats) stats.removeAttribute("aria-busy");
    ["heroTitle", "heroSubtitle", "aboutText", "footerAbout", "whyEyebrow", "whyTitle"].forEach(function (id) {
      var el = $(id);
      if (el) hideIfEmpty(el);
    });
  }

  function finalize() {
    if (finalized) return;
    finalized = true;
    document.querySelectorAll(".sk, .sk-block").forEach(function (el) { el.classList.remove("sk", "sk-block"); });
    apply();
  }

  function onCartRepriced() {
    try {
      if (window.BL && BL.getCart && BL.getCart().length && window.toast)
        window.toast("تم تحديث السلة حسب أحدث الأسعار المتاحة", "success");
    } catch (e) {}
  }

  window.addEventListener("bl:settings-updated", function () { if (finalized) apply(); });
  window.addEventListener("bl:ready", function () { setTimeout(finalize, 0); });
  window.addEventListener("bl:products-updated", function () { try { window.BL && BL.getCart && BL.getCart(); } catch (e) {} });
  window.addEventListener("bl:cart-repriced", onCartRepriced);
  if (window.BL && BL.isReady && BL.isReady()) setTimeout(finalize, 0);
  setTimeout(finalize, 12000); // failsafe: never leave skeletons forever
})();
