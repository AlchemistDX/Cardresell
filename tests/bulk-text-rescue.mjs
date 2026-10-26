// Run shipped Magic printed-name recovery with synthetic OCR/catalogue boundaries.
// No paid scans, network, inventory or billing writes.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parse} from 'acorn';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const src=fs.readFileSync(new URL('../'+html.match(/src="(\/js\/ui\.[a-f0-9]{8}\.js)"/)[1].slice(1),import.meta.url),'utf8');
const start=src.indexOf('const _BULK_TEXT_RESCUE'),end=src.indexOf('window._bulkTextRescueForTest',start);
assert(start>0&&end>start,'shipped recovery block');
const block=src.slice(start,src.indexOf('\n',end)+1);
let checks=0;
function check(label,actual,...expect){assert.deepEqual(actual,expect.length?expect[0]:true,label);checks++}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,1))}throw new Error('fixture did not advance')}
const hit=(name='Rubble Rouser',extra={})=>({id:'exact-printing',name,set:'tst',set_name:'Fixture set',collector_number:'128',rarity:'common',lang:'en',games:['paper'],finishes:['nonfoil','foil'],prices:{usd:'0.12',usd_foil:'8.00'},image_uris:{normal:'https://cards.scryfall.io/normal/front/fixture.jpg'},...extra});
const seed=extra=>({success:true,cardType:'mtg',setCode:'TST',rowId:'r0',...extra});
const miss=(file='rub',rowId='r1')=>({success:false,definiteMiss:true,file,rowId,error:'Could not identify card'});
function harness(options={}){
 const {texts={rub:'Rubble Rouser'},results=[seed(),miss()],scry=()=>hit(),timeouts={}}=options;
 const log={fetches:[],loads:0,workers:0,reads:0,updates:[],toasts:[],terminated:0,prices:0,strips:[],closed:0};
 const win={_bulkResults:results,_bulkQueue:[],_fbAuth:{currentUser:{uid:'fixture'}},Tesseract:null};
 const worker={setParameters:async()=>{},terminate:async()=>{log.terminated++},recognize:async strip=>{
   log.reads++;return options.recognize?options.recognize(strip,win,log):{data:{text:texts[strip.file]||''}};
 }};
 const reader={createWorker:async()=>{log.workers++;return options.createWorker?options.createWorker(worker,win):worker}};
 const canvas=()=>{const c={width:0,height:0};c.getContext=()=>({drawImage(b,...args){c.file=b.file;c.crop=args;log.strips.push(c)},putImageData(){},getImageData:()=>({data:new Uint8ClampedArray([10,20,30,255,200,210,220,255])})});return c};
 const ctx={window:win,console,URL,AbortController,clearTimeout,clearInterval,WeakMap,
  setTimeout:(f,ms)=>setTimeout(f,timeouts[ms]??(ms===120?0:ms)),setInterval:(f,ms)=>setInterval(f,Math.min(ms,10)),
  document:{createElement:t=>t==='script'?{remove(){}}:canvas(),head:{appendChild(s){log.loads++;if(options.loadFailure)return queueMicrotask(()=>s.onerror?.());if(options.loadPending)return;queueMicrotask(()=>{win.Tesseract=reader;s.onload?.()})}},getElementById:()=>null},
  createImageBitmap:async file=>{if(options.bitmap)await options.bitmap(file);return {file,width:500,height:700,close(){log.closed++}}},
  fetch:async(url,opts)=>{log.fetches.push({url,opts});const q=new URL(url),card=await scry(q.searchParams.get('fuzzy'),q.searchParams.get('set'),win,log);return options.response?options.response(card):{ok:!!card,status:card?200:404,json:async()=>card}},
  _bulkFetchPrice:async()=>{log.prices++;throw new Error('Must not switch printing with another price lookup')},
  _bulkUpdateRow:(id,row)=>log.updates.push([id,row.cardName]),_bulkRefreshResultSummary(){},
  _bulkDetectDuplicates(){},_bulkDraftSyncSelectionUI(){},showToast:m=>log.toasts.push(m)};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../js/scan-finish.js',import.meta.url),'utf8'),ctx);vm.runInContext(block,ctx);
 return {ctx,win,log,worker,results,api:win._bulkTextRescueForTest};
}
{
 const {api}=harness();
 for(const [read,name,expected] of [['Rubble Rouser 3','Rubble Rouser',true],['Sneerine Shadewriter','Sneering Shadewriter',true],["f Killian's Confidence XZ","Killian's Confidence",true],['Elite Interceptor','Elite Interceptor // Rejoinder',true],['Beast ala aaa','Ravenous Beast',false],['Chaco Rene mt enna','Chase Inspiration',false],['','Rubble Rouser',false]])check('spelling acceptance: '+read,api.accepts(read,name),expected);
 check('short noise lines dropped',api.reads('ee) | |\n( Killian\'s Confidence *32\nx').length,1);
}
{
 const results=[seed(),{...miss(),condition:'LP',conditionChosen:true,copyUids:['physical'],acquisitionCost:1.25,location:'Box A'},miss('sne','r2'),miss('bad','r3')];
 const h=harness({results,texts:{rub:'Rubble Rouser 3',sne:'Sneerine Shadewriter',bad:'Beast ala aaa'},scry:read=>read.includes('Shadewriter')?hit('Sneering Shadewriter',{id:'second',collector_number:'101'}):read.includes('Beast')?hit('Ravenous Beast'):hit()});
 check('two close names rescued',await h.api.run(),2);
 check('printing identity preserved',[results[1].groundedId,results[1].cardName,results[1].setCode,results[1].cardNumber],['exact-printing','Rubble Rouser','tst','128']);
 check('labelled for seller review',[results[1].textRescue,results[1].definiteMiss,results[1].error],[true,false,'']);
 check('exact printing price and artwork',[results[1].marketPrice,results[1].imageUrl],[.12,hit().image_uris.normal]);
 check('no second fuzzy price lookup',h.log.prices,0);
 check('condition, cost, location and physical IDs retained',[results[1].condition,results[1].conditionChosen,results[1].copyUids,results[1].acquisitionCost,results[1].location],['LP',true,['physical'],1.25,'Box A']);
 check('base finish estimated without inventing foil',[results[1].finishKey,results[1].finishConfirmed,results[1].finishEstimated,results[1].foilHint,results[1].finishReviewRequired],['usd',false,true,'',false]);
 check('loose match rejected',results[3].success,false);
 check('only batch set queried',h.log.fetches.every(f=>new URL(f.url).searchParams.get('set')==='tst'));
 check('public catalogue never receives auth',h.log.fetches.every(f=>f.opts.credentials==='omit'&&!f.opts.headers.Authorization));
 check('seller told to check recovered matches',h.log.toasts.length===1&&h.log.toasts[0].includes('check them'));
 check('worker and decoded bitmaps released',h.log.terminated===1&&h.log.closed===h.log.reads);
 check('finished strips released',h.log.strips.every(s=>s.width===1&&s.height===1));
 check('same set/photo not retried',await h.api.run(),0);
}
for(const [label,extra] of [['wrong set',{set:'other'}],['foreign language',{lang:'ja'}],['digital only',{games:['arena']}],['missing ID',{id:''}],['missing number',{collector_number:''}],['unrelated name',{name:'Ravenous Beast'}]]){
 const h=harness({scry:()=>hit('Rubble Rouser',extra)});
 check('reject '+label,await h.api.run(),0);check(label+' leaves row unresolved',h.results[1].success,false);
 check(label+' repeated OCR query deduplicated',h.log.fetches.length,1);
}
{
 const h=harness({scry:()=>hit('Rubble Rouser',{prices:{usd:null,usd_foil:'50'},image_uris:{normal:'javascript:alert(1)'},purchase_uris:{tcgplayer:'https://evil.example/'}})});await h.api.run();
 check('missing base price never takes expensive foil',[h.results[1].marketPrice,h.results[1].finishKey],[null,'usd']);
 check('unsafe remote links excluded',[h.results[1].imageUrl,h.results[1].tcgplayerUrl],['','']);
}
for(const type of ['pokemon','zero','uncertain','recovered']){
 const first=type==='zero'?miss('first','r0'):seed(type==='pokemon'?{cardType:'pokemon'}:type==='uncertain'?{providerNeedsReview:true}:{textRescue:true});
 const h=harness({results:[first,miss()]});
 check(type+' cannot supply a trusted Magic set',await h.api.run(),0);check(type+' does not load worker',h.log.loads,0);
 if(type==='zero') {Object.assign(first,seed({manualIdentity:true}));check('seller confirmation unlocks zero-match page',await h.api.run(),1)}
}
for(const extra of [{scanGameHint:'pokemon'},{providerNeedsReview:true}]){
 const h=harness({results:[seed(),{...miss(),...extra}]});
 check('other games and pending choices do not enter Magic set recovery',await h.api.run(),0);
 check('excluded row does not load OCR',h.log.loads,0);
}
// The set supplied later must not be blocked by a miss against an earlier set.
{
 const h=harness({scry:(_read,set)=>set==='new'?hit('Rubble Rouser',{set:'new'}):null});await h.api.run();
 h.results.push(seed({setCode:'new',manualIdentity:true}));check('new trusted set retries previous miss',await h.api.run(),1);
 check('previously searched set is not repeated',h.log.fetches.map(f=>new URL(f.url).searchParams.get('set')),['tst','new']);
}
// Every mutation happens while a real asynchronous catalogue response is pending.
for(const kind of ['account','queue','results','removed','file','saved','drafting','processing','rescanning','photo-check','replacement','editing','already-rescued']){
 const gate=deferred(),h=harness({scry:async()=>{await gate.promise;return hit()}}),row=h.results[1],run=h.api.run();await until(()=>h.log.fetches.length);
 if(kind==='account')h.win._fbAuth.currentUser={uid:'other'};
 if(kind==='queue')h.win._bulkQueue=[];
 if(kind==='results')h.win._bulkResults=[];
 if(kind==='removed')h.results.splice(1,1);
 if(kind==='file')row.file='replacement';
 if(kind==='saved')h.win._bulkSaved=true;
 if(kind==='drafting')h.win._bulkDraftBusy=true;
 if(kind==='processing')h.win._bulkProcessing=true;
 if(kind==='rescanning')row._rescanning=true;
 if(kind==='photo-check')row._photoChecking=true;
 if(kind==='replacement')row._replacementPhoto={};
 if(kind==='editing')h.win.CardResellBulkLookup={isEditing:r=>r===row};
 if(kind==='already-rescued'){row.success=true;row.cardName='Seller choice'}
 gate.resolve();await run;
 check('late result cannot replace '+kind,row.groundedId,undefined);
 check('worker released after '+kind,h.log.terminated,1);
}
{
 const gate=deferred(),h=harness({recognize:async()=>{await gate.promise;return {data:{text:'Rubble Rouser'}}}});
 const first=h.api.run(),second=h.api.run();check('concurrent triggers share one job',first===second);
 await until(()=>h.log.reads);h.api.cancel();check('Stop resolves pending run',await first,0);
 gate.resolve();check('one worker, terminated by Stop',[h.log.workers,h.log.terminated],[1,1]);check('Stop does not claim failure',h.log.toasts,[]);
}
{
 const gate=deferred(),h=harness({createWorker:async w=>{await gate.promise;return w}}),run=h.api.run();await until(()=>h.log.workers);h.api.cancel();await run;gate.resolve();await until(()=>h.log.terminated);
 check('worker arriving after close terminated',h.log.terminated,1);check('late startup cannot read photos',h.log.reads,0);
}
{
 const gate=deferred(),h=harness({bitmap:()=>gate.promise}),run=h.api.run();await until(()=>h.log.workers);await new Promise(r=>setTimeout(r,5));h.api.cancel();await run;gate.resolve();await until(()=>h.log.closed);
 check('late decoder cannot call terminated worker',h.log.reads,0);check('late strip released',h.log.strips.every(s=>s.width===1));
}
{
 const h=harness({results:[seed(),miss(),miss('next','r2')],recognize:()=>new Promise(()=>{}),timeouts:{10000:20}});
 check('stalled OCR is bounded',await h.api.run(),0);check('no overlapping reads after timeout',[h.log.reads,h.log.terminated],[1,1]);
 check('timeout remains recoverable',!h.results[1].textRescueTried&&!h.results[2].textRescueTried);
 check('timeout feedback visible',h.log.toasts.some(s=>s.includes('could not finish')));
}
for(const option of [{loadFailure:true},{loadPending:true,timeouts:{15000:20}},{createWorker:()=>new Promise(()=>{}),timeouts:{20000:20}},{response:()=>({ok:false,status:503})}]){
 const h=harness(option);check('unavailable dependency exits recoverably',await h.api.run(),0);check('dependency error does not mark permanent miss',!h.results[1].textRescueTried);
}
{
 const gate=deferred(),h=harness({scry:async(_read,set)=>{if(set==='tst'){await gate.promise;return null}return hit('Rubble Rouser',{set})}}),run=h.api.run();await until(()=>h.log.fetches.length);
 h.results.push(seed({setCode:'new',manualIdentity:true}));h.api.run();gate.resolve();check('new set during active job is processed afterward',await run,1);
 check('new set never starts overlapping workers',[h.log.workers,h.log.terminated],[2,2]);
}
{
 const node=parse(src,{ecmaVersion:'latest'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='_bulkFinishQueue');
 assert(node,'shipped batch completion function');
 for(const stopped of [false,true]){
  const gate=deferred(),calls=[];
  const window={_bulkResults:[],_bulkQueue:[],_fbAuth:{currentUser:{uid:'fixture'}},CardResellScanTextRecovery:{recoverBatch:()=>calls.push('general')}};
  const context={window,document:{getElementById:()=>({style:{}})},_bulkResetBottomBarButtons(){},_bulkRefreshResultSummary(){},_bulkDetectDuplicates(){},_bulkDraftSyncSelectionUI(){},_bulkTextRescueMisses:()=>{calls.push('same-set');return gate.promise}};
  vm.createContext(context);vm.runInContext(src.slice(node.start,node.end),context);context._bulkFinishQueue(2);
  check('batch completion starts same-set recovery',calls,['same-set']);
  if(stopped)window._bulkRecoveryStopEpoch=1;
  gate.resolve();await new Promise(r=>setImmediate(r));
  check(stopped?'Stop prevents the next recovery stage':'completed recovery attempts general names',calls,stopped?['same-set']:['same-set','general']);
 }
}
check('row clearly labels printed-name recovery',src.includes('Matched from the printed name. Please check it.'));
check('seller rename clears recovery note',/result\.cardName = trimmed;[\s\S]{0,200}result\.textRescue = false;/.test(src));
console.log(`bulk-text-rescue: ${checks} passed, 0 failed -- SUITE COMPLETE, exit=0`);
