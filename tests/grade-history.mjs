import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {chromium} from 'playwright';
import {redisCommand} from './_idRedis.mjs';
import {createGradeHistoryHandler,GRADE_HISTORY_LIMIT} from '../api/grade-history.js';
let checks=0, fail=false;
const check=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;console.log('✓ '+label)};
const handler=createGradeHistoryHandler({verify:async token=>{if(!['alice','bob','cap'].includes(token))throw Error();return {uid:token}},kv:async(...args)=>{if(fail)throw Error('offline');return redisCommand(args)}});
async function call(method,owner='',body={},query={}){let status=200,value;await handler({method,headers:{authorization:owner?'Bearer '+owner:''},body,query},{setHeader(){},status(n){status=n;return this},json(x){value=x;return this}});return {status,...value}}
const data={card_name:'Test <img src=x onerror=alert(1)>',set_name:'Test set',card_number:'129',psa_estimate:8.5,grade_notes:'Light corner wear',deepGrade:true,cv_downgraded:true,creditsUsed:1,imageBase64:'NEVER_STORE_PHOTOS',secret:'excluded'};
const id=randomUUID();
check('authentication required',(await call('GET')).status,401);
check('invalid grade refused',(await call('POST','alice',{id,data:{psa_estimate:0}})).status,400);
const saves=await Promise.all(Array.from({length:8},()=>call('POST','alice',{id,data})));
check('concurrent save creates one report',saves.filter(x=>!x.replayed).length,1);
check('list contains one report',(await call('GET','alice')).reports.length,1);
check('another account cannot read report',(await call('GET','bob',{}, {id})).status,404);
const report=(await call('GET','alice',{}, {id})).report;
check('fallback distinguished',report.mode,'Deep request · Quick fallback');
check('photo excluded',report.data.imageBase64,undefined);
check('unknown fields excluded',report.data.secret,undefined);
check('saved report retains notes',report.data.grade_notes,data.grade_notes);
await call('DELETE','alice',{}, {id});
check('deleted report gone',(await call('GET','alice',{}, {id})).status,404);
check('retry cannot resurrect deleted report',(await call('POST','alice',{id,data})).status,409);
fail=true;check('storage failure honest',(await call('POST','alice',{id:randomUUID(),data})).status,503);fail=false;
for(let i=0;i<GRADE_HISTORY_LIMIT-1;i++)await redisCommand(['HSET','ai_grades:{cap}:reports',randomUUID(),'{}']);
const capped=await Promise.all(Array.from({length:6},()=>call('POST','cap',{id:randomUUID(),data})));
check('atomic cap admits exactly remaining slot',capped.filter(x=>x.status===200).length,1);
check('cap refuses excess explicitly',capped.filter(x=>x.status===409).length,5);
const root=resolve(new URL('../',import.meta.url).pathname);
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname==='/api/grade-history'){
  let raw='';for await(const chunk of req)raw+=chunk;
  req.body=raw?JSON.parse(raw):{};req.query=Object.fromEntries(url.searchParams);
  res.status=n=>{res.statusCode=n;return res};res.json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x))};return handler(req,res);
 }
 if(url.pathname.startsWith('/api/')){res.writeHead(503);res.end('{}');return}
 let path=join(root,url.pathname==='/'?'index.html':url.pathname);
 if(!existsSync(path))path=join(root,'public',url.pathname);
 if(!existsSync(path)){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(readFileSync(path));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage();await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.fulfill({status:503,body:'{}'}));
 await page.goto(origin);
 const signIn=()=>page.evaluate(()=>{window.googleUser={sub:'alice'};window._googleIdToken='alice';});
 await signIn();
 await page.evaluate(data=>{window._lastGradeShareData={data};const result=document.getElementById('scanResult');document.body.append(result);result.style.display='block';result.innerHTML='<button id="shareGradeBtn">Share this grade</button>';},data);
 await page.locator('#saveAiGradeBtn').waitFor({state:'visible'});
 fail=true;await page.locator('#saveAiGradeBtn').click();await page.getByText('Grade history is unavailable.',{exact:false}).waitFor();
 check('failed save remains retryable',await page.locator('#saveAiGradeBtn').isEnabled(),true);
 fail=false;await page.locator('#saveAiGradeBtn').click();await page.getByRole('button',{name:'Grade saved',exact:true}).waitFor();
 check('save succeeded in real API',(await call('GET','alice')).reports.length,1);
 await page.reload();await signIn();await page.evaluate(()=>switchView('collection'));
 await page.getByRole('button',{name:'View saved grades',exact:true}).click();
 await page.getByRole('button',{name:'Open report',exact:true}).click();
 await page.getByText('Light corner wear',{exact:true}).waitFor();
 check('report survives page reload',await page.getByText('AI estimate: 8.5/10 · Deep request · Quick fallback').isVisible(),true);
 check('card title rendered as text',await page.locator('#aiGradeHistoryDialog img').count(),0);
 check('mobile dialog fits',await page.locator('#aiGradeHistoryDialog').evaluate(x=>x.scrollWidth<=x.clientWidth+1),true);
 await page.screenshot({path:'/tmp/cardresell-grade-history.png'});
 await page.evaluate(()=>{window.googleUser={sub:'bob'};window._googleIdToken='bob'});
 await page.waitForFunction(()=>!document.getElementById('aiGradeHistoryDialog').open);
 check('account switch clears private content',await page.locator('[data-grade-content]').textContent(),'');
 await page.getByRole('button',{name:'View saved grades',exact:true}).click();await page.getByText('No saved grades yet.',{exact:false}).waitFor();
 check('new account sees own empty history',await page.getByText('Light corner wear',{exact:true}).count(),0);
 await context.close();
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(`${checks} checks passed`);process.exit(0);
