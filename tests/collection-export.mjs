import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {harness} from './_assert.mjs';
const t=harness('collection-export');
let cards=[],downloads=[],messages=[];
const context={window:{},loadPortData:()=>cards,showToast:m=>messages.push(m),document:{createElement:()=>({click(){downloads.push({href:this.href,name:this.download})}})}};
vm.runInNewContext(readFileSync(new URL('../js/collection-export.js',import.meta.url),'utf8'),context);
// Read quoted CSV independently, including quotes, commas and embedded newlines.
function parse(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&c===','){row.push(field);field='';}
  else if(!quoted&&c==='\r'&&text[i+1]==='\n'){row.push(field);rows.push(row);row=[];field='';i++;}
  else field+=c;
 }
 row.push(field);rows.push(row);return rows;
}
function output(){const text=decodeURIComponent(downloads.at(-1).href.split(',').slice(1).join(','));assert.equal(text[0],'\uFEFF');const [headers,...rows]=parse(text.slice(1));return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));}
cards=[{id:'copy-1',card:'Pikachu, "Birthday"\nピカチュウ',set:'Promo',buyPrice:10,currentValue:8,number:'001/025',game:'pokemon',setCode:'cel',condition:'LP',grader:'psa',grade:'9',cert:'00123',valueSource:'comp',finish:'holo',finishReviewRequired:true,finishConfirmed:false,addedDate:'2026-10-14',lastRefreshed:'2026-10-14T12:00:00Z'},
 {id:'copy-2',card:'Missing price',buyPrice:5,currentValue:null},
 {id:'copy-3',card:'Missing cost',buyPrice:null,currentValue:20},
 {id:'copy-4',card:'Known zero',buyPrice:0,currentValue:0},
 {id:'copy-5',card:'Legacy'},
 {id:'copy-6',card:'Invalid',buyPrice:'2',currentValue:-1},
 {id:'copy-7',card:'Manual',buyPrice:2,currentValue:3,valueSource:'seller'}];
const original=JSON.stringify(cards);context.window.exportCollection();let rows=output();
t.check('all physical copies export separately',rows.length===7&&rows.every(r=>r.Quantity==='1'));
t.check('CSV preserves commas, quotes, newlines and Unicode',rows[0].Card===cards[0].card);
t.check('negative gain stays numeric and reconciles',rows[0]['Unrealized P/L']==='-2.00'&&rows[0]['P/L %']==='-20.0');
t.check('identity and slab details survive',rows[0]['Card Number']==='001/025'&&rows[0].Game==='pokemon'&&rows[0].Condition==='LP'&&rows[0].Grade==='9'&&rows[0].Certificate==='00123');
t.check('finish assumption and refresh timestamp survive',rows[0]['Finish confirmed']==='No'&&rows[0]['Value Status'].includes('Finish needs review')&&rows[0]['Last Refreshed']===cards[0].lastRefreshed);
t.check('missing price never falls back to purchase cost',rows[1]['Current Value']===''&&rows[1]['Unrealized P/L']==='');
t.check('missing cost never becomes zero profit basis',rows[2]['Cost Basis']===''&&rows[2]['Unrealized P/L']===''&&rows[2]['P/L %']==='');
t.check('explicit zero is retained with no divide by zero',rows[3]['Cost Basis']==='0.00'&&rows[3]['Current Value']==='0.00'&&rows[3]['Unrealized P/L']==='0.00'&&rows[3]['P/L %']==='');
t.check('legacy and invalid values remain unknown',rows[4]['Current Value']===''&&rows[5]['Cost Basis']===''&&rows[5]['Current Value']==='');
t.check('source and scope distinguish estimates from realized profits',rows[0]['Value Source']==='Provider-derived saved estimate'&&rows[6]['Value Source']==='Seller-entered estimate'&&rows.every(r=>r['Profit Basis'].includes('before selling fees')&&r.Currency==='USD'));
t.check('export does not modify inventory',JSON.stringify(cards)===original);
context.window.exportCollection(['copy-1','copy-1','copy-3']);rows=output();
t.check('selected export contains exactly chosen physical copies',rows.length===2&&rows[0]['Collection ID']==='copy-1'&&rows[1]['Collection ID']==='copy-3'&&downloads.at(-1).name==='cardsell_collection_selected.csv');
cards[0].currentValue=11;context.window.exportCollection(['copy-1']);t.check('selected export reads the latest saved value',output()[0]['Current Value']==='11.00');
const before=downloads.length;
context.window.exportCollection(['gone']);context.window.exportCollection([]);cards.push({...cards[0]});context.window.exportCollection(['copy-1']);
t.check('missing ambiguous and empty selection cannot silently export all',downloads.length===before);
cards=[];context.window.exportCollection();cards=[null];context.window.exportCollection();cards={};context.window.exportCollection();
t.check('empty or unreadable collection does not create misleading files',downloads.length===before);
cards=['=1+1',' +SUM(1,2)','-bad','@SUM(1)','\tformula'].map((card,i)=>({id:i,card,set:'=1+1',currentValue:2,buyPrice:3}));
context.window.exportCollection();rows=output();
t.check('spreadsheet formula text is neutralized while negative money stays numeric',rows.every(r=>r.Card.startsWith("'")&&r.Set==="'=1+1"&&r['Unrealized P/L']==='-1.00'));
t.done();
