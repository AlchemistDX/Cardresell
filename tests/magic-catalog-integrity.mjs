import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../js/search-catalog.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=n=>[uuid(n),'Sol Ring','cmd',String(n),'uncommon','','en','2020-01-01',false,[]];
const parts=[1,2].map(n=>({url:`/data/catalog/mtg-part.${String(n).repeat(12)}.json`,count:1}));
function fixture(){
 const meta={url:'/data/catalog/mtg.aaaaaaaaaaaa.json',count:2,sets:1,nativeCount:0,parts:clone(parts)};
 return {manifest:{schema:1,games:{mtg:meta}},index:{schema:1,game:'mtg',provider:'Scryfall',sets:{cmd:'Commander'},cards:[],parts:clone(parts)},shards:parts.map((_,i)=>({schema:1,game:'mtg',cards:[row(i+1)]}))};
}
function client(data,failFirst=false){
 let calls=0,failed=false;
 const env={AbortController,setTimeout,clearTimeout,console,fetch:async url=>{
  calls++;
  if(failFirst&&!failed&&url===parts[1].url){failed=true;throw Error('temporary outage');}
  const body=url.includes('/manifest.')?data.manifest:url===data.manifest.games.mtg.url?data.index:data.shards[parts.findIndex(p=>p.url===url)];
  return {ok:!!body,json:async()=>clone(body)};
 }};
 vm.createContext(env);vm.runInContext(source,env);
 return {api:env.CardResellCatalog,calls:()=>calls};
}
let passed=0,failed=0;
async function check(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+': '+e.message)}}
await check('valid sharded catalog retains exact UUID and no prices',async()=>{const c=client(fixture());const result=await c.api.byId('mtg',uuid(2));assert.equal(result.rows[0][0],uuid(2));assert.equal(c.api.normalized(result.data,result.rows[0]).priceVariants.length,0)});
const corruptions=[
 ['wrong set count',d=>d.manifest.games.mtg.sets=2],
 ['unused extra set',d=>d.index.sets.extra='Extra'],
 ['empty set label',d=>d.index.sets.cmd=' '],
 ['missing collector number',d=>d.shards[0].cards[0][3]=''],
 ['duplicate UUID across shards',d=>d.shards[1].cards[0][0]=uuid(1)],
 ['wrong language',d=>d.shards[0].cards[0][6]='ja'],
 ['noncanonical UUID',d=>d.shards[0].cards[0][0]='------------------------------------'],
 ['missing shard',d=>d.shards[1]=null],
 ['mismatched shard generation',d=>d.index.parts[1].url=parts[0].url],
 ['duplicate shard URL',d=>{d.manifest.games.mtg.parts[1]=clone(parts[0]);d.index.parts[1]=clone(parts[0])}],
 ['incorrect shard count',d=>d.shards[1].cards.push(row(3))],
 ['empty alias',d=>d.shards[0].cards[0][9]=[' ']],
 ['invalid index shape',d=>delete d.index.cards],
 ['prototype set key',d=>{d.shards[0].cards[0][2]='toString';d.index.sets={}}],
 ];
for(const [name,change] of corruptions) await check('reject '+name,async()=>{const d=fixture();change(d);await assert.rejects(client(d).api.load('mtg'))});
await check('transient fetch failure can retry without retaining partial cards',async()=>{const c=client(fixture(),true);await assert.rejects(c.api.load('mtg'));const d=await c.api.load('mtg');assert.equal(d.cards.length,2);assert.equal(new Set(d.cards.map(r=>r[0])).size,2)});
await check('concurrent callers share one complete generation',async()=>{const c=client(fixture());const results=await Promise.all([c.api.load('mtg'),c.api.load('mtg')]);assert.equal(results[0],results[1]);assert.equal(c.calls(),4)});
await check('actual importer and publication invariants',async()=>{const result=spawnSync('python3',[fileURLToPath(new URL('./magic-build-invariants.py',import.meta.url))],{encoding:'utf8',timeout:60000});if(result.status!==0)throw Error(result.stderr||result.error?.message||result.stdout);console.log(result.stdout.trim());assert.match(result.stdout,/SUITE COMPLETE, exit=0/)});
console.log(`magic-catalog-integrity: ${passed} passed, ${failed} failed -- SUITE COMPLETE, exit=${failed?1:0}`);
process.exitCode=failed?1:0;
