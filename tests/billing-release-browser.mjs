// Production-baseline picker + actual scan/debit handlers. Local synthetic
// provider/auth boundary and private Redis; NOT managed or physical Safari.
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {harness} from './_assert.mjs';
import {billingHarness,PAID_KEY,freeKey} from './_scanBillingHarness.mjs';
const {check,done}=harness('billing-release-browser');
const ROOT=resolve(new URL('..',import.meta.url).pathname),ORIGIN='https://billing-release.test';
const EVIDENCE='/home/user/workspace/billing-release-browser-evidence';
mkdirSync(EVIDENCE,{recursive:true});
const {chromium,devices}=(await import('/home/user/node_modules/playwright/index.js')).default;
const browser=await chromium.launch();
try {
 for(const mode of ['cancel','no-selection','success','lost-after-commit','rejected']){
  const h=billingHarness({bucket:'free',balance:4});
  const offered=(await h.scan()).payload;
  const ctx=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
  let calls=[],draftWrites=0,drop=mode==='lost-after-commit',hold,observedCommit=false;
  await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   const json=(x,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(x)});
   if(u.origin!==ORIGIN)return route.abort('blockedbyclient');
   if(u.pathname==='/api/scan-debit-id'){
    const body=req.postDataJSON();calls.push(body);
    await new Promise(resolve=>{hold=resolve});
    const r=await h.pick(body);
    observedCommit=r.payload.ok===true;
    if(drop){drop=false;return route.abort('failed')}
    return json(r.payload,r.statusCode);
   }
   if(u.pathname==='/api/pro-status')return json({tier:'pro',isPro:true,idFreeLeft:30-Number(h.store.get(freeKey())),idPaidLeft:Number(h.store.get(PAID_KEY))});
   if(u.pathname.startsWith('/api/')){
    if(/draft/.test(u.pathname)&&req.method()!=='GET')draftWrites++;
    return json({error:'offline'},503);
   }
   try{
    const p=resolve(ROOT,'.'+(u.pathname==='/'?'/index.html':u.pathname));
    if(!p.startsWith(ROOT+'/'))throw Error('path');
    return route.fulfill({contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html',body:readFileSync(p)});
   }catch(_){return route.fulfill({status:404,body:''})}
  });
  try {
   const page=await ctx.newPage();await page.goto(ORIGIN);
   await page.waitForFunction(()=>typeof _renderScanCandidatesPicker==='function');
   await page.evaluate(payload=>{
    window._googleIdToken='x'.repeat(40);
    document.getElementById('scanOverlay').style.display='flex';
    _renderScanCandidatesPicker(payload.candidates,document.getElementById('scanStatus'),document.getElementById('scanResult'),null,payload);
   },offered);
   const candidateButtons=page.locator('#scanResult button[onclick^="_pickScanCandidate"]');
   check(mode+':all nine real provider candidates reachable',await candidateButtons.count()===9);
   check(mode+':offer netzero with no accepted identity',h.net()===0&&offered.identified===false
    &&await page.evaluate(()=>!window._pendingIdScanCard&&!window._pendingScanBannerCard));
   if(mode==='cancel'||mode==='no-selection'){
    if(mode==='cancel')await page.locator('#scanResult button[onclick="cancelScan()"]').click();
    check(mode+':zero acceptance and zero credit mutation',calls.length===0&&h.net()===0);
    check(mode+':no successful identity or draft',draftWrites===0&&await page.evaluate(()=>!window._lastIdentifiedCard&&!window._pendingIdScanCard));
   }else{
    if(mode==='rejected'){h.store.set(freeKey(),30);h.store.set(PAID_KEY,0)}
    const button=await candidateButtons.nth(6).elementHandle();
    await button.tap();await button.evaluate(e=>e.click());
    while(!hold)await new Promise(r=>setTimeout(r,10));
    check(mode+':double tap issues one receipt-bound seventh selection',calls.length===1&&calls[0].confirmation_id===offered.confirmation_id&&calls[0].candidate.set_name==='set6');
    check(mode+':pending acceptance has no success or persisted identity',await page.evaluate(()=>!window._lastIdentifiedCard&&!window._pendingIdScanCard
     &&document.getElementById('scanSuccessBadge').style.display==='none'));
    hold();hold=null;
    await page.waitForFunction(()=>window._scanCandidateDebitPending===false);
    if(mode==='lost-after-commit'){
     check('response loss occurs after actual handler committed once',observedCommit&&h.net()===1);
     check('lost response never promotes identity',await page.evaluate(()=>!window._lastIdentifiedCard&&!window._pendingIdScanCard));
     await page.getByTestId('identity-retry').click();
     while(!hold)await new Promise(r=>setTimeout(r,10));
     hold();hold=null;await page.waitForFunction(()=>window._scanCandidateDebitPending===false);
     check('real retry preserves exact receipt/body',JSON.stringify(calls[0])===JSON.stringify(calls[1]));
    }
    if(mode==='rejected'){
     check('402 does not accept or persist selected identity',!observedCommit&&await page.evaluate(()=>!window._lastIdentifiedCard&&!window._pendingIdScanCard));
     check('402 preserves empty separate buckets',h.store.get(PAID_KEY)==='0'&&h.store.get(freeKey())==='30');
    }else{
     check(mode+':accepted identity is seventh printing, not top guess',await page.evaluate(()=>window._pendingIdScanCard?.setName==='set6'||window._lastIdentifiedCard?.setName==='set6'));
     check(mode+':one free credit and zero paid debit',h.net()===1&&h.store.get(PAID_KEY)==='4');
     const replay=await h.pick(calls[0]);
     check(mode+':second-client replay adds zero debit',replay.payload.pickedCard?.set_name==='set6'&&h.net()===1);
    }
    check(mode+':no draft mutation or successful-scan record from pending confirmation',draftWrites===0&&!h.commands.some(c=>/^(scan:|stats:searches:)/.test(c.key)));
   }
   await page.screenshot({path:EVIDENCE+'/'+mode+'.png',fullPage:true});
  } finally {if(hold)hold();await ctx.close();h.restore()}
 }
}finally{await browser.close()}
done();
