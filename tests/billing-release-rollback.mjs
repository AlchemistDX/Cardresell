// Rollback intentionally retains new receipt-aware backend with original UI.
// This prevents a cached new client from reaching the old generic debit API.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {harness} from './_assert.mjs';
import {billingHarness,exact,UID,PAID_KEY,freeKey} from './_scanBillingHarness.mjs';
const {check,done}=harness('billing-release-rollback');
const ROOT=resolve(new URL('..',import.meta.url).pathname);
const ROLLBACK=resolve(ROOT,'../cardresell-billing-rollback');
for(const f of ['_idBilling.js','_tier.js','scan.js','scan-debit-id.js','scan-refund.js'])
 check('rollback retains byte-identical receipt-aware backend '+f,
  readFileSync(resolve(ROOT,'api',f)).equals(readFileSync(resolve(ROLLBACK,'api',f))));
const oldHtml=readFileSync(resolve(ROLLBACK,'index.html'),'utf8');
check('rollback serves historical production UI',oldHtml.includes('/js/core.c6543908.js')&&!oldHtml.includes('/js/core.15fab283.js'));
const debit=(await import(pathToFileURL(resolve(ROLLBACK,'api/scan-debit-id.js')))).default;
const refund=(await import(pathToFileURL(resolve(ROLLBACK,'api/scan-refund.js')))).default;
async function invoke(handler,body){
 const res={statusCode:200,payload:null,status(n){this.statusCode=n;return this},json(p){this.payload=p;return this}};
 await handler({method:'POST',headers:{authorization:'Bearer '+'x'.repeat(40)},body},res);return res;
}
const h=billingHarness({bucket:'free',balance:4});
try{
 const offered=(await h.scan()).payload,body=h.body(offered.candidates[6]);
 const priorFree=h.store.get(freeKey()),priorPaid=h.store.get(PAID_KEY);
 const old=await invoke(debit,{pickedCard:offered.candidates[6]});
 check('old UI generic confirmation fails closed before any debit',old.statusCode===400
  &&h.store.get(freeKey())===priorFree&&h.store.get(PAID_KEY)===priorPaid);
 const accepted=await h.pick(body),first=JSON.stringify(accepted.payload);
 const replies=await Promise.all(Array.from({length:6},()=>invoke(debit,body)));
 check('cached new-client concurrent rollback replays identical accepted result',replies.every(r=>r.statusCode===200&&JSON.stringify(r.payload)===first));
 check('rollback replay never adds charge to either bucket',h.net()===1&&h.store.get(PAID_KEY)==='4');
 const wrong=await invoke(debit,{...body,candidate:offered.candidates[0]});
 check('rollback cannot switch selected candidate',wrong.statusCode===409&&h.net()===1);
 const record=(await h.scan(exact())).payload;
 check('new completed scan retains journal reference',!!JSON.parse(h.store.get('scan:'+record.scan_id)).id_receipt);
 const r1=await invoke(refund,{scan_id:record.scan_id,reason:'wrong_card'});
 const freeAfter=h.store.get(freeKey()),paidAfter=h.store.get(PAID_KEY);
 const r2=await invoke(refund,{scan_id:record.scan_id,reason:'wrong_card'});
 check('rollback refund restores original bucket once',r1.statusCode===200&&h.net()===1);
 check('rollback duplicate refund replays zero restoration',r2.statusCode===200&&r2.payload.alreadyRefunded===true&&r2.payload.credits_refunded===0&&h.store.get(freeKey())===freeAfter&&h.store.get(PAID_KEY)===paidAfter);
 check('rollback does not create a generic paid-only debit',h.store.get(PAID_KEY)==='4');
}finally{h.restore()}
done();
