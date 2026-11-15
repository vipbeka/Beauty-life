// Usage: node tests/no-hardcoded-flash.test.js <siteRoot>
// 1) Snapshots the page at first paint (before DB data) and after load: no hardcoded copy may appear.
// 2) Simulates a blocked/slow CDN SDK (in-app Android browsers): demo products must never appear.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || '.');

const SETTINGS = { storeName: 'Beauty Life', currency: 'ج.م', heroTitle: 'عنوان من قاعدة البيانات', heroSubtitle: 'وصف من قاعدة البيانات',
  heroFloatTitle: 'ضمان سنة', heroFloatSubtitle: '+ صيانة معتمدة', aboutText: 'نص من نحن من قاعدة البيانات', whySectionEyebrow: 'ليه إحنا؟',
  whySectionTitle: 'عنوان القسم من القاعدة', whySectionItems: [{ icon: 'fa-certificate', title: 'ضمان سنة حقيقي', text: 'من القاعدة' }],
  phone: '+201016019537', whatsapp: '201016019537', email: 'info@beautylife-eg.com', address: 'القاهرة', heroStats: [{ value: '+5000', label: 'عيادة' }],
  announcement: 'إعلان من القاعدة', themeAccent: '#d38301' };
const stub = `(function(){const DATA={products:[{id:'p_db',name:'منتج من قاعدة البيانات',price:200,stock:5,is_active:true,category_id:'c1',sort_order:1,is_featured:true}],
  categories:[{id:'c1',name:'قسم من القاعدة',is_active:true,sort_order:1}],testimonials:[],settings:[{key:'store',value:${JSON.stringify(SETTINGS)}}]};
  function q(t){const res={data:DATA[t]||[],error:null};const p=new Proxy(function(){},{get(_,k){if(k==='then')return(a,b)=>Promise.resolve(res).then(a,b);
  if(k==='single'||k==='maybeSingle')return()=>Promise.resolve({data:null,error:null});return()=>p;},apply(){return p;}});return p;}
  const ch={on(){return ch;},subscribe(cb){cb&&cb('SUBSCRIBED');return ch;}};
  window.supabase={createClient(){return{from:q,rpc:async()=>({data:null,error:null}),auth:{getSession:async()=>({data:{session:null}})},channel(){return ch;},removeChannel(){},storage:{from(){return{};}},functions:{invoke:async()=>({data:{ok:true},error:null})}};}};})();`;

const BAD = ['ضمان سنتان', 'ضمان سنتين', 'الأصلية لعيادتك', '01000000000', '+500\n', '+1200\n', '(4.9)', 'جهاز ليزر ديودو', 'د. أحمد محمود', 'info@beautylife.com', 'فوق 5000'];
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
});
const found = (txt) => BAD.filter((b) => txt.includes(b));

async function run(browser, base, url, slowSdk) {
  const page = await browser.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 204, body: '' }));
  if (slowSdk) {
    // HTML's unpinned SDK is blocked; supabase-init's pinned fallback arrives 2.5s later.
    await page.route(/supabase-js@2\/dist|supabase-js@2"?$|supabase-js@2$/, (r) => r.abort());
    await page.route(/supabase-js@2(?!\.)/, (r) => r.abort());
    await page.route(/supabase-js@2\.45\.4/, async (r) => { await new Promise((x) => setTimeout(x, 2500)); r.fulfill({ contentType: 'application/javascript', body: stub }); });
  } else {
    await page.route(/supabase-js/, (r) => r.fulfill({ contentType: 'application/javascript', body: stub }));
  }
  await page.addInitScript(() => { try { localStorage.setItem('bl_lead_captured', '1'); } catch (e) {} });
  const seen = new Set();
  await page.goto(base + url, { waitUntil: 'commit' });
  for (let t = 0; t < 30; t++) { // sample visible text for ~6s
    try { found(await page.evaluate(() => document.body ? document.body.innerText : '')).forEach((x) => seen.add(x)); } catch (e) {}
    await page.waitForTimeout(200);
  }
  const final = await page.evaluate(() => ({ text: document.body.innerText,
    hasDbProduct: document.body.innerText.includes('منتج من قاعدة البيانات'),
    heroTitle: (document.getElementById('heroTitle') || {}).textContent || null,
    badge: (document.querySelector('.hero-float-badge b') || {}).textContent || null,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--gold-600').trim(),
    cachedDemo: (localStorage.getItem('bl_products_v3') || '').includes('p_laser_diodo') }));
  await page.close();
  return { everShownHardcoded: [...seen], dbProductShown: final.hasDbProduct, heroTitle: final.heroTitle, badge: final.badge, accent: final.accent, demoSavedToDevice: final.cachedDemo };
}

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const out = {
    index_normal: await run(browser, base, '/index.html', false),
    store_normal: await run(browser, base, '/store.html', false),
    index_slow_sdk: await run(browser, base, '/index.html', true),
    store_slow_sdk: await run(browser, base, '/store.html', true),
  };
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(2); });
