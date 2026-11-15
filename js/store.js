!(function () {
  "use strict";
  const t = "bl_categories_v3",
    e = "bl_products_v3",
    n = "bl_orders_v3",
    r = "bl_coupons_v3",
    i = "bl_returns_v3",
    s = "bl_consultations_v3",
    a = "bl_testimonials_v3",
    o = "bl_warranty_v3",
    c = "bl_settings_v3",
    u = "bl_admin_creds_v3",
    d = "bl_cart_v3";
  function l() {
    return window.SB && window.SB.ready && window.SB.ready()
      ? window.SB.client
      : null;
  }
  function f() {
    return (window.SB && window.SB.tables) || {};
  }
  function p() {
    return !!l();
  }
  function g(t, e) {
    try {
      const n = localStorage.getItem(t);
      return n ? JSON.parse(n) : e;
    } catch (t) {
      return e;
    }
  }
  function m(t, e) {
    try {
      localStorage.setItem(t, JSON.stringify(e));
    } catch (t) {}
  }
  function _(t, e) {
    try {
      window.dispatchEvent(new CustomEvent(t, { detail: e || null }));
    } catch (t) {}
    try {
      window.SB && window.SB.broadcast && window.SB.broadcast(t, e || null);
    } catch (t) {}
  }
  function w(t) {
    return (
      (t || "id") +
      "_" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  }
  function y() {
    return new Date().toISOString();
  }
  function b(t) {
    return null == t ? "" : String(t).trim().toLowerCase();
  }
  const h = [
    "serviceRoleKey",
    "supabaseServiceRoleKey",
    "paymobApiKey",
    "paymobSecret",
    "paymobHmacSecret",
    "stripeSecretKey",
    "stripeWebhookSecret",
    "webhookSecret",
    "secretKey",
    "secret",
    "apiSecret",
    "password",
    "adminPassword",
    "privateKey",
    "jwtSecret",
    "token",
    "accessToken",
  ];
  function S(t) {
    const e = Object.assign({}, t || {});
    return (
      h.forEach(function (t) {
        t in e && delete e[t];
      }),
      e
    );
  }
  const T = {
    categories: [],
    products: [],
    orders: [],
    coupons: [],
    returns: [],
    consultations: [],
    testimonials: [],
    warranty: [],
    settings: {},
  };
  let E = !1,
    A = null,
    O = null,
    v = null,
    I = !1;
  /* Admin check: server-side first (public.is_admin() RPC, backed by admin_users /
     app_metadata.role). Falls back to the legacy email list ONLY if the RPC is not
     deployed yet, so admin access never breaks during rollout. Real protection = RLS. */
  let adminState = { uid: null, v: !1, t: 0 };
  function lowerTrim(t) {
    return String(t || "").toLowerCase().trim();
  }
  async function checkAdminFor(client, user) {
    if (!client || !user) return !1;
    if (adminState.uid === user.id && Date.now() - adminState.t < 6e4) return adminState.v;
    let v;
    try {
      const r = await client.rpc("is_admin");
      r && !r.error && "boolean" == typeof r.data && (v = r.data);
    } catch (t) {}
    if (void 0 === v) {
      const list = Array.isArray(window.BL_ADMIN_EMAILS) ? window.BL_ADMIN_EMAILS : [];
      v = -1 !== list.map(lowerTrim).indexOf(lowerTrim(user.email));
    }
    adminState = { uid: user.id, v: v, t: Date.now() };
    return v;
  }
  window.BLAdminCheck = checkAdminFor;
  async function isCloudAdmin() {
    try {
      const client = l();
      if (!client || !client.auth) return !1;
      const session = await client.auth.getSession();
      const user = session && session.data && session.data.session && session.data.session.user;
      return user ? await checkAdminFor(client, user) : !1;
    } catch (t) {
      return !1;
    }
  }

  function purgeSensitiveCache() {
    [n, r, i, s, o].forEach(function (t) {
      try {
        localStorage.removeItem(t);
      } catch (t) {}
    });
    (T.orders = []),
      (T.coupons = []),
      (T.returns = []),
      (T.consultations = []),
      (T.warranty = []);
  }
  async function C() {
    const admin = await isCloudAdmin();
    admin || purgeSensitiveCache(),
      /* Never show built-in demo data: only the last real DB copy cached on this device. */
      (T.categories = g(t, [])),
      (T.products = g(e, [])),
      (T.testimonials = g(a, [])),
      (T.settings = g(c, window.DEFAULT_SETTINGS || {})),
      (T.coupons = admin ? g(r, []) : []),
      (T.orders = admin ? g(n, []) : []),
      (T.returns = admin ? g(i, []) : []),
      (T.consultations = admin ? g(s, []) : []),
      (T.warranty = admin ? g(o, []) : []);
    if (l()) {
      cloudBooted = !0;
      (T.categories = []),
        (T.products = []),
        (T.testimonials = []),
        (T.settings = {}),
        (T.coupons = []),
        (T.orders = []),
        (T.returns = []),
        (T.consultations = []),
        (T.warranty = []);
      try {
        await N();
      } catch (t) {
        console.warn(
          "[BL] Cloud bootstrap failed; keeping the loading-safe empty state:",
          t,
        );
      }
    } else {
      /* Offline (SDK blocked/failed): keep the cached real data as-is — no demo seeding,
         nothing written back, so the next online visit is not polluted. */
      console.warn("[BL] Database not reachable yet — showing last cached data only.");
    }
    (function () {
      if (window.SB && window.SB.bc)
        try {
          window.SB.bc.onmessage = function (u) {
            if (u && u.data && u.data.type) {
              try {
                window.dispatchEvent(
                  new CustomEvent(u.data.type, { detail: u.data.detail }),
                );
              } catch (t) {}
              /^bl:.*-updated$/.test(u.data.type) &&
                ((T.categories = g(t, T.categories)),
                (T.products = g(e, T.products)),
                (T.testimonials = g(a, T.testimonials)),
                (T.settings = g(c, T.settings)),
                (T.coupons = g(r, T.coupons)),
                (T.orders = g(n, T.orders)),
                (T.returns = g(i, T.returns)),
                (T.consultations = g(s, T.consultations)),
                (T.warranty = g(o, T.warranty)));
            }
          };
        } catch (t) {}
      window.addEventListener("storage", function (t) {
        if (!t || !t.key) return;
        const e = {
          bl_categories_v3: "categories",
          bl_products_v3: "products",
          bl_orders_v3: "orders",
          bl_coupons_v3: "coupons",
          bl_returns_v3: "returns",
          bl_consultations_v3: "consultations",
          bl_testimonials_v3: "testimonials",
          bl_warranty_v3: "warranty",
          bl_settings_v3: "settings",
        }[t.key];
        if (e && t.newValue)
          try {
            (T[e] = JSON.parse(t.newValue)), _("bl:" + e + "-updated");
          } catch (t) {}
      });
    })(),
      g(u, null) || m(u, window.ADMIN_DEFAULTS || {}),
      (E = !0),
      _("bl:ready"),
      _("bl:categories-updated"),
      _("bl:products-updated"),
      _("bl:settings-updated"),
      _("bl:testimonials-updated"),
      _("bl:coupons-updated");
  }
  async function N() {
    if (A) return A;
    const c = f();
    return (
      (A = (async () => {
        try {
          const admin = await isCloudAdmin();
          await Promise.all([R(c.CATEGORIES, t, "categories"), L()]),
            await Promise.all(
              [
                R(c.PRODUCTS, e, "products"),
                R(c.TESTIMONIALS, a, "testimonials"),
              ].concat(
                admin
                  ? [
                      R(c.COUPONS, r, "coupons"),
                      R(c.ORDERS, n, "orders"),
                      R(c.RETURNS, i, "returns"),
                      R(c.CONSULTATIONS, s, "consultations"),
                      R(c.WARRANTY_CLAIMS, o, "warranty"),
                    ]
                  : [],
              ),
            );
          admin || purgeSensitiveCache();
        } catch (t) {
          console.warn("[BL] Pull sequence error:", t);
        } finally {
          A = null;
        }
      })()),
      A
    );
  }
  async function R(t, e, n) {
    if (t && l())
      try {
        let r = "*";
        "categories" === n &&
          (r = "id, name, description, image_url, sort_order, is_active"),
          "products" === n &&
            (r =
              "id, name, description, price, old_price, category_id, image_url, images, stock, badge, badges, is_new, is_featured, is_active, specs, warranty, sort_order");
        let i = l().from(t).select(r);
        i =
          "categories" === n || "products" === n
            ? i.order("sort_order", { ascending: !0 })
            : i.order("created_at", { ascending: !0 });
        const { data: s, error: a } = await i;
        if (a) throw a;
        Array.isArray(s) && "orders" === n && (s.forEach(M), await k(s)),
          Array.isArray(s) && ((T[n] = s), m(e, s), _("bl:" + n + "-updated"));
      } catch (e) {
        console.warn("[BL] pull table failed", t, ":", e.message || e);
      }
  }
  async function L() {
    const t = f();
    if (t.SETTINGS && l())
      try {
        const { data: e, error: n } = await l().from(t.SETTINGS).select("*");
        if (n) throw n;
        if (e && e.length) {
          const t =
            e.find(function (t) {
              return "store" === t.key;
            }) || e[0];
          t &&
            t.value &&
            ((T.settings = S(
              Object.assign({}, window.DEFAULT_SETTINGS || {}, t.value),
            )),
            m(c, T.settings),
            _("bl:settings-updated"));
        }
      } catch (t) {
        console.warn("[BL] pull settings failed:", t.message || t);
      }
  }
  function D() {
    const c = f();
    if (l()) {
      if (O) {
        try {
          l().removeChannel(O);
        } catch (t) {}
        O = null;
      }
      try {
        O = l()
          .channel("bl-live-v9", { config: { broadcast: { self: !1 } } })
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.ORDERS },
            function (t) {
              x("orders", n, t, !0);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.PRODUCTS },
            function (t) {
              x("products", e, t);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.CATEGORIES },
            function (e) {
              x("categories", t, e);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.TESTIMONIALS },
            function (t) {
              x("testimonials", a, t);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.COUPONS },
            function (t) {
              x("coupons", r, t);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.RETURNS },
            function (t) {
              x("returns", i, t);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.CONSULTATIONS },
            function (t) {
              x("consultations", s, t);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.WARRANTY_CLAIMS },
            function (t) {
              x("warranty", o, t);
            },
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: c.SETTINGS },
            function () {
              L();
            },
          )
          .subscribe(function (t) {
            "SUBSCRIBED" === t
              ? ((I = !0), _("bl:realtime-connected"))
              : ("CHANNEL_ERROR" !== t &&
                  "TIMED_OUT" !== t &&
                  "CLOSED" !== t) ||
                ((I = !1), _("bl:realtime-disconnected"), U());
          });
      } catch (t) {
        console.warn("[BL] realtime unavailable:", t.message || t), U();
      }
    }
  }
  function U() {
    v ||
      (v = setTimeout(function () {
        (v = null),
          !I &&
            l() &&
            N()
              .then(D)
              .catch(function () {});
      }, 3e3));
  }
  function x(t, e, n, r) {
    if (!n) return;
    const i = n.eventType || n.event,
      s = n.new,
      a = n.old,
      o = (T[t] || []).slice(),
      c = (s && s.id) || (a && a.id),
      u = o.findIndex(function (t) {
        return t.id === c;
      });
    "orders" === t &&
      s &&
      (M(s),
      (!s.items || !s.items.length) &&
        u > -1 &&
        Array.isArray(o[u].items) &&
        o[u].items.length &&
        (s.items = o[u].items),
      (s.items && s.items.length) ||
        k([s]).then(function () {
          const n = (T[t] || []).slice(),
            r = n.findIndex(function (t) {
              return t.id === s.id;
            });
          r > -1 &&
            s.items &&
            s.items.length &&
            ((n[r] = Object.assign({}, n[r], { items: s.items })),
            (T[t] = n),
            m(e, n),
            _("bl:" + t + "-updated"));
        })),
      "INSERT" === i
        ? (-1 === u && s && o.push(s), r && s && _("bl:new-order", s))
        : "UPDATE" === i
          ? u > -1 && s
            ? (o[u] = s)
            : s && o.push(s)
          : "DELETE" === i && u > -1 && o.splice(u, 1),
      (T[t] = o),
      m(e, o),
      _("bl:" + t + "-updated");
  }
  function B(t) {
    const e = String((t && (t.message || t.code)) || t || "");
    let n = e.match(/Could not find the '([^']+)' column/i);
    return n && n[1]
      ? n[1]
      : ((n = e.match(/column[\s"]+'?([a-zA-Z0-9_]+)'?[\s"]+of relation/i)),
        n && n[1]
          ? n[1]
          : ((n = e.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i)),
            n && n[1] ? n[1] : ""));
  }
  function j(t, e) {
    const n = Object.assign({}, e || {});
    return (
      "orders" === t &&
        ((null != n.shipping_type && "" !== n.shipping_type) ||
          null == n.ship_type ||
          "" === n.ship_type ||
          (n.shipping_type = n.ship_type),
        delete n.ship_type,
        n.address && !n.customer_address && (n.customer_address = n.address),
        n.customer_address && !n.address && (n.address = n.customer_address),
        null != n.shipping_fee &&
          null == n.shipping_cost &&
          (n.shipping_cost = n.shipping_fee),
        null != n.shipping_cost &&
          null == n.shipping_fee &&
          (n.shipping_fee = n.shipping_cost)),
      "products" === t &&
        null != n.category_id &&
        (n.category_id = String(n.category_id)),
      n
    );
  }
  async function P(t, e) {
    if (!p()) return Object.assign({ local: !0 }, e);
    if (!t) throw new Error("اسم الجدول مفقود");
    let n = j(t, e),
      r = 0,
      i = null;
    for (; r < 12; ) {
      const { data: e, error: s } = await l()
        .from(t)
        .upsert(n, { onConflict: "id" })
        .select()
        .single();
      if (!s) return e || n;
      i = s;
      const a = B(s);
      if (!a || !Object.prototype.hasOwnProperty.call(n, a)) break;
      delete n[a], (r += 1);
    }
    throw new Error(
      "فشل الحفظ السحابي: " + ((i && (i.message || i.code)) || "خطأ غير معروف"),
    );
  }
  async function F(t, e) {
    if (!p()) return Object.assign({ local: !0 }, e);
    if (!t) throw new Error("اسم الجدول مفقود");
    let n = j(t, e),
      r = 0,
      i = null;
    for (; r < 12; ) {
      const admin = await isCloudAdmin(),
        query = l().from(t).insert(n),
        { data: e, error: s } = admin
          ? await query.select().single()
          : await query;
      if (!s) return e || n;
      i = s;
      const a = B(s);
      if (!a || !Object.prototype.hasOwnProperty.call(n, a)) break;
      delete n[a], (r += 1);
    }
    throw new Error(
      "فشل الحفظ السحابي: " + ((i && (i.message || i.code)) || "خطأ غير معروف"),
    );
  }
  function M(t) {
    if (!t || "object" != typeof t) return t;
    if (
      (!t.address && t.customer_address && (t.address = t.customer_address),
      null == t.shipping_fee &&
        null != t.shipping_cost &&
        (t.shipping_fee = t.shipping_cost),
      "string" == typeof t.items)
    )
      try {
        t.items = JSON.parse(t.items);
      } catch (e) {
        t.items = [];
      }
    return Array.isArray(t.items) || (t.items = []), t;
  }
  async function k(t) {
    if (!p() || !Array.isArray(t) || !t.length) return t;
    const e = t.filter(function (t) {
      return !Array.isArray(t.items) || !t.items.length;
    });
    if (!e.length) return t;
    try {
      const n = e.map(function (t) {
          return t.id;
        }),
        { data: r, error: i } = await l()
          .from("order_items")
          .select("*")
          .in("order_id", n);
      if (i || !Array.isArray(r)) return t;
      const s = {};
      r.forEach(function (t) {
        (s[t.order_id] = s[t.order_id] || []).push(t);
      }),
        e.forEach(function (t) {
          const e = s[t.id];
          e &&
            e.length &&
            (t.items = (function (t) {
              return (t || []).map(function (t) {
                let e = {};
                return (
                  t.meta && "object" == typeof t.meta && (e = t.meta),
                  Object.assign(
                    {
                      id: t.product_id || "oi_" + t.id,
                      product_id: t.product_id || "",
                      name: t.product_name || "",
                      price: Number(t.price || 0),
                      qty: Number(t.quantity || 1),
                      image_url: "",
                      warranty: "",
                      warranty_days: null,
                      badges: [],
                      free_shipping: !1,
                    },
                    e,
                  )
                );
              });
            })(e));
        });
    } catch (t) {
      console.warn("[BL] hydrate items failed:", t.message || t);
    }
    return t;
  }
  async function G(t, e) {
    if (!p()) return { local: !0 };
    if (!t) throw new Error("اسم الجدول مفقود");
    const { error: n } = await l().from(t).delete().eq("id", e);
    if (n)
      throw new Error(
        "فشل الحذف السحابي: " + (n.message || n.code || "خطأ غير معروف"),
      );
    return !0;
  }
  function q() {
    return S(
      Object.assign({}, window.DEFAULT_SETTINGS || {}, T.settings || {}),
    );
  }
  async function W(t) {
    const e = S(Object.assign({}, q(), t || {}));
    (T.settings = e), m(c, T.settings), _("bl:settings-updated");
    const n = f();
    if (p() && n.SETTINGS) {
      const { error: t } = await l()
        .from(n.SETTINGS)
        .upsert(
          { key: "store", value: e, updated_at: y() },
          { onConflict: "key" },
        );
      if (t) throw new Error("فشل حفظ الإعدادات: " + (t.message || t.code));
    }
    return T.settings;
  }
  async function K(e) {
    e.id || (e.id = w("cat")), (e.created_at = e.created_at || y());
    const n = T.categories.findIndex(function (t) {
      return t.id === e.id;
    });
    n > -1 ? (T.categories[n] = e) : T.categories.push(e),
      m(t, T.categories),
      _("bl:categories-updated");
    const r = await P(f().CATEGORIES, e),
      i = r && !r.local ? r : e,
      s = T.categories.findIndex(function (t) {
        return t.id === i.id;
      });
    return (
      s > -1 ? (T.categories[s] = i) : T.categories.push(i),
      m(t, T.categories),
      _("bl:categories-updated"),
      i
    );
  }
  function Y(t) {
    if (!Array.isArray(t)) return [];
    const e = Date.now();
    return t.filter(function (t) {
      if (!t || !t.expires_at) return !0;
      const n = new Date(t.expires_at).getTime();
      return isNaN(n) || n > e;
    });
  }
  function H(t) {
    return t
      ? Array.isArray(t.badges) && t.badges.length
        ? Y(t.badges).map(function (t) {
            return Object.assign(
              { label: "", color: "#10b981", icon: "fa-tag", behavior: z(t) },
              t || {},
            );
          })
        : t.badge && "string" == typeof t.badge && t.badge.trim()
          ? [
              {
                label: t.badge,
                color: "#10b981",
                icon: "fa-tag",
                expires_at: null,
                behavior: J(t.badge),
              },
            ]
          : []
      : [];
  }
  function J(t) {
    var e = String(t || "")
      .trim()
      .toLowerCase();
    return e
      ? /free\s*shipping|شحن\s*مجاني/.test(e)
        ? "free_shipping"
        : /new|جديد|وصل\s*حديث/.test(e)
          ? "new_arrival"
          : /best\s*seller|الأكثر\s*مبيع|رائج/.test(e)
            ? "best_seller"
            : /featured|مميز/.test(e)
              ? "featured"
              : /pre.?order|بالحجز/.test(e)
                ? "preorder"
                : /offer|discount|خصم|sale/.test(e)
                  ? "discount"
                  : /warranty|ضمان/.test(e)
                    ? "warranty"
                    : /limited|محدود/.test(e)
                      ? "limited"
                      : "generic"
      : "generic";
  }
  function z(t) {
    return (
      (t = t || {}).behavior ||
      t.type ||
      t.slug ||
      t.kind ||
      J((t.label || "") + " " + (t.icon || ""))
    );
  }
  function V(t, e) {
    return H(t).some(function (t) {
      return z(t) === e;
    });
  }
  function Z(t) {
    return (
      (T.products || []).find(function (e) {
        return e.id === t;
      }) || null
    );
  }
  async function $(t) {
    t.id || (t.id = w("p")),
      Array.isArray(t.badges) || (t.badges = []),
      (t.badges = Y(t.badges)),
      t.badge &&
        !t.badges.some(function (e) {
          return e.label === t.badge;
        }) &&
        t.badges.unshift({
          label: t.badge,
          color: "#10b981",
          icon: "fa-tag",
          expires_at: null,
        }),
      (t.created_at = t.created_at || y()),
      (t.updated_at = y());
    const n = T.products.findIndex(function (e) {
      return e.id === t.id;
    });
    n > -1 ? (T.products[n] = t) : T.products.push(t),
      m(e, T.products),
      _("bl:products-updated");
    const r = await P(f().PRODUCTS, t),
      i = r && !r.local ? r : t,
      s = T.products.findIndex(function (t) {
        return t.id === i.id;
      });
    return (
      s > -1 ? (T.products[s] = i) : T.products.push(i),
      m(e, T.products),
      _("bl:products-updated"),
      i
    );
  }
  function Q() {
    return (T.orders || []).map(M).sort(function (t, e) {
      return new Date(e.created_at || 0) - new Date(t.created_at || 0);
    });
  }
  function X() {
    const t = (T.orders || []).length + 1;
    return "BL-" + String(t).padStart(5, "0");
  }
  async function tt(t) {
    t.id || (t.id = w("cp")), (t.created_at = t.created_at || y());
    const e = T.coupons.findIndex(function (e) {
      return e.id === t.id;
    });
    e > -1 ? (T.coupons[e] = t) : T.coupons.push(t),
      m(r, T.coupons),
      _("bl:coupons-updated");
    const n = await P(f().COUPONS, t),
      i = n && !n.local ? n : t,
      s = T.coupons.findIndex(function (t) {
        return t.id === i.id;
      });
    return (
      s > -1 ? (T.coupons[s] = i) : T.coupons.push(i),
      m(r, T.coupons),
      _("bl:coupons-updated"),
      i
    );
  }
  function et() {
    return (T.returns || []).slice().sort(function (t, e) {
      return new Date(e.created_at || 0) - new Date(t.created_at || 0);
    });
  }
  async function nt(t, e) {
    return (
      (e = e || {}),
      p() && f().RETURNS && (await G(f().RETURNS, t)),
      (T.returns = T.returns.filter(function (e) {
        return e.id !== t;
      })),
      m(i, T.returns),
      e.silent,
      _("bl:returns-updated"),
      !0
    );
  }
  function rt(t) {
    return (
      {
        pending: "قيد المراجعة",
        approved: "تمت الموافقة",
        rejected: "مرفوض",
        received: "تم استلام الشحنة",
        refunded: "تم رد المبلغ",
        completed: "منتهي",
      }[t] ||
      t ||
      "—"
    );
  }
  function it(t) {
    return (
      {
        new: "جديد",
        contacted: "تم التواصل",
        discussing: "قيد النقاش",
        qualified: "عميل مؤهل",
        won: "تم البيع",
        lost: "مغلق / غير مناسب",
        queued: "في الانتظار",
      }[t] ||
      t ||
      "—"
    );
  }
  function st() {
    return (T.warranty || []).slice().sort(function (t, e) {
      return new Date(e.created_at || 0) - new Date(t.created_at || 0);
    });
  }
  async function at(t, e) {
    return (
      (e = e || {}),
      p() && (await G(f().WARRANTY_CLAIMS || "warranty_claims", t)),
      (T.warranty = T.warranty.filter(function (e) {
        return e.id !== t;
      })),
      m(o, T.warranty),
      _("bl:warranty-updated"),
      !0
    );
  }
  function ot(t) {
    return (
      {
        pending: "قيد المراجعة",
        approved: "موافقة",
        rejected: "مرفوض",
        in_repair: "قيد الإصلاح",
        replaced: "تم الاستبدال",
        completed: "منتهي",
        expired: "انتهت الضمان",
      }[t] ||
      t ||
      "—"
    );
  }
  async function ct(t) {
    if (!t.order_number) throw new Error("رقم الطلب مطلوب لإضافة رأي");
    const e = t.review_type;
    if ("site" !== e && "product" !== e)
      throw new Error("يجب اختيار نوع الرأي: رأي عن الموقع أو رأي عن المنتج");
    if ("product" === e && !t.product_id)
      throw new Error('عند اختيار "رأي عن المنتج" يجب تحديد رقم المنتج');
    const n = b(t.order_number),
      r = String(t.product_id || "").trim();
    if (
      (T.testimonials || []).find(function (i) {
        if (!i || i.id === t.id) return !1;
        const s = b(i.order_number),
          a = i.review_type || "",
          o = String(i.product_id || "").trim();
        return s === n && a === e && ("site" === e || (!!r && o === r));
      })
    )
      throw new Error(
        "site" === e
          ? "تم إرسال رأي عن الموقع مسبقاً لهذا الطلب"
          : "تم تقييم هذا المنتج مسبقاً في نفس الطلب",
      );
    (t.order_number = n),
      t.id || (t.id = w("t")),
      (t.created_at = t.created_at || y());
    const i = T.testimonials.findIndex(function (e) {
      return e.id === t.id;
    });
    i > -1 ? (T.testimonials[i] = t) : T.testimonials.push(t),
      m(a, T.testimonials),
      _("bl:testimonials-updated");
    const s = await P(f().TESTIMONIALS, t),
      o = s && !s.local ? Object.assign({}, t, s) : t,
      c = T.testimonials.findIndex(function (t) {
        return t.id === o.id;
      });
    return (
      c > -1 ? (T.testimonials[c] = o) : T.testimonials.push(o),
      m(a, T.testimonials),
      _("bl:testimonials-updated"),
      o
    );
  }
  async function ut(t, e) {
    (e = e || {}),
      p() && f().TESTIMONIALS && (await G(f().TESTIMONIALS, t)),
      (T.testimonials = T.testimonials.filter(function (e) {
        return e.id !== t;
      })),
      m(a, T.testimonials),
      _("bl:testimonials-updated");
  }
  /* Cart = product ids + qty. Price/name/image are always re-read from the
     products table (single source of truth); stale localStorage snapshots are corrected. */
  let cartRepriceNotified = !1;
  function dt() {
    const c = g(d, []);
    if (!Array.isArray(c)) return [];
    if (!(T.products || []).length) return c;
    let changed = !1;
    const out = [];
    c.forEach(function (it) {
      if (!it) return void (changed = !0);
      const p = Z(String(it.product_id || it.id || ""));
      if (!p || !1 === p.is_active) return void (changed = !0);
      const qty = Math.max(1, Math.floor(Number(it.qty) || 1)),
        price = Number(p.price) || 0;
      if (
        Number(it.price) !== price ||
        it.name !== p.name ||
        (it.image_url || "") !== (p.image_url || "") ||
        it.qty !== qty
      ) {
        changed = !0;
        it = Object.assign({}, it, {
          price: price,
          name: p.name,
          image_url: p.image_url || "",
          qty: qty,
        });
      }
      out.push(it);
    });
    if (changed) {
      m(d, out);
      cartRepriceNotified ||
        ((cartRepriceNotified = !0),
        setTimeout(function () {
          cartRepriceNotified = !1;
          _("bl:cart-repriced");
          _("bl:cart-updated");
        }, 0));
    }
    return out;
  }
  function quoteShipping(o) {
    o = o || {};
    const st = q(),
      sub = Math.max(
        0,
        dt().reduce(function (t, e) {
          return t + (e.price || 0) * (e.qty || 1);
        }, 0) - Number(o.discount || 0),
      );
    if ("international" === o.shipType) {
      const pct = !1 !== st.internationalShippingPercentEnabled,
        rate = Number(st.internationalShippingTaxPercent || 0);
      return pct && rate > 0
        ? Math.round((sub * rate) / 100)
        : Number(st.internationalShippingFee || 0);
    }
    if (
      dt().some(function (e) {
        return V(Z(String((e && (e.product_id || e.id || "")) || "")), "free_shipping");
      })
    )
      return 0;
    if (Number(st.freeShippingAbove || 0) > 0 && sub >= Number(st.freeShippingAbove))
      return 0;
    if ("custom" === (st.localShippingMode || "default")) {
      const map =
          st.localShippingByGovernorate && "object" == typeof st.localShippingByGovernorate
            ? st.localShippingByGovernorate
            : {},
        gov = o.governorate || "";
      if (gov && null != map[gov] && "" !== map[gov]) return Number(map[gov] || 0);
    }
    return Number(st.localShippingFee || 0);
  }
  let cloudBooted = !1;
  function lt() {
    /* Wait for supabase-init (sb:ready) so we never boot in offline/demo mode just because the
       SDK script was still loading (slow networks, in-app Android browsers). */
    let started = !1;
    const go = function () {
      if (started) return;
      started = !0;
      C().catch(function (t) {
        console.error("[BL] bootstrap error:", t);
      });
    };
    window.SB ? go() : (window.addEventListener("sb:ready", go, { once: !0 }), setTimeout(go, 1e4));
    /* If the database connection arrives after an offline start, load the real data then. */
    window.addEventListener("sb:ready", function () {
      started && !cloudBooted && l() && ((cloudBooted = !0), N().catch(function () {}));
    });
  }
  (window.BL = {
    uid: w,
    isReady: function () {
      return E;
    },
    isCloud: p,
    isRealtimeConnected: function () {
      return I;
    },
    refresh: N,
    seedIfEmpty: async function () {
      if (p())
        try {
          if (
            0 === (T.categories || []).length &&
            (window.DEFAULT_CATEGORIES || []).length
          )
            for (const t of window.DEFAULT_CATEGORIES)
              try {
                await P(f().CATEGORIES, Object.assign({ created_at: y() }, t));
              } catch (t) {}
          if (
            0 === (T.products || []).length &&
            (window.DEFAULT_PRODUCTS || []).length
          )
            for (const t of window.DEFAULT_PRODUCTS)
              try {
                await P(f().PRODUCTS, Object.assign({ created_at: y() }, t));
              } catch (t) {}
          if (
            0 === (T.testimonials || []).length &&
            (window.DEFAULT_TESTIMONIALS || []).length
          )
            for (const t of window.DEFAULT_TESTIMONIALS)
              try {
                await P(
                  f().TESTIMONIALS,
                  Object.assign({ created_at: y() }, t),
                );
              } catch (t) {}
          await N();
        } catch (t) {
          console.warn("[BL] seed error:", t);
        }
    },
    pruneExpiredBadges: Y,
    getActiveBadges: H,
    badgeBehaviorFromText: J,
    badgeBehaviorFromMeta: z,
    productHasBadgeBehavior: V,
    cartHasBadgeBehavior: function (t) {
      return dt().some(function (e) {
        return V(Z(String((e && (e.product_id || e.id || "")) || "")), t);
      });
    },
    canonOrderNumber: b,
    getSettings: q,
    saveSettings: W,
    getCategories: function (t) {
      const e = (T.categories || []).slice().sort(function (t, e) {
        return (t.sort_order || 0) - (e.sort_order || 0);
      });
      return t
        ? e.filter(function (t) {
            return !1 !== t.is_active;
          })
        : e;
    },
    saveCategory: K,
    deleteCategory: async function (e) {
      p() && f().CATEGORIES && (await G(f().CATEGORIES, e)),
        (T.categories = T.categories.filter(function (t) {
          return t.id !== e;
        })),
        m(t, T.categories),
        _("bl:categories-updated");
    },
    getProducts: function (t) {
      const e = (T.products || []).slice().sort(function (t, e) {
        return (t.sort_order || 0) - (e.sort_order || 0);
      });
      return (
        e.forEach(function (t) {
          Array.isArray(t.badges) && (t.badges = Y(t.badges));
        }),
        t
          ? e.filter(function (t) {
              return !1 !== t.is_active;
            })
          : e
      );
    },
    getProduct: Z,
    saveProduct: $,
    deleteProduct: async function (t) {
      p() && f().PRODUCTS && (await G(f().PRODUCTS, t)),
        (T.products = T.products.filter(function (e) {
          return e.id !== t;
        })),
        m(e, T.products),
        _("bl:products-updated");
    },
    uploadImage: async function (t, e) {
      if (p() && window.SB.uploadImage)
        try {
          const n = await window.SB.uploadImage(t, e || "products");
          return n && n.url ? n.url : n;
        } catch (t) {
          console.warn(
            "[BL] storage upload failed, falling back to local data URL:",
            t && (t.message || t),
          );
        }
      return await new Promise(function (e, n) {
        const r = new FileReader();
        (r.onload = function () {
          e(r.result);
        }),
          (r.onerror = function () {
            n(new Error("فشل قراءة الملف"));
          }),
          r.readAsDataURL(t);
      });
    },
    getOrders: Q,
    createOrder: async function (t) {
      (t.id = t.id || w("o")),
        (t.order_number = t.order_number || X()),
        (t.status = t.status || "pending"),
        (t.payment_status =
          t.payment_status ||
          ("visa" === t.payment_method ? "pending" : "unpaid")),
        (t.payment_provider =
          t.payment_provider ||
          ("visa" === t.payment_method ? "gateway" : "cod")),
        (t.created_at = t.created_at || y()),
        (t.updated_at = t.created_at),
        T.orders.unshift(t),
        m(n, T.orders),
        _("bl:orders-updated"),
        _("bl:new-order", t);
      const e = f();
      if (p() && e.ORDERS)
        try {
          const r = Array.isArray(t.items) ? t.items.slice() : [],
            i = await F(e.ORDERS, t);
          try {
            await (async function (t) {
              if (!(p() && t && Array.isArray(t.items) && t.items.length))
                return;
              let e = t.items.map(function (e) {
                return {
                  order_id: t.id,
                  product_id: e.product_id || e.id || null,
                  product_name: e.name || "",
                  price: Number(e.price || 0),
                  quantity: Number(e.qty || 1),
                  total: Number(e.price || 0) * Number(e.qty || 1),
                  meta: {
                    image_url: e.image_url || "",
                    warranty: e.warranty || "",
                    warranty_days: Number(e.warranty_days || 0) || null,
                    badges: Array.isArray(e.badges) ? e.badges : [],
                    free_shipping: !!e.free_shipping,
                  },
                };
              });
              for (let t = 0; t < 6; t += 1) {
                const { error: t } = await l().from("order_items").insert(e);
                if (!t) return;
                const n = B(t);
                if (
                  !(
                    n &&
                    e.length &&
                    Object.prototype.hasOwnProperty.call(e[0], n)
                  )
                )
                  return void console.warn(
                    "[BL] order_items insert failed:",
                    t.message || t,
                  );
                e = e.map(function (t) {
                  const e = Object.assign({}, t);
                  return delete e[n], e;
                });
              }
            })({ id: (i && i.id) || t.id, items: r });
          } catch (t) {
            console.warn("[BL] saveOrderItems:", t);
          }
          if (i && !i.local) {
            (Array.isArray(i.items) && i.items.length) || (i.items = r),
              !i.address && t.address && (i.address = t.address),
              null == i.shipping_fee &&
                null != t.shipping_fee &&
                (i.shipping_fee = t.shipping_fee),
              !i.governorate &&
                t.governorate &&
                (i.governorate = t.governorate),
              !i.country && t.country && (i.country = t.country);
            const e = T.orders.findIndex(function (e) {
              return e.id === t.id;
            });
            e > -1 && (T.orders[e] = i),
              m(n, T.orders),
              _("bl:orders-updated"),
              (t = i);
          }
        } catch (e) {
          throw (
            ((T.orders = T.orders.filter(function (e) {
              return e.id !== t.id;
            })),
            m(n, T.orders),
            _("bl:orders-updated"),
            new Error(
              "فشل حفظ الطلب: " +
                ((e && (e.message || e.code)) || "خطأ غير معروف"),
            ))
          );
        }
      return t;
    },
    updateOrder: async function (t, e) {
      const r = T.orders.findIndex(function (e) {
        return e.id === t;
      });
      if (-1 === r) return null;
      const i = Object.assign({}, T.orders[r], e || {}, { updated_at: y() });
      return (
        (T.orders[r] = i),
        m(n, T.orders),
        _("bl:orders-updated"),
        await P(f().ORDERS, i),
        i
      );
    },
    deleteOrder: async function (t) {
      var e =
        T.orders.find(function (e) {
          return e.id === t;
        }) || null;
      await (async function (t) {
        if (t) {
          for (
            var e = String(t.id || ""),
              n = b(t.order_number),
              r = (T.returns || []).filter(function (t) {
                return (
                  String(t.order_id || "") === e || b(t.order_number) === n
                );
              }),
              i = 0;
            i < r.length;
            i += 1
          )
            await nt(r[i].id, { silent: !0 });
          for (
            var s = (T.warranty || []).filter(function (t) {
                return (
                  String(t.order_id || "") === e || b(t.order_number) === n
                );
              }),
              a = 0;
            a < s.length;
            a += 1
          )
            await at(s[a].id, { silent: !0 });
          for (
            var o = (T.testimonials || []).filter(function (t) {
                return b(t.order_number) === n;
              }),
              c = 0;
            c < o.length;
            c += 1
          )
            await ut(o[c].id, { silent: !0 });
        }
      })(e),
        p() && f().ORDERS && (await G(f().ORDERS, t)),
        (T.orders = T.orders.filter(function (e) {
          return e.id !== t;
        })),
        m(n, T.orders),
        _("bl:orders-updated");
    },
    rememberCouponResult: function (code, result) {
      if (!result || !result.ok) return result || null;
      const row = {
        id: "rpc_" + String(code || "").toLowerCase(),
        code: result.code || code,
        discount_type: result.discount_type || "fixed",
        discount_value: Number(result.discount_value || 0),
        is_active: !0,
        __rpcDiscount: Number(result.discount || 0),
        __rpcSubtotal: Number(result.subtotal || 0),
      };
      const idx = (T.coupons || []).findIndex(function (t) {
        return String(t.code || "").toLowerCase() === String(row.code).toLowerCase();
      });
      return (
        idx > -1 ? (T.coupons[idx] = row) : T.coupons.push(row),
        result
      );
    },
    rememberTrackedOrder: function (t) {
      if (!t || !t.order_number) return null;
      const e = String(t.order_number).toLowerCase(),
        r = (T.orders || []).findIndex(function (t) {
          return String(t.order_number || "").toLowerCase() === e;
        });
      return (
        r > -1
          ? (T.orders[r] = Object.assign({}, T.orders[r], t))
          : T.orders.unshift(t),
        _("bl:orders-updated"),
        t
      );
    },
    findOrder: function (t) {
      return (t = (t || "").trim())
        ? Q().filter(function (e) {
            return (
              (e.order_number || "").toLowerCase() === t.toLowerCase() ||
              (e.customer_phone || "").replace(/\s+/g, "") ===
                t.replace(/\s+/g, "")
            );
          })
        : [];
    },
    nextOrderNumber: X,
    getCoupons: function () {
      return (T.coupons || []).slice();
    },
    validateCoupon: function (t, e) {
      const n = (T.coupons || []).find(function (e) {
        return (
          (e.code || "").toLowerCase() === (t || "").toLowerCase() &&
          !1 !== e.is_active
        );
      });
      if (!n) return { ok: !1, msg: "كود الخصم غير صحيح" };
      if (n.__rpcDiscount != null)
        return {
          ok: !0,
          coupon: n,
          discount: Math.min(Number(n.__rpcDiscount) || 0, e),
        };
      if (n.expires_at && new Date(n.expires_at) < new Date())
        return { ok: !1, msg: "كود الخصم منتهي الصلاحية" };
      if (n.max_uses && n.used_count >= n.max_uses)
        return { ok: !1, msg: "تم استنفاد عدد استخدامات الكود" };
      if (n.min_order && e < n.min_order)
        return { ok: !1, msg: "الحد الأدنى للطلب " + n.min_order };
      const r =
        "fixed" === n.discount_type
          ? Number(n.discount_value)
          : (e * Number(n.discount_value)) / 100;
      return { ok: !0, coupon: n, discount: Math.min(r, e) };
    },
    saveCoupon: tt,
    deleteCoupon: async function (t) {
      p() && f().COUPONS && (await G(f().COUPONS, t)),
        (T.coupons = T.coupons.filter(function (e) {
          return e.id !== t;
        })),
        m(r, T.coupons),
        _("bl:coupons-updated");
    },
    incrementCouponUse: async function (t) {
      const e = T.coupons.find(function (e) {
        return (e.code || "").toLowerCase() === (t || "").toLowerCase();
      });
      e && ((e.used_count = (e.used_count || 0) + 1), await tt(e));
    },
    getReturns: et,
    createReturn: async function (t) {
      if (((t.order_number = b(t.order_number)), !t.order_number))
        throw new Error("رقم الطلب مطلوب");
      if (
        et().find(function (e) {
          return b(e.order_number) === t.order_number;
        })
      )
        throw new Error("تم تقديم طلب استرجاع مسبقاً لهذا الطلب");
      (t.id = t.id || w("rt")),
        (t.status = t.status || "pending"),
        (t.return_type = t.return_type || "refund"),
        (Array.isArray(t.images) && t.images.length) ||
          !t.proof_image_url ||
          (t.images = [t.proof_image_url]),
        (t.created_at = y()),
        (t.updated_at = t.created_at),
        (t.timeline = t.timeline || [
          {
            at: t.created_at,
            event: "تم استلام طلب الاسترجاع",
            by: "customer",
          },
        ]),
        T.returns.unshift(t),
        m(i, T.returns),
        _("bl:returns-updated");
      const e = f();
      if (p() && e.RETURNS)
        try {
          const n = await F(e.RETURNS, t);
          if (n && !n.local) {
            const e = T.returns.findIndex(function (e) {
              return e.id === t.id;
            });
            e > -1 && (T.returns[e] = n),
              m(i, T.returns),
              _("bl:returns-updated"),
              (t = n);
          }
        } catch (e) {
          if (
            ((T.returns = T.returns.filter(function (e) {
              return e.id !== t.id;
            })),
            m(i, T.returns),
            _("bl:returns-updated"),
            /duplicate key|unique|23505/i.test(
              String((e && (e.message || e.code)) || ""),
            ))
          )
            throw new Error("تم تقديم طلب استرجاع مسبقاً لهذا الطلب");
          throw new Error(
            "فشل إرسال طلب الاسترجاع: " +
              ((e && (e.message || e.code)) || "خطأ غير معروف"),
          );
        }
      return t;
    },
    updateReturn: async function (t, e) {
      const n = T.returns.findIndex(function (e) {
        return e.id === t;
      });
      if (-1 === n) return null;
      ((e = e || {}).timeline = e.timeline || T.returns[n].timeline || []),
        e.status &&
          e.status !== T.returns[n].status &&
          ((e.timeline = e.timeline.concat([
            {
              at: y(),
              event: "تغيير الحالة إلى: " + rt(e.status),
              by: "admin",
            },
          ])),
          ("approved" !== e.status &&
            "rejected" !== e.status &&
            "completed" !== e.status) ||
            (e.decision_at = y()));
      const r = Object.assign({}, T.returns[n], e, { updated_at: y() });
      return (
        (T.returns[n] = r),
        m(i, T.returns),
        _("bl:returns-updated"),
        await P(f().RETURNS, r),
        r
      );
    },
    deleteReturn: nt,
    labelReturnStatus: rt,
    getConsultations: function () {
      return (T.consultations || []).slice().sort(function (t, e) {
        return new Date(e.created_at || 0) - new Date(t.created_at || 0);
      });
    },
    createConsultation: async function (t) {
      if (!t.name || !t.phone) throw new Error("الاسم والموبايل مطلوبان");
      (t.id = t.id || w("cs")),
        (t.status = "new"),
        (t.urgency = t.urgency || "normal"),
        (t.created_at = y()),
        (t.updated_at = t.updated_at || t.created_at),
        (t.timeline = t.timeline || [
          { at: t.created_at, event: "تم إرسال طلب الاستشارة", by: "customer" },
        ]),
        T.consultations.unshift(t),
        m(s, T.consultations),
        _("bl:consultations-updated");
      const e = f();
      if (p() && e.CONSULTATIONS)
        try {
          const n = await F(e.CONSULTATIONS, t);
          if (n && !n.local) {
            const e = T.consultations.findIndex(function (e) {
              return e.id === t.id;
            });
            e > -1 && (T.consultations[e] = n),
              m(s, T.consultations),
              _("bl:consultations-updated"),
              (t = n);
          }
        } catch (e) {
          throw (
            ((T.consultations = T.consultations.filter(function (e) {
              return e.id !== t.id;
            })),
            m(s, T.consultations),
            _("bl:consultations-updated"),
            new Error(
              "فشل إرسال طلب الاستشارة: " +
                ((e && (e.message || e.code)) || "خطأ غير معروف"),
            ))
          );
        }
      return t;
    },
    updateConsultation: async function (t, e) {
      const n = T.consultations.findIndex(function (e) {
        return e.id === t;
      });
      if (-1 === n) return null;
      ((e = e || {}).timeline =
        e.timeline || T.consultations[n].timeline || []),
        Object.prototype.hasOwnProperty.call(e, "admin_reply") &&
          e.admin_reply !== T.consultations[n].admin_reply &&
          ((e.admin_reply_at = e.admin_reply ? y() : null),
          e.admin_reply &&
            (e.timeline = e.timeline.concat([
              { at: y(), event: "رد الفريق على الاستشارة", by: "admin" },
            ]))),
        e.status &&
          e.status !== T.consultations[n].status &&
          ((e.timeline = e.timeline.concat([
            { at: y(), event: "تغيير الحالة: " + it(e.status), by: "admin" },
          ])),
          ["won", "closed", "qualified", "lost"].indexOf(e.status) > -1 &&
            (e.decision_at = y()));
      const r = Object.assign({}, T.consultations[n], e, { updated_at: y() });
      return (
        (T.consultations[n] = r),
        m(s, T.consultations),
        _("bl:consultations-updated"),
        await P(f().CONSULTATIONS, r),
        r
      );
    },
    deleteConsultation: async function (t) {
      return (
        p() && f().CONSULTATIONS && (await G(f().CONSULTATIONS, t)),
        (T.consultations = T.consultations.filter(function (e) {
          return e.id !== t;
        })),
        m(s, T.consultations),
        _("bl:consultations-updated"),
        !0
      );
    },
    labelConsultStatus: it,
    getWarrantyClaims: st,
    createWarrantyClaim: async function (t) {
      if (
        ((t.order_number = b(t.order_number)), !t.order_number || !t.product_id)
      )
        throw new Error("رقم الطلب ومعرّف المنتج مطلوبان");
      if (
        st().find(function (e) {
          return (
            b(e.order_number) === t.order_number &&
            String(e.product_id || "") === String(t.product_id || "")
          );
        })
      )
        throw new Error("تم تقديم مطالبة ضمان مسبقاً لهذا المنتج في نفس الطلب");
      (t.id = t.id || w("wc")),
        (t.status = t.status || "pending"),
        (t.issue = String(t.issue || t.description || "").trim()),
        (t.issue_type = String(t.issue_type || t.issue || "").trim()),
        (t.description = String(t.description || t.issue || "").trim()),
        (Array.isArray(t.images) && t.images.length) ||
          !t.proof_image_url ||
          (t.images = [t.proof_image_url]),
        (t.warranty_days = t.warranty_days || 365);
      const e = Q().find(function (e) {
          return b(e.order_number) === t.order_number;
        }),
        n = (e && e.created_at) || y(),
        r = Number(t.warranty_days) || 365;
      (t.warranty_expires_at = new Date(
        new Date(n).getTime() + 864e5 * r,
      ).toISOString()),
        (t.created_at = y()),
        (t.updated_at = t.created_at),
        (t.timeline = t.timeline || [
          { at: t.created_at, event: "تم استلام مطالبة الضمان", by: "system" },
        ]),
        new Date(t.warranty_expires_at).getTime() < Date.now() &&
          (t.status = "expired"),
        T.warranty.unshift(t),
        m(o, T.warranty),
        _("bl:warranty-updated");
      const i = f().WARRANTY_CLAIMS || "warranty_claims";
      if (p() && i)
        try {
          const e = await F(i, t);
          if (e && !e.local) {
            const n = T.warranty.findIndex(function (e) {
              return e.id === t.id;
            });
            n > -1 && (T.warranty[n] = e),
              m(o, T.warranty),
              _("bl:warranty-updated"),
              (t = e);
          }
        } catch (e) {
          if (
            ((T.warranty = T.warranty.filter(function (e) {
              return e.id !== t.id;
            })),
            m(o, T.warranty),
            _("bl:warranty-updated"),
            /duplicate key|unique|23505/i.test(
              String((e && (e.message || e.code)) || ""),
            ))
          )
            throw new Error("تم تقديم مطالبة ضمان مسبقاً لهذا المنتج");
          throw new Error(
            "فشل إرسال مطالبة الضمان: " +
              ((e && (e.message || e.code)) || "خطأ غير معروف"),
          );
        }
      return t;
    },
    updateWarrantyClaim: async function (t, e) {
      const n = T.warranty.findIndex(function (e) {
        return e.id === t;
      });
      if (-1 === n) return null;
      ((e = e || {}).timeline = e.timeline || T.warranty[n].timeline || []),
        e.status &&
          e.status !== T.warranty[n].status &&
          ((e.timeline = e.timeline.concat([
            { at: y(), event: "تغيير الحالة: " + ot(e.status), by: "admin" },
          ])),
          [
            "approved",
            "rejected",
            "completed",
            "in_repair",
            "replaced",
          ].indexOf(e.status) > -1 && (e.decision_at = y()));
      const r = Object.assign({}, T.warranty[n], e, { updated_at: y() });
      return (
        (T.warranty[n] = r),
        m(o, T.warranty),
        _("bl:warranty-updated"),
        await P(f().WARRANTY_CLAIMS || "warranty_claims", r),
        r
      );
    },
    deleteWarrantyClaim: at,
    labelWarrantyStatus: ot,
    computeWarrantyStatus: function (t, e) {
      if (!t) return "pending";
      if (
        t.status &&
        ["approved", "rejected", "completed", "in_repair", "replaced"].indexOf(
          t.status,
        ) > -1
      )
        return t.status;
      if (t.warranty_expires_at) {
        const e = new Date(t.warranty_expires_at).getTime();
        if (!isNaN(e) && e < Date.now()) return "expired";
      }
      return t.status || "pending";
    },
    getTestimonials: function (t) {
      const e = (T.testimonials || []).slice();
      return t
        ? e.filter(function (t) {
            return !1 !== t.is_active;
          })
        : e;
    },
    saveTestimonial: ct,
    deleteTestimonial: ut,
    getAdminCreds: function () {
      return g(u, window.ADMIN_DEFAULTS || {});
    },
    saveAdminCreds: function (t) {
      m(u, t);
    },
    getCart: dt,
    quoteShipping: quoteShipping,
    saveCart: function (t) {
      m(d, t), _("bl:cart-updated");
    },
    cartCount: function () {
      return dt().reduce(function (t, e) {
        return t + (e.qty || 1);
      }, 0);
    },
    cartSubtotal: function () {
      return dt().reduce(function (t, e) {
        return t + (e.price || 0) * (e.qty || 1);
      }, 0);
    },
    exportAllData: async function () {
      return {
        exported_at: y(),
        version: "bl-v9",
        settings: T.settings,
        categories: T.categories,
        products: T.products,
        testimonials: T.testimonials,
        coupons: T.coupons,
        orders: T.orders,
        returns: T.returns,
        consultations: T.consultations,
        warranty: T.warranty,
      };
    },
    importAllData: async function (t) {
      if (!t || "object" != typeof t) throw new Error("ملف غير صالح");
      if ((t.settings && (await W(t.settings)), Array.isArray(t.categories)))
        for (const e of t.categories) await K(e);
      if (Array.isArray(t.products)) for (const e of t.products) await $(e);
      if (Array.isArray(t.testimonials))
        for (const e of t.testimonials) await ct(e);
      if (Array.isArray(t.coupons)) for (const e of t.coupons) await tt(e);
      return !0;
    },
  }),
    "loading" === document.readyState
      ? document.addEventListener("DOMContentLoaded", lt)
      : lt();
})();
