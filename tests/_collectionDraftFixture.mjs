import {parse} from 'acorn';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {referencedHashedAssets,ROOT} from './_assetRefs.mjs';
const html=readFileSync(join(ROOT,'index.html'),'utf8');
const core=readFileSync(referencedHashedAssets().find(a=>a.base==='core').path,'utf8');
const names=new Set(['renderCollectionView','_crBuildDraftPayload','_crCreateDraft','startListingDraftForEntry','_crResolveEntry','_crMatchesById','_crIdEq','_cardWithoutPhotoBytes','_scanPhotoSnapshot']);
const code=parse(core,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>core.slice(n.start,n.end)).join('\n');
const module=readFileSync(join(ROOT,'js/collection-drafts.js'),'utf8');
const batch=readFileSync(join(ROOT,'js/draft-batch.js'),'utf8');
const exporter=readFileSync(join(ROOT,'js/collection-export.js'),'utf8');
export const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window.googleUser={sub:'owner'};let data=JSON.parse(localStorage.getItem('fixture:cards')||'[]'),calls=[],manifests=[],opened=[],compared=[],downloads=[],attached=[],mode='ok',limit=10,deferHead,portReads=0;
HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,text:decodeURIComponent(this.href.split(',').slice(1).join(','))})};
window.CardResellSellingPlan={openCollection:cards=>compared=cards};
const _crCreateAttempt={},_crScanPhotoAttempt={},_crDraftState={},CR_D1_SLOT='ebay:fixed-price';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function loadPortData(){portReads++;return data}function _updateCollectionSignInWall(){}function _crBumpGen(){}function hydrateCollectionSellButtons(){}
function _crValueProvenance(p){return p.provenance}function _crPricingContext(){return {}}
async function attachScanPhotoToDraft(id,snapshot){attached.push({id,snapshot});return {reason:'ATTACHED'}}
async function _crIdToken(){return 'fixture'}function _crCreateIdemKey(a,b,c){return a+'_'+b+'_'+(_crDraftState[c]?.generation||0)}function _crNoteRowState(i,s){_crDraftState[i]=s}function _crNoteRowGone(i,s){_crDraftState[i]=s}function _crGoneCopy(){return {text:'Draft deleted. Select again to create a new draft.'}}
function showToast(){}function openDraftReview(id){opened.push(id)}function switchView(v){opened.push(v)}
async function _bulkDraftHeadroom(){if(deferHead)await new Promise(r=>window.finishHead=r);return {known:true,cap:25,total:0,free:25,bulkLimit:limit}}
async function fetchSellStamps(cards){return {ok:true,stamps:cards.map(p=>({eligible:!p.ineligible,message:'Add a card number.'}))}}
window.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);if(url.includes('action=batch')){manifests.push(body);return Response.json({id:body.id,count:body.rows.length})}calls.push({body,key:opts.headers['Idempotency-Key']});if(mode==='defer')await new Promise(r=>window.finishRequest=r);if(mode==='gone')return Response.json({code:'DRAFT_GENERATION_STALE',generation:1},{status:410});if(mode==='network')throw Error('lost response');if(mode==='malformed')return Response.json({});if(mode==='cap')return Response.json({code:'DRAFT_CAP_REACHED',error:'Draft capacity reached.'},{status:409});return Response.json({draftId:'drf_'+String(body.instanceId.replace('inst_col_','')).padStart(32,'0'),generation:0,existing:mode==='existing'},{status:mode==='existing'?200:201})};
${code}\n${exporter}\n${batch}\n${module}
function seed(list){data=list;localStorage.setItem('fixture:cards',JSON.stringify(list));document.getElementById('collectionView').style.display='block';document.getElementById('collectionWrap').closest('[style*="display: none"]')?.style.removeProperty('display');renderCollectionView()}
</script>`;
