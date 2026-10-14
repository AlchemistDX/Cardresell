// Exact distance and ranking parity; no cameras, providers or customer data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveCoreBundle} from './_assetRefs.mjs';
import {harness} from './_assert.mjs';
const {check,done}=harness('scan-hash-distance');
const source=readFileSync(resolveCoreBundle().path,'utf8');
const extract=s=>s.match(/  function hamming\(a, b\) \{[\s\S]*?\n  \}/)?.[0];
const oldSource=readFileSync(new URL('../js/core.dea40438.js',import.meta.url),'utf8');
const actual=Function('return ('+extract(source)+')')();
const legacy=Function('return ('+extract(oldSource)+')')();
const oracle=(a,b)=>(BigInt('0x'+a)^BigInt('0x'+b)).toString(2).replace(/0/g,'').length;
check('empty hashes retain zero distance',actual('','')===0);
check('unequal lengths retain refusal sentinel',actual('0','00')===999);
const hex='0123456789abcdefABCDEF';
for(const a of hex)for(const b of hex)assert.equal(actual(a,b),oracle(a,b));
check('all lower/uppercase hex-digit pairs match independent bit oracle',true);
// The public helper's old malformed-digit semantics remain unchanged too.
for(let a=0;a<256;a++)for(let b=0;b<256;b++){
 const x=String.fromCharCode(a),y=String.fromCharCode(b);
 assert.equal(actual(x,y),legacy(x,y),`byte characters ${a},${b}`);
}
check('all 65,536 byte-character pairs retain legacy behavior',true);
let seed=0x12345678;
const randomHex=()=>Array.from({length:16},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed>>>28).toString(16)}).join('');
for(let i=0;i<1000;i++){const a=randomHex(),b=randomHex();assert.equal(actual(a,b),oracle(a,b));assert.equal(actual(a,a),0);assert.equal(actual(a,b),actual(b,a))}
check('1,000 deterministic 64-bit pairs match oracle, identity and symmetry',true);
const rows=['card-index.json','mtg-index.json'].flatMap(p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url))));
check('parity corpus includes both shipped game catalogs',rows.length>30000&&rows.some(c=>c.g==='mtg')&&rows.some(c=>c.g==='pokemon'));
const probes=[rows[0],rows[Math.floor(rows.length/2)],rows.at(-1)];
for(const [n,q] of probes.entries()){
 const raw=probes[(n+1)%probes.length];
 const rank=fn=>{
  let best=999,second=999,id=null,usedRaw=false;const scores=[];
  for(const c of rows){
   const crop=fn(q.p,c.p)*2+fn(q.d,c.d),uncropped=fn(raw.p,c.p)*2+fn(raw.d,c.d),d=Math.min(crop,uncropped);scores.push(d);
   if(d<best){second=best;best=d;id=c.id;usedRaw=uncropped<=crop}else if(d<second)second=d;
  }
  return {scores,best,second,id,usedRaw,candidate:best<=20&&second-best>=6};
 };
 assert.deepEqual(rank(actual),rank(legacy));
 check(`probe ${n+1}: all ${rows.length} weighted scores, tie order and candidate gate unchanged`,true);
}
done();
