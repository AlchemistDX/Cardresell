/* Dormant review integration. Imported by isolated browser acceptance only.
 * Auth is the SDK-bound adapter, not window.googleUser. No Collection, draft,
 * provider or billing mutation is reachable from this review screen. */
import {openWorkflowStore} from './seller-workflow-store.mjs';
import {captureScanSelection, prepareScanSession} from './seller-workflow-scan.mjs';
import {serializeSession} from './seller-workflow.mjs';

const explanations = {
  WORKFLOW_SIGN_IN_REQUIRED:'Sign in to review saved batches.',
  WORKFLOW_ACCOUNT_CHANGED:'Your account changed. Reopen batches for the current account.',
  WORKFLOW_AUTH_UNCONFIRMED:'Your sign-in could not be confirmed. Sign in again.',
  WORKFLOW_REVISION_CONFLICT:'This batch changed in another tab. Reload it before reviewing again.',
  WORKFLOW_STORAGE_FULL:'Device storage is full. Your previous saved batch is unchanged.',
  WORKFLOW_STORAGE_FAILED:'This change could not be saved on this device. Your previous saved batch is unchanged.',
  WORKFLOW_SESSION_CAPACITY:'This device has reached its saved-batch limit. Existing batches remain available.',
  WORKFLOW_COPY_ALREADY_ASSIGNED:'These physical copies already belong to a saved batch. Resume that batch.',
  WORKFLOW_SELECTION_CHANGED:'This scan selection changed. Resume and review the original saved batch.',
  WORKFLOW_REVIEW_REQUIRED:'Review this copy before continuing.'
};
const message = e => explanations[e?.message] || 'The batch could not be opened or updated. Its saved record has been preserved.';
const money = cents => { const n=BigInt(cents); return `${n/100n}.${String(n%100n).padStart(2,'0')}`; };
const state = u => {
  const ops = Object.values(u.operations).filter(Boolean);
  if (ops.some(op => ['pending','uncertain','blocked'].includes(op.state))) return 'Needs recovery';
  if (u.operations.draft?.state === 'confirmed') return 'Draft ready';
  if (u.operations.save?.state === 'confirmed') return 'Collection confirmed';
  return u.review === 'confirmed' ? 'Reviewed on this device' : 'Needs review';
};
const fields = [['name','Card name'],['game','Game'],['setName','Set'],['setCode','Set code'],
  ['number','Card number'],['language','Language'],['variant','Finish / variant'],
  ['condition','Condition'],['grader','Grader'],['grade','Grade']];

export function mountWorkflowReview({root, auth, copyUids, rowToCard, newId,
  now = Date.now, openStore = openWorkflowStore, databaseName, onExport}) {
  const document = root.ownerDocument;
  let generation = 0, principal = null, store = null, session = null, busy = false, closed = false, offset = 0;
  const el = (tag, text, parent, attrs = {}) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    parent?.append(node); return node;
  };
  const clear = () => { root.replaceChildren(); root.classList.add('seller-workflow-review'); };
  const alert = text => { const node = el('p',text,root,{role:'alert'}); node.className='workflow-notice'; };
  const invalidate = () => {
    generation++; store?.close(); store = null; principal = null; session = null; busy = false; offset = 0;
    if (!closed) { clear(); root.removeAttribute('aria-busy'); alert(explanations.WORKFLOW_ACCOUNT_CHANGED); }
  };
  const unsubscribe = auth.subscribe(invalidate);
  const assertCurrent = stamp => {
    if (closed || generation !== stamp || !auth.matches(principal)) throw new Error('WORKFLOW_ACCOUNT_CHANGED');
  };
  async function connect(stamp) {
    const verified = await auth.verify();
    if (closed || generation !== stamp || !auth.matches(verified)) throw new Error('WORKFLOW_ACCOUNT_CHANGED');
    principal = verified;
    const opened = await openStore({ownerId:verified.ownerId,getOwnerId:()=>auth.matches(verified)?verified.ownerId:null,databaseName});
    try { assertCurrent(stamp); } catch (e) { opened.close(); throw e; }
    store = opened;
  }
  async function work(run) {
    if (closed || busy) return;
    busy = true; root.setAttribute('aria-busy','true');
    for (const control of root.querySelectorAll('button,input')) control.disabled = true;
    const stamp = generation;
    try { await run(stamp); assertCurrent(stamp); }
    catch (error) {
      if (!closed && stamp === generation) {
        if (error.message === 'WORKFLOW_ACCOUNT_CHANGED') invalidate();
        else { paint(); alert(message(error)); }
      }
      return null;
    } finally {
      if (stamp === generation) { busy = false; root.removeAttribute('aria-busy'); }
    }
    return session;
  }
  const button = (label,parent,action) => { const node=el('button',label,parent,{type:'button'}); node.onclick=action; return node; };
  function paint() {
    clear(); root.removeAttribute('aria-busy');
    el('h2','Review saved batch',root);
    el('p','Saved on this device only. Account sync and listing preparation are not connected yet. Photos are not included; keep your original photos for reattachment.',root);
    if (!session) { button('Open saved batches',root,list); return; }
    const title=el('p',`${session.units.length} physical copies · Batch ${session.id}`,root); title.className='workflow-batch-title';
    const total=session.units.reduce((n,u)=>n+BigInt(u.costCents??0),0n),unknown=session.units.filter(u=>u.costCents===null).length;
    el('p',`Known purchase cost: $${money(total)}${unknown?` · ${unknown} ${unknown===1?'copy':'copies'} with unknown cost`:''}`,root);
    const toolbar=el('div',null,root);toolbar.className='workflow-toolbar';
    button('Saved batches',toolbar,list);
    button('Reload batch',toolbar,()=>resume(session.id));
    button('Export batch metadata',toolbar,()=>work(async stamp=>{
      // Read current state: never export a stale local revision after another tab saved.
      const fresh=await store.read(session.id);assertCurrent(stamp);
      if (!fresh) throw new Error('WORKFLOW_SESSION_NOT_FOUND');
      session=fresh;
      const data=serializeSession(fresh),filename=`cardresell-batch-${fresh.id}.json`;
      if(onExport)onExport({data,filename});
      else {
        const view=document.defaultView,url=view.URL.createObjectURL(new Blob([data],{type:'application/json'}));
        const link=el('a',null,root,{download:filename,href:url});link.click();link.remove();view.setTimeout(()=>view.URL.revokeObjectURL(url),1000);
      }
      paint();
    }));
    const units=el('div',null,root);units.className='workflow-units';
    for (const [index,u] of session.units.slice(offset,offset+25).entries()) {
      const item=el('article',null,units,{'data-copy-id':u.copyId});
      el('h3',`${offset+index+1}. ${u.card.name || 'Unidentified copy'}`,item);
      el('p',state(u),item,{'data-workflow-state':''});
      const locked=Object.values(u.operations).some(Boolean);
      if(locked) {el('p','This copy has a saved operation. Its identity and cost are locked until the result is reconciled.',item);continue;}
      const form=el('form',null,item),inputs={};
      for(const [key,label] of fields) {
        const wrap=el('label',label,form),input=el('input',null,wrap,{type:'text',maxlength:'200',name:key});
        input.value=u.card[key];inputs[key]=input;
      }
      const costWrap=el('label','Purchase cost ($) — blank means unknown',form);
      const cost=el('input',null,costWrap,{type:'text',inputmode:'decimal',name:'cost',maxlength:'20'});cost.value=u.costCents===null?'':money(u.costCents);
      const confirmWrap=el('label',null,form),confirm=el('input',null,confirmWrap,{type:'checkbox',name:'confirmed'});
      confirmWrap.append(document.createTextNode(' I reviewed this exact printing and condition. Unknown details remain blank.'));
      confirm.checked=u.review==='confirmed';
      form.addEventListener('input',event=>{if(event.target!==confirm)confirm.checked=false;});
      el('button','Save review on this device',form,{type:'submit'});
      form.onsubmit=event=>{
        event.preventDefault();
        // Capture form and revision before disabling inputs / asynchronous work.
        const raw=cost.value.trim();
        if(raw!==''&&!/^\d+(?:\.\d{1,2})?$/.test(raw)){alert('Enter a nonnegative cost with at most two decimal places, or leave it blank.');return;}
        const [whole,fraction='']=raw.split('.');
        const cents=raw===''?null:Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
        if(cents!==null&&!Number.isSafeInteger(cents)){alert('Purchase cost is too large.');return;}
        const options={action:'review',revision:session.revision,copyId:u.copyId,now:Math.max(now(),session.updatedAt),
          patch:{card:Object.fromEntries(fields.map(([key])=>[key,inputs[key].value])),costCents:cents},confirmed:confirm.checked};
        work(async stamp=>{const updated=await store.transition(session.id,options);assertCurrent(stamp);session=updated;paint();});
      };
    }
    if(session.units.length>25){
      const paging=el('div',null,root);paging.className='workflow-toolbar';
      const previous=button('Previous copies',paging,()=>{offset=Math.max(0,offset-25);paint()});previous.disabled=offset===0;
      el('span',`${offset+1}–${Math.min(offset+25,session.units.length)} of ${session.units.length}`,paging);
      const next=button('Next copies',paging,()=>{offset+=25;paint()});next.disabled=offset+25>=session.units.length;
    }
  }
  function list() { return work(async stamp=>{
    if(!store)await connect(stamp);
    const records=await store.list();assertCurrent(stamp);session=null;clear();
    el('h2','Saved batches on this device',root);
    el('p','These batches are local to this browser and account. Clearing browser data or changing devices can make them unavailable.',root);
    if(!records.sessions.length)el('p','No saved batches.',root);
    for(const row of records.sessions)button(`${row.units.length} copies · ${row.id}`,root,()=>resume(row.id));
    if(records.damaged.length)alert(`${records.damaged.length} saved batch record(s) need recovery. They have not been deleted or replaced.`);
  }); }
  function resume(id) { return work(async stamp=>{
    if(!store)await connect(stamp);
    const record=await store.read(id);assertCurrent(stamp);
    if(!record)throw new Error('WORKFLOW_SESSION_NOT_FOUND');
    session=record;offset=0;paint();
  }); }
  function capture({rows,sessionId,costsByCopy}) {
    if(closed || busy)return Promise.resolve(null);
    // Snapshot real scanner metadata immediately, before token/storage awaits.
    let selection;
    try { selection=captureScanSelection({rows,copyUids,rowToCard,costsByCopy}); }
    catch(error){alert(message(error));return Promise.resolve(null);}
    return work(async stamp=>{
      if(!store)await connect(stamp);
      const prepared=await prepareScanSession({store,sessionId,selection,newCollectionId:newId,now:now()});
      assertCurrent(stamp);session=prepared;offset=0;paint();
    });
  }
  paint();
  return Object.freeze({list,resume,capture,close(){closed=true;unsubscribe();invalidate();root.replaceChildren();root.removeAttribute('aria-busy');}});
}
