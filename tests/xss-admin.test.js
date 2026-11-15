// Usage: node xss-admin.test.js <siteRoot>
// Serves the site locally, stubs Supabase with a malicious order, opens admin order modal.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2]);

const MAL_ID = "o1');window.__pwned='onclick-id';//";
const stub = `
(function(){
  const now = new Date().toISOString();
  const DATA = {
    orders: [{ id: ${JSON.stringify(MAL_ID)}, order_number: 'BL-TEST-1', customer_name: '<img src=x onerror="window.__pwned=\\'name\\'">',
      customer_phone: '01000000001', status: '<img src=x onerror="window.__pwned=\\'status\\'">', shipping_type: '<img src=x onerror="window.__pwned=\\'ship\\'">', payment_method: '<img src=x onerror="window.__pwned=\\'paym\\'">', payment_status: '<img src=x onerror="window.__pwned=\\'pays\\'">', admin_notes: '<img src=x onerror="window.__pwned=\\'notes\\'">', customer_email: '<img src=x onerror="window.__pwned=\\'email\\'">', address:'<img src=x onerror="window.__pwned=\\'addr\\'">', city:'<svg onload="window.__pwned=\\'city\\'">', created_at: now, total: 10,
      items: [{ name: 'Device', price: 10, qty: '<img src=x onerror="window.__pwned=\\'qty\\'">' }] }],
    returns: [{ id: "r1');window.__pwned='return-id';//", order_number:'bl-test-1', status:'pending', created_at: now }],
    settings: [{ key: 'store', value: { storeName: 'Test' } }]
  };
  function q(table){
    const res = { data: DATA[table] || [], error: null };
    const p = new Proxy(function(){}, {
      get(_, k){ if (k === 'then') return (a,b)=>Promise.resolve(res).then(a,b);
        if (k === 'single' || k === 'maybeSingle') return ()=>Promise.resolve({data:(res.data||[])[0]||null,error:null});
        return ()=>p; },
      apply(){ return p; } });
    return p;
  }
  const ch = { on(){return ch;}, subscribe(cb){ cb && cb('SUBSCRIBED'); return ch; } };
  window.supabase = { createClient(){ return {
    from: q, rpc: ()=>Promise.resolve({data:null,error:null}),
    auth: { getSession: async ()=>({ data:{ session:{ user:{ email:'beauty@admin.com' } } } }), signOut: async()=>({}) , onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}} },
    channel(){ return ch; }, removeChannel(){},
    storage: { from(){ return { upload: async()=>({}), getPublicUrl(){return {data:{}}}, remove: async()=>({}) }; } },
    functions: { invoke: async (name, o) => { (window.__invokes = window.__invokes || []).push({ name, body: o && o.body }); return { data: { ok: true }, error: null }; } }
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
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 204, body: '' }));
  await page.route(/supabase-js/, r => r.fulfill({ contentType: 'application/javascript', body: stub }));
  await page.addInitScript(() => { sessionStorage.setItem('bl_admin_auth', '1'); sessionStorage.setItem('bl_admin_auth_ts', String(Date.now())); });
  await page.goto(base + '/admin.html');
  page.on('console', m => process.env.DBG && console.log('C:', m.text().slice(0,200)));
  await page.waitForTimeout(3000); if (process.env.DBG) console.log(await page.evaluate(() => ({ url: location.href, sb: !!(window.SB&&SB.client), bl: !!window.BL, ready: window.BL&&BL.isReady(), n: window.BL&&BL.getOrders().length })));
  await page.waitForFunction(() => window.BL && BL.isReady && BL.isReady() && (BL.getOrders() || []).length > 0, null, { timeout: 15000 });
  await page.evaluate(() => window.showPane && showPane('orders'));
  await page.waitForTimeout(500);
  // Open order modal (renders qty + id buttons)
  await page.evaluate(id => window.viewOrder(id), MAL_ID);
  await page.waitForTimeout(600);
  // Capture what id the inline handlers would pass, by stubbing targets
  const result = await page.evaluate(async (MAL_ID) => {
    const seen = [];
    window.saveOrderChanges = id => seen.push(['save', id]);
    window.printInvoice = id => seen.push(['print', id]);
    window.viewOrder = id => seen.push(['view', id]);
    for (const b of document.querySelectorAll('[onclick*="saveOrderChanges"],[onclick*="printInvoice"],[onclick*="viewOrder"]')) { try { b.click(); } catch (e) {} }
    await new Promise(r => setTimeout(r, 300));
    const where = [...document.querySelectorAll('img[src="x"]')].map(i => { let n=i, path=[]; while(n && n!==document.body){ path.push(n.id||n.className||n.tagName); n=n.parentElement;} return path.slice(0,6).join(' < '); });
    return { where, pwned: window.__pwned || null, seen, idsExact: seen.length > 0 && seen.every(s => s[1] === MAL_ID) };
  }, MAL_ID);
  console.log(JSON.stringify({ ...result, pageErrors: errors.slice(0, 5) }, null, 1));
  await browser.close(); srv.close();
  process.exit(result.pwned ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
