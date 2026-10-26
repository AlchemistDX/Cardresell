import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {harness} from './_assert.mjs';
const root=process.env.CARDRESELL_TEST_ROOT||resolve(new URL('..',import.meta.url).pathname);
const t=harness('price-evidence'),check=(label,value)=>t.check(label,!!value);
const html=readFileSync(root+'/index.html','utf8'),core=readFileSync(root+'/'+html.match(/js\/core\.[a-f0-9]{8}\.js/)[0],'utf8');
if(!process.env.PRICE_MATCH_ONLY){
 const c={};c.window=c;vm.createContext(c);vm.runInContext(readFileSync(root+'/js/price-evidence.js','utf8'),c);
 const E=c.CardResellPriceEvidence,now=Date.parse('2026-10-25T12:00:00Z');
 const row={market:100,low:90,high:130,lowBasis:'tcgplayer',highBasis:'tcgplayer'};
 const input={row,key:'near_mint',condition:'nm',sourceUpdatedAt:'2026-10-24T12:00:00Z',now};
 const evidence=E.assess(input);
 check('dated exact-condition asking range survives',evidence.usableRange?.low===90&&evidence.usableRange?.high===130);
 check('asking choices use reported endpoints, not fixed percentages',JSON.stringify(E.tiers(evidence).map(t=>t.amt))==='[90,100,130]');
 check('asks are not described as completed sales',/not completed sales/.test(evidence.note));
 for(const [label,change] of [
  ['unknown source date',{sourceUpdatedAt:null}],['invalid calendar date',{sourceUpdatedAt:'2026-02-30T12:00:00Z'}],['missing row',{row:null}],['future source date',{sourceUpdatedAt:'2026-10-26'}],['stale source date',{sourceUpdatedAt:'2026-10-10'}],
  ['wrong condition',{condition:'lp'}],['condition-scaled estimate',{multiplier:.85}],['graded selection',{graded:true,key:'psa_10'}],
  ['mixed endpoint sources',{row:{...row,highBasis:'ebay-sold'}}],['calculated high',{row:{...row,highBasis:'derived'}}],
  ['clamped high',{row:{...row,highClamped:true}}],['reversed endpoints',{row:{...row,low:140}}],
  ['same endpoints',{row:{...row,low:130}}],['indistinguishable cents',{row:{...row,low:100.001,high:100.002}}],['sub-cent low',{row:{...row,low:.001,high:.05}}],['missing endpoint',{row:{...row,low:null}}],['infinite endpoint',{row:{...row,high:Infinity}}]
 ])check(label+' cannot supply observed asking choices',E.tiers(E.assess({...input,...change}))===null);
 const average=E.assess({...input,row:{market:100,ebaySalesAverage:{value:100,days:7}}});
 check('a seven-day average is one average, never a range',average.salesAverage.days===7&&!average.range);
 check('an average for another condition is withheld',!E.assess({...input,condition:'lp',row:{ebaySalesAverage:{value:100,days:7}}}).salesAverage);
 check('a reference outside the asking range is not an invented midpoint',E.tiers(E.assess({...input,row:{...row,market:200}})).length===2);
 check('a rounded reference cannot replace the actual listed high',JSON.stringify(E.tiers(E.assess({...input,row:{...row,market:100.119,low:100.11,high:100.12}})).map(t=>[t.id,t.amt]))==='[["ask-low",100.11],["ask-high",100.12]]');
 check('old observed endpoints retain their date and limitation',E.assess({...input,sourceUpdatedAt:'2026-10-10'}).stale&&/over 7 days/.test(E.assess({...input,sourceUpdatedAt:'2026-10-10'}).note));
}
const names=['_crTplAskEndpoints','_crTplSoldAverage','_crFinishLabel','tplCardToNormalized','fetchTPLGradedByNameNumber'];
const ast=parse(core,{ecmaVersion:'latest',sourceType:'script'}),source=ast.body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>core.slice(n.start,n.end)).join('\n');
const card=(id,name='Mew',number='76/214',set='Unbroken Bonds')=>({id,name,number,set_name:set,updated_at:'2026-10-24T12:00:00Z',prices:{graded:{psa:{10:{ebay:{avg_7d:100,avg_30d:160,avg_1d:80}}}}}});
function fixture(cards){const c={console,tplApiKey:'fixture',selectedCard:{name:'Mew',number:'76/214',setName:'Unbroken Bonds',game:'pokemon'},fetch:async()=>({ok:true,json:async()=>({data:cards})})};c.window=c;vm.createContext(c);vm.runInContext(source,c);return c;}
{
 const c=fixture([card('wrong','Other card'),card('right')]);const rows=await c.fetchTPLGradedByNameNumber('Mew','76/214','pokemon');
 check('a reused number cannot select a different card name',c.selectedCard.tplId==='right');
 check('graded averages never become low or high endpoints',rows?.[0]?.low===null&&rows?.[0]?.high===null);
 check('graded lookup retains average window and source timestamp',rows?.[0]?.ebaySalesAverage?.days===7&&rows?.[0]?.sourceUpdatedAt==='2026-10-24T12:00:00Z');
}
for(const [label,cards,number] of [
 ['different name symbols',[card('wrong','Mew ★')],'76/214'],
 ['different set',[card('wrong','Mew','76/214','Other set')],'76/214'],
 ['different denominator',[card('wrong','Mew','76/200')],'76/214'],
 ['ambiguous printing',[card('a'),card('b')],'76/214'],
 ['missing collector number',[card('a')],''],
 ['missing matching collector number',[card('wrong','Mew','77/214')],'76/214']
]){const c=fixture(cards);check(label+' is not guessed',await c.fetchTPLGradedByNameNumber('Mew',number,'pokemon')===null&&!c.selectedCard.tplId);}
{
 const c=fixture([card('a','Mew','076/214')]);check('equivalent leading zeros retain the exact printing',(await c.fetchTPLGradedByNameNumber('Mew','76/214','pokemon'))?.length===1);
}
{
 const c=fixture([card('a'),card('b')]);c.selectedCard.tplId='b';await c.fetchTPLGradedByNameNumber('Mew','76/214','pokemon');check('existing exact catalog ID resolves duplicate search hits',c.selectedCard.tplId==='b');
}
{
 const c=fixture([]);let release;c.fetch=()=>new Promise(r=>release=r);const pending=c.fetchTPLGradedByNameNumber('Mew','76/214','pokemon');c.selectedCard={name:'Mew',number:'76/214',setName:'Unbroken Bonds'};release({ok:true,json:async()=>({data:[card('a')]})});
 check('late graded lookup cannot rewrite the newly selected card',await pending===null&&!c.selectedCard.tplId);
}
{
 const c=fixture([{...card('wrong'),variant:'Holo'},{...card('right'),variant:'Reverse Holo'}]);
 c._crSellingSelection=()=>({finish:'Reverse Holofoil',requestKey:'reverse'});
 await c.fetchTPLGradedByNameNumber('Mew','76/214','pokemon');
 check('explicit selected finish cannot borrow another finish’s grade price',c.selectedCard.tplId==='right');
}
{
 const c=fixture([card('unknown')]);c._crSellingSelection=()=>({finish:'Reverse Holofoil',requestKey:'reverse'});
 check('unproven finish does not acquire a guessed graded price',await c.fetchTPLGradedByNameNumber('Mew','76/214','pokemon')===null&&!c.selectedCard.tplId);
}
{
 const c=fixture([{...card('normal'),variant:'normal'},{...card('reverse'),variant:'Reverse Holo'}]);
 c._crSellingSelection=()=>({finish:'Normal / non-foil',requestKey:'normal'});
 const rows=await c.fetchTPLGradedByNameNumber('Mew','76/214','pokemon');
 check('readable non-foil label still resolves its exact provider printing',c.selectedCard.tplId==='normal'&&rows?.[0]?.market===100);
 c._scanFinishLabel=()=> 'Normal / non-foil';
 check('catalogue identity retains the provider variant independently of its label',c.tplCardToNormalized({...card('normal'),variant:'normal'},'pokemon').catalogVariant==='normal');
}
{
 const c=fixture([]);let release,key='reverse';c._crSellingSelection=()=>({finish:'Reverse Holofoil',requestKey:key});c.fetch=()=>new Promise(r=>release=r);
 const pending=c.fetchTPLGradedByNameNumber('Mew','76/214','pokemon');key='holo';release({ok:true,json:async()=>({data:[{...card('a'),variant:'Reverse Holo'}]})});
 check('finish change during lookup cannot bind the old variant ID',await pending===null&&!c.selectedCard.tplId);
}
t.done();
