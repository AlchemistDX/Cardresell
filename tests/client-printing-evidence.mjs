// Execute the shipped functions with isolated catalog, image and scan services.
// No provider requests, network access or customer credits.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parse } from 'acorn';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const source = readFileSync(new URL(html.match(/src="\/([^" ]*core\.[a-f0-9]+\.js)"/)[1], root), 'utf8');
const functions = new Map();
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration') functions.set(node.id.name, source.slice(node.start,node.end));
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach(walk);
    else if (child && typeof child === 'object') walk(child);
  }
}
walk(parse(source, {ecmaVersion:'latest'}));
const names = ['_clientPrintingText','_clientPrintingNumber','_clientPrintingGame','_clientPrintingMatches','_clientPrintingMatch','scanFile','processScanImage'];
const sandbox = { console:{log(){},warn(){},error(...x){throw new Error(x.join(' '))}}, performance,
  URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},
  Image:class{naturalWidth=900;naturalHeight=1200;set src(v){this.onload?.()}},
  detectCardBounds:()=>null,computePHash:()=> 'same',computeDHash:()=> 'same',
  hamming:(a,b)=>a===b?0:30,enrichCard:c=>c,compressImage:async()=> 'fixture',
  _validateScanFile:()=>null,_dialogOpened(){},maybeAutoSwitchGameFromScan(){},
  showScanGradeCTA(){},_persistLastIdentified(){},_scheduleScanAutoAdvance(){},
  esc:String,setTimeout(){},fetch:async()=>{throw new Error('Unexpected external fetch')}
};
const elements = new Map();
sandbox.document={getElementById(id){if(!elements.has(id))elements.set(id,{style:{},addEventListener(){}});return elements.get(id)},
  createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:[]})})})};
sandbox.window=sandbox;sandbox._setScanBtns = s=>sandbox.buttonState=s;
vm.createContext(sandbox);vm.runInContext(names.map(n=>{assert.ok(functions.has(n),n);return functions.get(n)}).join('\n'),sandbox);
let count=0;const check=(label,f)=>{f();count++;console.log('✓ '+label)};
const card={id:'base1-58',g:'pokemon',n:'Pikachu',nu:'58',s:'Base Set',sc:'base1',si:'base1',i:'fixture.jpg'};
const info={card_type:'pokemon',card_name:'Pikachu',card_number:'58',set_name:'Base Set',language:'en'};
check('exact name, number, set and game hydrate',()=>assert.equal(sandbox._clientPrintingMatch(info,[card]),card));
for(const [label,change] of Object.entries({missingSet:{set_name:''},unknownSet:{set_name:'Unknown'},wrongSet:{set_name:'Base Set 2'},missingNumber:{card_number:''},wrongNumber:{card_number:'59'},wrongName:{card_name:'Pikachu ex'},wrongGame:{card_type:'mtg'},japanese:{is_japanese:true},otherLanguage:{language:'fr'},unknownLanguage:{language:'unknown'},groundedConflict:{grounded_id:'other-id'},setCodeConflict:{set_code:'base2'}})) {
 check(label+' refuses local override',()=>assert.equal(sandbox._clientPrintingMatch({...info,...change},[card]),null));
}
check('matching grounded ID preserved',()=>assert.equal(sandbox._clientPrintingMatch({...info,grounded_id:card.id},[card]),card));
check('numeric zero padding and denominator normalize',()=>assert.equal(sandbox._clientPrintingMatch({...info,card_number:'0058/102'},[card]),card));
check('explicit set code matches',()=>assert.equal(sandbox._clientPrintingMatch({...info,set_name:'',set_code:'base1'},[card]),card));
for(const [left,right] of [['TG10','10'],['SV199','199'],['175p','175'],['Nidoran♀','Nidoran♂']]) {
 check(left+' differs from '+right,()=>assert.notEqual(left.startsWith('Nidoran')?sandbox._clientPrintingText(left):sandbox._clientPrintingNumber(left),left.startsWith('Nidoran')?sandbox._clientPrintingText(right):sandbox._clientPrintingNumber(right)));
}
check('duplicate printing records remain unresolved',()=>assert.equal(sandbox._clientPrintingMatch(info,[card,{...card,id:'other'}]),null));
check('missing actual printing cannot make sole name match exact',()=>assert.equal(sandbox._clientPrintingMatch({...info,set_name:'Absent set'},[card]),null));
check('Magic aliases accepted only with same printing details',()=>assert.equal(sandbox._clientPrintingMatch({...info,card_type:'magic'},[{...card,g:'mtg'}])?.id,card.id));
sandbox.loadCardIndex=async()=>[{...card,p:'same',d:'same'},{...card,id:'far',p:'different',d:'different'}];
const perfect=await sandbox.scanFile({});
check('zero-distance artwork with huge gap never accepts printing',()=>{assert.equal(perfect.hit,false);assert.equal(perfect.artworkCandidate,true);assert.equal(perfect.bestGuess.id,card.id);assert.equal(perfect.bestDist,0)});
sandbox.googleUser={email:'fixture@example.invalid'};sandbox._googleIdToken='fixture';sandbox._isPro=true;
let calls=0;let response={...info,grounded_id:'server-id',set_name:'Absent set'};
sandbox.cardResellScanRequest=async(url,opts)=>{assert.equal(url,'/api/scan');assert.equal(JSON.parse(opts.body).imageBase64,'fixture');calls++;return{ok:true,status:200,json:async()=>response}};
sandbox.CardResellFastPath={scanFile:async()=>({hit:true,card}),loadCardIndex:async()=>[card],deriveLargeUrl:u=>u};
await sandbox.processScanImage({files:[{}]});
check('even legacy local hit must call normal server scan',()=>assert.equal(calls,1));
check('server result survives missing local printing',()=>{assert.equal(sandbox._pendingIdScanCard.groundedId,'server-id');assert.equal(sandbox._pendingIdScanCard.setName,'Absent set');assert.equal(sandbox.buttonState,'success')});
response={...info,grounded_id:'server-id'};
await sandbox.processScanImage({files:[{}]});
check('client cannot replace server canonical ID with local ID',()=>assert.equal(sandbox._pendingIdScanCard.groundedId,'server-id'));
sandbox._lastScanCandidates=[card];sandbox._lastScanAmbiguous=true;sandbox.CardResellFastPath.loadCardIndex=async()=>{throw new Error('fixture unavailable')};
await sandbox.processScanImage({files:[{}]});
check('optional index failure preserves result and clears stale suggestions',()=>{assert.equal(sandbox._pendingIdScanCard.groundedId,'server-id');assert.equal(sandbox._lastScanCandidates.length,0);assert.equal(sandbox._lastScanAmbiguous,false)});
console.log(`client-printing-evidence: ${count} passed, 0 failed -- SUITE COMPLETE, exit=0`);
