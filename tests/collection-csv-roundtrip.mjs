import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const root=process.env.CARDRESELL_TEST_ROOT||resolve(new URL('..',import.meta.url).pathname);
const {harness}=await import(pathToFileURL(root+'/tests/_assert.mjs'));
const t=harness('collection-csv-roundtrip');
const html=readFileSync(root+'/index.html','utf8');
const asset=name=>readFileSync(root+'/'+html.match(new RegExp('src="/(js/'+name+'\\.[a-f0-9]{8}\\.js)"'))[1],'utf8');
let cards=[],download='';
const c={TextEncoder,crypto:webcrypto,Map,Set,Date,JSON,loadPortData:()=>cards,showToast:()=>{},document:{createElement:()=>({click(){download=decodeURIComponent(this.href.split(',').slice(1).join(','))}})}};
c.window=c;vm.createContext(c);
vm.runInContext(['inventory-edits','inventory-recovery-policy','collection-import','collection-export'].map(asset).join('\n'),c);
const I=c.CardResellCollectionImport;
const plan=async(text,existing=[],history={},mode='skip')=>{const csv=I.parse(text);return I.plan(csv,I.autoMap(csv.headers),{mode,game:'mtg'},existing,history)};
const exportRows=rows=>{cards=rows;c.exportCollection();return download};
const identities=['+copy-1','-copy-2','@copy-3',"'+literal","'plain",'regular-copy'];
const originals=identities.map((id,i)=>({id,card:['=Fixture','+Wizard','@Card',"'=Printed","'Legend",'Plain'][i],
 set:'Strixhaven',setCode:'STX',number:'001',game:'mtg',buyPrice:i===0?0:null,currentValue:2,condition:'NM',
 location:'=Shelf',sku:i===0?"'SKU":'+stock-'+i,addedDate:'2026-10-25'}));
const before=JSON.stringify(originals),csv=exportRows(originals);
let result=await plan(csv,originals);
t.check('own export never creates extra copies in the same collection',result.copies===0&&result.skipped===originals.length);
result=await plan(csv);
t.check('export can restore every physical copy into an empty collection',result.errors.length===0&&result.copies===originals.length);
for(const [i,source] of originals.entries()){
 const restored=result.rows[i]?.entries[0];
 t.check('row '+i+' retains original ID and literal text',restored?.id===source.id&&restored?.card===source.card&&restored?.location===source.location&&restored?.sku===source.sku);
 t.check('row '+i+' retains set code and collector number',restored?.setCode===source.setCode&&restored?.number===source.number);
}
t.check('explicit zero and unknown cost remain different',result.rows[0]?.record.buyPrice===0&&result.rows[1]?.record.buyPrice===null);
t.check('export and planning never modify inventory',JSON.stringify(originals)===before);
const history={copy_sales_v1:{version:1,entries:originals.map((p,i)=>({copyId:p.id,saleId:'sale-'+i,recordedAt:1}))}};
result=await plan(csv,[],history);
t.check('spreadsheet escaping cannot resurrect a sold physical copy',result.copies===0&&result.skipped===originals.length);
result=await plan("Card,Game,Collection ID\n'+Printed,mtg,'+source");
t.check('unmarked third-party files retain literal apostrophes',result.rows[0]?.record.card==="'+Printed"&&result.rows[0]?.entries[0].id==="'+source");
const legacyExport=I.parse(exportRows([originals[0]]));
const oldCsv=[legacyExport.headers,...legacyExport.rows].map(row=>row.slice(0,-1).map(value=>'"'+value.replace(/"/g,'""')+'"').join(',')).join('\r\n');
result=await plan(oldCsv,originals);
t.check('older ambiguous escaped exports stop before duplicating a copy',result.errors.some(e=>/older CardResell export/.test(e))&&result.copies===0);
result=await plan('Card,Game,CardResell CSV Format\nWizard,mtg,999');
t.check('unsupported marked export cannot be silently reinterpreted',result.errors.length>0&&result.copies===0);
result=await plan('Card,Game,Set Code\nWizard,mtg,'+'x'.repeat(81));
t.check('set code length is bounded',result.errors.length>0);

// Fixed receipts captured from the shipped importer before it supported set
// codes. An unchanged older upload must not acquire new physical-copy IDs.
const legacyCsv='Card,Game,Set,Set Code,Card Number,Quantity\nFixture Wizard,mtg,Same set,STX,001,1\nFixture Wizard,mtg,Same set,M21,001,1';
const legacyKeys=[1,2].map(n=>'csv1:4c0e03e73cd674f158e3bd02ef3338037840d3b556b22e5b871d6a3ba4bcff7e:'+n+':0');
const legacy=legacyKeys.map((importKey,i)=>({id:'old-'+i,card:'Fixture Wizard',importKey}));
result=await plan(legacyCsv,legacy);
t.check('previously imported rows still skip when newly reading set codes',result.copies===0&&result.skipped===2);
const retired={copy_sales_v1:{version:1,entries:legacyKeys.map((key,i)=>({copyId:'imp_'+key.slice(5).replace(/:/g,'_'),saleId:'old-sale-'+i,recordedAt:1}))}};
result=await plan(legacyCsv,[],retired);
t.check('old sold import receipts remain retired after the schema fix',result.copies===0&&result.skipped===2);
result=await plan(legacyCsv);
t.check('different set codes retain separate identity receipts',result.copies===2&&result.rows[0]?.record.setCode==='STX'&&result.rows[1]?.record.setCode==='M21'&&result.rows[0]?.entries[0].importKey!==result.rows[1]?.entries[0].importKey);
const first=result.rows.flatMap(r=>r.entries).map((p,i)=>({...p,id:'new-'+i}));
result=await plan(legacyCsv,first);
t.check('updated imports are idempotent too',result.copies===0&&result.skipped===2);
result=await plan(legacyCsv,legacy,{},'new');
t.check('explicit new purchases can still add distinct physical copies',result.copies===2);
t.done();
