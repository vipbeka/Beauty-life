// Usage: node tests/checkout-email.test.js <siteRoot> <mode: server|notdeployed>
// Places a COD order on store.html with a stubbed Supabase and reports which email path ran.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || '.');
const mode = process.argv[3] || 'server';

const stub = `
(function(){
  const now = new Date().toISOString();
  window.__inserts = []; window.__invokes = [];
  const DATA = {
    products: [{ id:'p1', name:'Laser', price:1000, stock:5, is_active:true, category_id:'c1', sort_order:1 }],
    categories: [{ id:'c1', name:'Cat', is_active:true, sort_order:1 }],
    testimonials: [],
    settings: [{ key:'store', value:{ storeName:'Beauty Life', currency:'ج.م', codEnabled:true, localShippingFee:80,
      brevoEnabled:true, brevoApiKey:'xkeysib-LEGACY-TEST', notificationRecipientEmail:'owner@example.com', notificationSenderEmail:'noreply@example.com',
      customerBrevoApiKey:'xkeysib-LEGACY-CUST', customerSenderEmail:'hello@example.com' } }]
  };
  function q(table){
    let op = 'select', payload = null;
    const res = () => ({ data: op === 'select' ? (DATA[table] || []) : null, error: null });
    const p = new Proxy(function(){}, {
      get(_, k){
        if (k === 'then') return (a,b)=>Promise.resolve(res()).then(a,b);
        if (k === 'insert' || k === 'upsert') return (v)=>{ op = k; payload = v; window.__inserts.push({ table, op: k, v }); return p; };
        if (k === 'single' || k === 'maybeSingle') return ()=>Promise.resolve({ data: payload || null, error: null });
        return ()=>p; },
      apply(){ return p; } });
    return p;
  }
  const ch = { on(){return ch;}, subscribe(cb){ cb && cb('SUBSCRIBED'); return ch; } };
  window.supabase = { createClient(){ return {
    from: q, rpc: ()=>Promise.resolve({data:null,error:null}),
    auth: { getSession: async ()=>({ data:{ session:null } }), signOut: async()=>({}) },
    channel(){ return ch; }, removeChannel(){},
    storage: { from(){ return {}; } },
    functions: { invoke: async (name, o) => {
      window.__invokes.push({ name, body: o && o.body });
      if (${JSON.stringify(mode)} === 'notdeployed') return { data: null, error: { message: 'not found', context: { status: 404 } } };
      return { data: { ok: true, results: [{ role:'admin', status:'sent' }] }, error: null };
    } }
  }; } };
})();`;

const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
});

(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const brevo = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 204, body: '' }));
  await page.route(/api\.brevo\.com/, r => { brevo.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ status: 201, contentType: 'application/json', body: '{"messageId":"x"}' }); });
  await page.route(/supabase-js/, r => r.fulfill({ contentType: 'application/javascript', body: stub }));
  await page.addInitScript(() => { try { localStorage.setItem('bl_lead_captured', '1'); } catch (e) {} });
  await page.goto(base + '/store.html');
  await page.waitForFunction(() => window.BL && BL.isReady() && BL.getProducts(true).length > 0, null, { timeout: 15000 });
  await page.evaluate(() => { addToCart('p1'); openCheckout(); });
  await page.fill('#co_name', 'Test Buyer');
  await page.fill('#co_phone', '01012345678');
  await page.fill('#co_address', '1 Street');
  await page.selectOption('#co_governorate', { index: 1 });
  await page.evaluate(() => { const e = document.getElementById('co_email'); if (e) e.value = 'buyer@example.com'; });
  await page.evaluate(() => submitOrder());
  await page.waitForFunction(() => { const s = document.getElementById('checkoutStep2'); return s && !s.classList.contains('hidden'); }, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const out = await page.evaluate(() => ({
    orderNumber: document.getElementById('orderNumDisplay').textContent,
    orderInserted: window.__inserts.some(i => i.table === 'orders'),
    invokes: window.__invokes.map(i => ({ name: i.name, event: i.body && i.body.event, hasId: !!(i.body && i.body.id), hasOrderNumber: !!(i.body && i.body.order_number) })),
  }));
  out.brevoDirectCalls = brevo.length;
  out.brevoDirectKeysUsed = brevo.length ? 'legacy fallback' : 'none';
  out.pageErrors = errors.slice(0, 5);
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(2); });
