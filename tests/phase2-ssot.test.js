// Usage: node tests/phase2-ssot.test.js <siteRoot>
// Storefront SSoT checks with a stubbed Supabase (no network, no real DB).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || '.');

function stub(settings, extra) {
  return `(function(){
  window.__inserts=[]; window.__rpc=[];
  const DATA={
    products:[{id:'p1',name:'Laser',price:1000,stock:5,is_active:true,category_id:'c1',sort_order:1},
              {id:'p2',name:'Pen',price:4500,stock:5,is_active:true,category_id:'c1',sort_order:2,badges:[{label:'شحن مجاني'}]}],
    categories:[{id:'c1',name:'Cat',is_active:true,sort_order:1}], testimonials:[],
    settings:[{key:'store',value:${JSON.stringify(settings)}}]};
  function q(table){let op='select',payload=null;const res=()=>({data:op==='select'?(DATA[table]||[]):null,error:null});
    const p=new Proxy(function(){},{get(_,k){if(k==='then')return(a,b)=>Promise.resolve(res()).then(a,b);
      if(k==='insert'||k==='upsert')return v=>{op=k;payload=v;window.__inserts.push({table,v});return p;};
      if(k==='single'||k==='maybeSingle')return()=>Promise.resolve({data:payload,error:null});return()=>p;},apply(){return p;}});return p;}
  const ch={on(){return ch;},subscribe(cb){cb&&cb('SUBSCRIBED');return ch;}};
  window.supabase={createClient(){return{from:q,
    rpc:async(n,a)=>{window.__rpc.push({n,a});return ${extra && extra.rpc ? extra.rpc : "{data:null,error:null}"};},
    auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},channel(){return ch;},removeChannel(){},
    storage:{from(){return{};}},functions:{invoke:async()=>({data:{ok:true},error:null})}};}};})();`;
}

const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
});

async function open(browser, base, url, settings, init, extra) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 204, body: '' }));
  await page.route(/supabase-js/, r => r.fulfill({ contentType: 'application/javascript', body: stub(settings, extra) }));
  await page.addInitScript(init || (() => {}));
  await page.addInitScript(() => { try { localStorage.setItem('bl_lead_captured', '1'); } catch (e) {} });
  await page.goto(base + url);
  await page.waitForFunction(() => window.BL && BL.isReady() && BL.getProducts(true).length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  page.__errors = errors;
  return page;
}

const visible = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); if (!el) return 'missing'; const cs = getComputedStyle(el); return !(el.hidden || cs.display === 'none'); }, sel);

(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const out = {};

  // (a) DB lacks contact/stats/announcement → nothing fake shown
  let p = await open(browser, base, '/index.html', { storeName: 'Beauty Life', currency: 'ج.م' });
  const html = await p.evaluate(() => document.body.innerText);
  out.a_noFakeValues = {
    placeholderPhone: /01000000000|\+201000000000/.test(html), fakeStats: /\+500|\+1200/.test(html),
    fakeRating: /\(4\.9\)/.test(html), fake5000: /فوق 5000/.test(html), fakeEmail: /info@beautylife\.com/.test(html),
    jsonLdPhone: await p.evaluate(() => /\+201000000000/.test(document.documentElement.innerHTML)),
    heroStatsVisible: await visible(p, '.hero-stats'), footPhoneRowVisible: await p.evaluate(() => { const li = document.getElementById('footPhone').closest('li'); return !(li.hidden || getComputedStyle(li).display === 'none'); }),
    waFloatVisible: await visible(p, '#waFloat'), announceVisible: await visible(p, '#topAnnounce'),
    skeletonsLeft: await p.evaluate(() => document.querySelectorAll('.sk,.sk-block').length), errors: p.__errors };
  await p.close();

  // (b) DB provides real values → shown
  p = await open(browser, base, '/index.html', { storeName: 'Beauty Life', phone: '01011112222', whatsapp: '201011112222', email: 'sales@beautylife-eg.com', address: 'Nasr City',
    heroStats: [{ value: '+320', label: 'عيادة' }], announcement: 'Hello from DB' });
  out.b_realValues = await p.evaluate(() => ({ footPhone: document.getElementById('footPhone').textContent, footEmail: document.getElementById('footEmail').textContent,
    stats: document.querySelector('.hero-stats').innerText.replace(/\s+/g, ' ').trim(), announce: document.getElementById('announceText').textContent,
    wa: document.getElementById('waFloat').getAttribute('href'), navTel: document.getElementById('navPhone').getAttribute('href') }));
  out.b_realValues.heroStatsVisible = await visible(p, '.hero-stats');
  await p.close();

  // (c) stale cart repriced from products table; deleted product removed
  p = await open(browser, base, '/store.html', { storeName: 'Beauty Life', localShippingFee: 80 }, () => {
    localStorage.setItem('bl_cart_v3', JSON.stringify([{ id: 'p1', product_id: 'p1', name: 'OLD', price: 1, qty: 2 }, { id: 'gone', product_id: 'gone', name: 'Deleted', price: 5, qty: 1 }]));
  });
  out.c_cart = await p.evaluate(() => ({ cart: BL.getCart().map(i => [i.id, i.name, i.price, i.qty]), subtotal: BL.cartSubtotal() }));
  await p.close();

  // (d) shipping: same results as the live v10 rules
  const cases = {
    local_default: [{ localShippingFee: 80 }, [['p1', 1]], 'local', ''],
    local_free_above: [{ localShippingFee: 80, freeShippingAbove: 1500 }, [['p1', 2]], 'local', ''],
    local_custom_gov: [{ localShippingFee: 80, localShippingMode: 'custom', localShippingByGovernorate: { 'الجيزة': 150 } }, [['p1', 1]], 'local', 'الجيزة'],
    free_badge: [{ localShippingFee: 80 }, [['p2', 1]], 'local', ''],
    intl_percent: [{ internationalShippingTaxPercent: 14, internationalShippingFee: 1500 }, [['p1', 3]], 'international', ''],
  };
  out.d_shipping = {};
  for (const [k, [st, cart, ship, gov]] of Object.entries(cases)) {
    p = await open(browser, base, '/store.html', Object.assign({ storeName: 'B', codEnabled: true }, st), new Function(`localStorage.setItem('bl_cart_v3', ${JSON.stringify(JSON.stringify(cart.map(([id, q]) => ({ id, product_id: id, name: id, price: id === 'p1' ? 1000 : 4500, qty: q }))))});`));
    out.d_shipping[k] = await p.evaluate(async ([ship, gov]) => {
      openCheckout(); selectShipType(ship);
      if (gov) { const g = document.getElementById('co_governorate'); g.value = gov; g.dispatchEvent(new Event('change')); }
      await new Promise(r => setTimeout(r, 200));
      const t = (document.getElementById('orderSummaryBox') || {}).innerText || '';
      return t.replace(/\s+/g, ' ').trim();
    }, [ship, gov]);
    await p.close();
  }

  // (e) WhatsApp confirmation link works for a customer who has no local order cache
  p = await open(browser, base, '/track.html?confirm=BL-111111-ABC&k=tok123', { storeName: 'Beauty Life' }, null, { rpc: "{data:{ok:true,already:false},error:null}" });
  await p.waitForTimeout(1500);
  out.e_confirm = await p.evaluate(() => ({ rpc: window.__rpc.filter(r => r.n === 'confirm_order_public').map(r => r.a), text: (document.body.innerText.match(/(تم تأكيد أوردرك[^\n]*|مش لاقيين[^\n]*|رابط التأكيد غير صالح[^\n]*)/) || [''])[0] }));
  await p.close();

  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(2); });
