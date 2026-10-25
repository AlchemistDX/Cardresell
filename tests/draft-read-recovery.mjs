// Exercise the shipped draft controllers with deliberately delayed boundaries.
// Browser/API envelope coverage lives in draft-read-workflow-browser.mjs.
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {resolve} from 'node:path';
import {harness} from './_assert.mjs';
const root=process.env.CARDRESELL_TEST_ROOT||resolve(new URL('..',import.meta.url).pathname);
const html=fs.readFileSync(root+'/index.html','utf8');
const core=fs.readFileSync(root+'/'+html.match(/js\/core\.[a-f0-9]{8}\.js/)[0],'utf8');
const ast=parse(core,{ecmaVersion:'latest'}),t=harness('draft-read-recovery');
const names=new Set(['_draftReadSession','_draftReadRequest','_draftReadFailure','_syncDraftWorkflowSession','_draftsFetch','_draftsAbsorb','loadDraftsFirstPage','loadDraftsNextPage','_reviewFetch','loadDraftReview','_reviewRefreshPacket','_reviewClearPacket','_draftEditSave','_draftEditReload','_photoUiSync','_photoUiReset','_draftThumbsSync']);
const vars=new Set(['_draftsState','_reviewState','_draftReviewQueue','_reviewLoadSequence','_draftsLoadSequence','_draftWorkflowSession','_photoUi','_draftThumbs','_draftThumbScan']);
names.add('_draftDeleteRun');
const source=ast.body.filter(n=>n.type==='FunctionDeclaration'?names.has(n.id.name):n.type==='VariableDeclaration'&&n.declarations.some(d=>vars.has(d.id.name))).map(n=>core.slice(n.start,n.end)).join('\n');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const reply=(body,status=200)=>({status,json:async()=>body});
const row=id=>({draftId:id,summary:{title:id,slot:'ebay:fixed-price',rev:1}});
const list=(id,cursor=null)=>({rows:[row(id)],total:1,nextCursor:cursor});
const draft=id=>({draft:{draftId:id,rev:1,title:id}});
async function settle(p){return Promise.race([p.then(()=>true,()=>false),delay(100).then(()=>false)]);}
function fixture(){
 const c={console,URLSearchParams,AbortController,Set,Map,setTimeout:(fn,ms)=>setTimeout(fn,ms===15000?25:ms),clearTimeout,
  googleUser:{uid:'alice',sub:'alice'},_fbCurrentUser:{uid:'alice'},DRAFTS_PAGE_LIMIT:25,
  document:{getElementById:()=>null},paint:0,toasts:[],_draftsPaint(){c.paint++},_reviewPaint(){c.paint++},
  _reviewAbsorb(r){c.reviewReplies.push(r);if(r.status===200)c.rs.draft=r.body.draft;},reviewReplies:[],
  _photoRevokeUrls(){},_photoBlockPaint(){c.photoPaint++},photoPaint:0,photosList:async()=>({photos:[]}),photoStorageFailureMessage:()=> 'Local storage unavailable',
  URL:{createObjectURL(){c.blobs++;return 'blob:fixture'},revokeObjectURL(){}},blobs:0,
  _draftThumbsClear(){c.thumbs?.clear()},_crUpdateSectionCounts(){},_crPricingContext:()=>({}),_crIdemKey:()=> 'fixture-key',
  _draftEditSyncFromDom(){},_draftRowById:()=>row('drf_one'),_draftEditIdemKey:()=> 'fixture-edit',
  _draftEditSaved(){c.saved++},_draftEditGone(){c.gone++},saved:0,gone:0,
  _draftEditReconcile:async()=>({outcome:'saved',draft:draft('drf_one').draft}),
  _deleteHostedForDraft(){c.cleanup++},_crNoteRowGone(){c.rowGone++},cleanup:0,rowGone:0,
  _reviewRefreshErrCopy:()=>({text:'Refresh unavailable'}),showToast:m=>c.toasts.push(m),
  _crIdToken:async()=> 'fixture-alice',fetch:async()=>reply(list('ready'))};
 c.window=c;vm.createContext(c);vm.runInContext(source+'\nwindow.ds=_draftsState;window.rs=_reviewState;window.ps=_photoUi;window.thumbs=_draftThumbs;',c);return c;
}
{
 const c=fixture(),old=deferred();let n=0;c.fetch=()=>++n===1?old.promise:Promise.resolve(reply(list('new')));
 const pending=c.loadDraftsFirstPage('old');await delay(1);await c.loadDraftsFirstPage('new');old.resolve(reply(list('old')));await pending;
 t.check('newer first-page results win over a late earlier page',c.ds.rows[0]?.draftId==='new'&&c.ds.focusId==='new');
}
{
 const c=fixture();c.ds.rows=[row('old')];c.ds.cursor=25;const late=deferred();let n=0;c.fetch=()=>++n===1?late.promise:Promise.resolve(reply(list('new')));
 const pending=c.loadDraftsNextPage();await delay(1);await c.loadDraftsFirstPage();late.resolve(reply(list('old-next')));await pending;
 t.check('late pagination cannot append to a newer list',c.ds.rows.length===1&&c.ds.rows[0].draftId==='new');
}
for(const mode of ['fetch','body','token']){
 const c=fixture(),late=deferred();let hits=0;
 c.fetch=async()=>{hits++;return mode==='fetch'?late.promise:mode==='body'?{status:200,json:()=>late.promise}:reply(list('retry'));};
 if(mode==='token')c._crIdToken=()=>late.promise;
 const done=await settle(c.loadDraftsFirstPage());
 t.check(mode+' stall leaves the loading state with a retry',done&&!c.ds.loading&&c.ds.error?.retryable===true);
 const paint=c.paint;late.resolve(mode==='fetch'?reply(list('late')):mode==='body'?list('late'):'late-token');await delay(5);
 t.check(mode+' late completion cannot repaint or send a new request',c.paint===paint&&(mode!=='token'||hits===0));
 c._crIdToken=async()=> 'fixture-alice';c.fetch=async()=>reply(list('retry'));await c.loadDraftsFirstPage();
 t.check(mode+' timeout allows a fresh retry',c.ds.rows[0]?.draftId==='retry'&&!c.ds.error);
}
for(const sameOwner of [false,true]){
 const c=fixture(),late=deferred();c.fetch=()=>late.promise;const pending=c.loadDraftsFirstPage();await delay(1);
 const uid=sameOwner?'alice':'bob';c.googleUser={uid,sub:uid};c._fbCurrentUser={uid};late.resolve(reply(list('old-private')));await pending;
 t.check((sameOwner?'replacement session':'account switch')+' cannot absorb a previous session list',!c.ds.rows.length);
}
{
 const c=fixture(),late=deferred();let hits=0;c._crIdToken=()=>late.promise;c.fetch=async()=>{hits++;return reply(list('wrong'));};
 const p=c.loadDraftsFirstPage();await delay(1);c.googleUser={uid:'bob',sub:'bob'};late.resolve('retired-token');await p;
 t.check('a changed account cannot send a request after delayed auth',hits===0);
}
{
 const c=fixture(),late=deferred();let hits=0;c.fetch=async()=>{hits++;return late.promise};
 const p=c.loadDraftsFirstPage('invalid');await delay(1);c.googleUser={uid:'bob',sub:'bob'};
 late.resolve(reply({code:'LIST_FOCUS_INVALID'},400));await p;
 t.check('retired focus failure cannot trigger a fallback request',hits===1);
}
{
 const c=fixture();c.ds.rows=[row('private')];c.ds.total=12;c.ds.usage={active:12};c.ds.cursor=25;c.fetch=async()=>reply({},401);await c.loadDraftsNextPage();
 t.check('pagination auth failure removes private rows and counts',!c.ds.signedIn&&!c.ds.rows.length&&c.ds.total===null&&c.ds.usage===null);
}
{
 const c=fixture();c.ds.rows=[row('saved')];c.ds.cursor=25;c.fetch=async()=>{throw Error('offline')};await c.loadDraftsNextPage();
 t.check('failed pagination retains loaded work and retry cursor',c.ds.rows[0]?.draftId==='saved'&&c.ds.cursor===25&&!c.ds.loading);
}
for(const body of [{},null,{rows:'invalid'}]){
 const c=fixture();c.fetch=async()=>reply(body);await c.loadDraftsFirstPage();
 t.check('malformed successful list is a retryable failure: '+JSON.stringify(body),!!c.ds.error?.retryable&&!c.ds.rows.length);
}
{
 const c=fixture();c.fetch=async()=>({status:200,json:async()=>{throw Error('truncated JSON')}});await c.loadDraftsFirstPage();
 t.check('truncated successful JSON cannot look like an empty collection',!!c.ds.error?.retryable);
}
for(const mode of ['fetch','body']){
 const c=fixture(),late=deferred();c.fetch=async()=>mode==='fetch'?late.promise:{status:200,json:()=>late.promise};
 const done=await settle(c.loadDraftReview('drf_one'));
 t.check('review '+mode+' stall stops loading with recoverable error',done&&!c.rs.loading&&c.reviewReplies.at(-1)?.status===0);
 const count=c.reviewReplies.length;late.resolve(mode==='fetch'?reply(draft('drf_one')):draft('drf_one'));await delay(5);
 t.check('review '+mode+' late result stays withdrawn',c.reviewReplies.length===count&&!c.rs.draft);
}
{
 const c=fixture();c.fetch=async()=>reply(draft('drf_other'));await c.loadDraftReview('drf_one');
 t.check('review refuses another draft in a successful response',!c.rs.draft&&c.reviewReplies.at(-1)?.status===0);
}
{
 const c=fixture(),late=deferred();c.fetch=()=>late.promise;const pending=c.loadDraftReview('drf_one');await delay(1);
 c.googleUser={uid:'alice',sub:'alice'};c._fbCurrentUser={uid:'alice'};late.resolve(reply(draft('drf_one')));await pending;
 t.check('review binds to the actual session even for the same UID',!c.rs.draft);
}
{
 const c=fixture(),late=deferred();c.rs.draftId='drf_one';c.rs.draft=draft('drf_one').draft;c.fetch=()=>late.promise;
 const p=c._reviewRefreshPacket();await delay(1);c.fetch=async()=>reply(draft('drf_two'));await c.loadDraftReview('drf_two');late.resolve(reply({}));await p;
 t.check('late refresh cannot reopen an earlier draft',c.rs.draftId==='drf_two'&&c.rs.draft?.draftId==='drf_two');
}
{
 const c=fixture();c.ds.rows=[row('private')];c.ds.total=3;c.ds.usage={active:3};c.ds.edit={draftId:'private'};c.rs.draftId='private';c.rs.draft={title:'Private'};c.rs.packet={title:'Private packet'};
 c._syncDraftWorkflowSession?.();c.googleUser=null;c._fbCurrentUser=null;c._syncDraftWorkflowSession?.();
 t.check('account reset removes draft details, counts and actions',!c.ds.rows.length&&c.ds.total===null&&!c.ds.edit&&!c.rs.draft&&!c.rs.packet&&!c.rs.draftId);
}
for(const mode of ['save','reload']){
 const c=fixture(),late=deferred();c.ds.edit={draftId:'drf_one',rev:1,busy:false,draft:{title:'Changed title',price:'12'}};c.fetch=()=>late.promise;
 const p=mode==='save'?c._draftEditSave('drf_one'):c._draftEditReload('drf_one');await delay(1);
 const next=c.ds.edit={draftId:'drf_two',rev:1,busy:true,draft:{title:'Next title',price:'20'}};
 late.resolve(reply(draft('drf_one')));await p;
 t.check('late '+mode+' cannot close or change a newer editor',c.ds.edit===next&&next.busy&&c.saved===0&&c.gone===0);
}
{
 const c=fixture(),late=deferred();let hits=0;c.ds.edit={draftId:'drf_one',rev:1,busy:false,draft:{title:'Changed title',price:'12'}};c._crIdToken=()=>late.promise;c.fetch=async()=>{hits++;return reply({});};
 const p=c._draftEditSave('drf_one');await delay(1);c.googleUser={uid:'bob',sub:'bob'};late.resolve('old-token');await p;
 t.check('retired editor cannot submit after delayed authentication',hits===0);
}
for(const rejected of [false,true]){
 const c=fixture(),late=deferred();c._photoUiReset('drf_one');c.photosList=()=>rejected?late.promise.then(()=>{throw Error('old read failed')}):late.promise;
 const p=c._photoUiSync();await delay(1);c._photoUiReset('drf_two');late.resolve({photos:[{id:'old',blob:{}}]});await p;
 t.check('late photo '+(rejected?'failure':'success')+' cannot update another draft',c.ps.draftId==='drf_two'&&!c.ps.loaded&&!c.ps.status&&!c.ps.photos.length&&c.blobs===0&&c.photoPaint===0);
}
{
 const c=fixture(),late=deferred();c.ds.rows=[row('private')];c.photosList=()=>late.promise;const p=c._draftThumbsSync();await delay(1);c.googleUser={uid:'bob',sub:'bob'};late.resolve({photos:[{id:'old',blob:{}}]});await p;
 t.check('old account thumbnail read creates no blob or cached image',c.blobs===0&&c.thumbs.size===0);
}
{
 const c=fixture();let hits=0;c.fetch=async()=>{hits++;return hits===1?reply({code:'LIST_FOCUS_INVALID'},400):reply(list('recovered'))};await c.loadDraftsFirstPage('bad-focus');
 t.check('current-session invalid focus recovers with one plain list read',hits===2&&c.ds.rows[0]?.draftId==='recovered'&&c.ds.focusId===null);
}
for(const mode of ['token','response']){
 const c=fixture(),late=deferred();let writes=0,gone=0;
 c._crIdToken=()=>mode==='token'?late.promise:Promise.resolve('fixture-token');
 c.fetch=async()=>{writes++;return mode==='response'?late.promise:reply({});};
 const p=c._draftDeleteRun({draftId:'drf_one',rev:1,instanceId:'copy-one',ui:{working(){},error(){},gone(){gone++}}});
 await delay(1);c.googleUser={uid:'bob',sub:'bob'};late.resolve(mode==='token'?'old-token':reply({}));await p;
 t.check('retired delete '+mode+' cannot update or clean up another session',gone===0&&c.cleanup===0&&c.rowGone===0&&(mode!=='token'||writes===0));
}
{
 const c=fixture();let gone=0;c.fetch=async()=>reply({generation:1});
 await c._draftDeleteRun({draftId:'drf_one',rev:1,instanceId:'copy-one',ui:{working(){},error(){},gone(){gone++}}});
 t.check('current delete still records completion and cleans up its own photos',gone===1&&c.cleanup===1&&c.rowGone===1);
}
t.done();
