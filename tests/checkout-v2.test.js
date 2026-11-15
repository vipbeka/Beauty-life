// Usage: node tests/checkout-v2.test.js <siteRoot>
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || '.');

function stub(fn) {
  return `(function(){
  window.__inserts=[]; window.__invokes=[]; window.__rpc=[];
  const DATA={products:[{id:'p1',name:'Laser',price:1000,stock:5,is_active:true,category_id:'c1',sort_order:1}],
    categories:[{id:'c1',name:'Cat',is_active:true,sort_order:1}],testimonials:[],
    settings:[{key:'store',value:{storeName:'Beauty Life',currency:'ج.م',codEnabled:true,visaEnabled:true,localShippingFee:150}}]};
  function q(table){let op='select',payload=null;const res=()=>({data:op==='select'?(DATA[table]||[]):null,error:null});
    const p=new Proxy(function(){},{get(_,k){if(k==='then')return(a,b)=>Promise.resolve(res()).then(a,b);
      if(k==='insert'||k==='upsert')return v=>{op=k;payload=v;window.__inserts.push({table,v});return p;};
      if(k==='single'||k==='maybeSingle')return()=>Promise.resolve({data:payload,error:null});return()=>p;},apply(){return p;}});return p;}
  const ch={on(){return ch;},subscribe(cb){cb&&cb('SUBSCRIBED');return ch;}};
  const FN=${fn};
  window.supabase={createClient(){return{from:q,
    rpc:async(n,a)=>{window.__rpc.push({n,a});return window.__rpcResult?window.__rpcResult(n,a):{data:null,error:null};},
    auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})},channel(){return ch;},removeChannel(){},storage:{from(){return{};}},
    functions:{invoke:async(name,o)=>{window.__invokes.push({name,body:o&&o.body});return FN(name,(o&&o.body)||{});}}};}};})();`;
}
const http404 = `{data:null,error:{message:'nf',context:{status:404,json:async()=>({})}}}`;
const FNS = {
  off: `(name,b)=>{ if(name!=='create-checkout') return {data:{ok:true},error:null};
     if(b.action==='config') return {data:{ok:true,mode:'off',methods:b.ship_type==='local'?['cod']:[]},error:null};
     return {data:{ok:true,kind:'cod',order_number:'BL-777777-SRV',total:1150},error:null}; }`,
  notdeployed: `(name,b)=> name==='create-checkout' ? ${http404} : {data:{ok:true},error:null}`,
  sandbox: `(name,b)=>{ if(name!=='create-checkout') return {data:{ok:true},error:null};
     if(b.action==='config') return {data:{ok:true,mode:'sandbox',sandbox_access:true,methods:['cod','card','wallet','valu','instapay']},error:null};
     if(b.payment_method==='card') return {data:{ok:true,kind:'redirect',order_number:'BL-1',redirect_url:location.origin+'/__gateway?cs=1'},error:null};
     if(b.payment_method==='instapay') return {data:{ok:true,kind:'transfer',order_number:'BL-2',total:1150,reference:'BL-2',instapay:'beauty<b>@instapay'},error:null};
     return {data:{ok:true,kind:'cod',order_number:'BL-3',total:1150},error:null}; }`,
  error409: `(name,b)=>{ if(name!=='create-checkout') return {data:{ok:true},error:null};
     if(b.action==='config') return {data:{ok:true,mode:'off',methods:['cod']},error:null};
     return {data:null,error:{message:'x',context:{status:409,json:async()=>({ok:false,error:'product_unavailable',message:'أحد المنتجات لم يعد متاحًا — حدّث السلة'})}}}; }`,
};

const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/__gateway')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<h1>gateway</h1>'); }
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(b); });
});

async function page(browser, base, url, fn) {
  const p = await browser.newPage(); p.__errors = [];
  p.on('pageerror', e => p.__errors.push(e.message));
  await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 204, body: '' }));
  await p.route(/supabase-js/, r => r.fulfill({ contentType: 'application/javascript', body: stub(fn) }));
  await p.addInitScript(() => { try { localStorage.setItem('bl_lead_captured', '1'); localStorage.setItem('bl_cart_v3', JSON.stringify([{ id: 'p1', product_id: 'p1', name: 'OLD', price: 1, qty: 2 }])); } catch (e) {} });
  await p.goto(base + url);
  return p;
}
async function checkout(p, method) {
  await p.waitForFunction(() => window.BL && BL.isReady() && BL.getProducts(true).length > 0, null, { timeout: 15000 });
  await p.waitForTimeout(300);
  await p.evaluate(() => openCheckout());
  await p.waitForTimeout(400);
  await p.fill('#co_name', 'Test Buyer'); await p.fill('#co_phone', '01012345678'); await p.fill('#co_address', '1 Street');
  await p.selectOption('#co_governorate', { index: 1 });
  if (method) await p.click(`#blPayV2 [data-method="${method}"]`);
  return p.evaluate(() => ({ tiles: [...document.querySelectorAll('#blPayV2 [data-method]')].map(e => e.dataset.method),
    legacyCodVisible: !!document.getElementById('payCodTab') && getComputedStyle(document.getElementById('payCodTab')).display !== 'none',
    legacyVisaVisible: !!document.getElementById('payVisaTab') && getComputedStyle(document.getElementById('payVisaTab')).display !== 'none' }));
}

(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const out = {};

  let p = await page(browser, base, '/store.html', FNS.off);
  out.off_ui = await checkout(p);
  await p.evaluate(() => submitOrder()); await p.waitForTimeout(800);
  out.off_result = await p.evaluate(() => ({ step2: !document.getElementById('checkoutStep2').classList.contains('hidden'),
    orderNumber: document.getElementById('orderNumDisplay').textContent, msg: document.getElementById('orderSuccessMsg').textContent,
    createBody: (window.__invokes.find(i => i.body && i.body.action === 'create') || {}).body,
    legacyOrderInsert: window.__inserts.some(i => i.table === 'orders'), cartLeft: BL.getCart().length }));
  out.off_errors = p.__errors; await p.close();

  p = await page(browser, base, '/store.html', FNS.notdeployed);
  out.nd_ui = await checkout(p);
  await p.evaluate(() => submitOrder()); await p.waitForTimeout(1500);
  out.nd_result = await p.evaluate(() => ({ step2: !document.getElementById('checkoutStep2').classList.contains('hidden'),
    legacyOrderInsert: window.__inserts.some(i => i.table === 'orders'), orderNumber: document.getElementById('orderNumDisplay').textContent }));
  out.nd_errors = p.__errors; await p.close();

  p = await page(browser, base, '/store.html', FNS.sandbox);
  out.sb_ui = await checkout(p, 'card');
  await Promise.all([p.waitForURL(/__gateway/, { timeout: 8000 }).catch(() => {}), p.evaluate(() => submitOrder())]);
  out.sb_card_redirectedTo = p.url().replace(base, '');
  await p.close();

  p = await page(browser, base, '/store.html', FNS.sandbox);
  await checkout(p, 'instapay');
  await p.evaluate(() => submitOrder()); await p.waitForTimeout(800);
  out.sb_instapay = await p.evaluate(() => ({ box: (document.getElementById('blTransferBox') || {}).innerText, injected: !!document.querySelector('#blTransferBox b b') }));
  await p.close();

  p = await page(browser, base, '/store.html', FNS.error409);
  await checkout(p);
  await p.evaluate(() => submitOrder()); await p.waitForTimeout(800);
  out.err409 = await p.evaluate(() => ({ toast: (document.querySelector('.toast.error') || {}).textContent, step2: !document.getElementById('checkoutStep2').classList.contains('hidden') }));
  await p.close();

  // payment-callback: never trusts ?status=success; reads DB via payment_status RPC
  const cb = async (qs, rpc) => {
    const q = await browser.newPage();
    await q.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 204, body: '' }));
    await q.route(/supabase-js/, r => r.fulfill({ contentType: 'application/javascript', body: stub(FNS.off) }));
    if (rpc) await q.addInitScript(r => { window.__rpcResult = (n, a) => ({ data: n === 'payment_status' && a.p_token === 'tok' ? { payment_status: r } : null, error: null }); }, rpc);
    await q.goto(base + '/payment-callback.html' + qs);
    await q.waitForTimeout(2500);
    const t = await q.evaluate(() => document.getElementById('title').textContent);
    await q.close(); return t;
  };
  out.callback_forged_status_success = await cb('?order=BL-1&status=success');
  out.callback_paid = await cb('?order=BL-1&t=tok', 'paid');
  out.callback_failed = await cb('?order=BL-1&t=tok', 'failed');
  out.callback_wrong_token = await cb('?order=BL-1&t=guess&status=success', 'paid');

  console.log(JSON.stringify(out, null, 1));
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(2); });
