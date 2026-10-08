// Execute the production enrichment functions with synthetic provider responses.
// No images/providers/credits/accounts are used.
import assert from 'node:assert/strict';
import {groundMagicCardInfo,groundYugiohCardInfo,groundPokemonCardInfo,groundLorcanaCardInfo} from '../api/scan.js';
const oldFetch=globalThis.fetch, saved=[process.env.KV_REST_API_URL,process.env.KV_REST_API_TOKEN];
delete process.env.KV_REST_API_URL;delete process.env.KV_REST_API_TOKEN;
let cases=0;
const response=data=>({ok:true,status:200,json:async()=>data});
async function run(fn){await fn();cases++;}
const scan=(game,patch={})=>({card_type:game,card_name:'Example',set_name:'Original Set',set_code:'ORI',card_number:'007',confidence:'low',image_url:'original.jpg',...patch});
const mtg={id:'printing-id',name:'Example',set:'ori',set_name:'Original Set',collector_number:'7',lang:'en',image_uris:{normal:'catalog.jpg'},prices:{usd:'2.50'}};
try {
 for(const patch of [{set:'new',set_name:'Different Set'},{collector_number:'8'},{name:'Different Card'},{lang:'ja'}])await run(async()=>{
  globalThis.fetch=async()=>response({...mtg,...patch});const s=scan('mtg',{language:'en'}),before={...s};await groundMagicCardInfo(s);assert.deepEqual(s,before);
 });
 await run(async()=>{globalThis.fetch=async()=>response(mtg);const s=scan('mtg');await groundMagicCardInfo(s);assert.equal(s.grounded_id,'printing-id');assert.equal(s._scryfall_prices.usd,2.5);});
 for(const patch of [{card_number:''},{set_name:'',set_code:''},{card_number:'7★'}])await run(async()=>{
  globalThis.fetch=async()=>response(mtg);const s=scan('mtg',patch),before={...s};await groundMagicCardInfo(s);assert.deepEqual(s,before);
 });
 await run(async()=>{let urls=[];globalThis.fetch=async u=>{urls.push(String(u));return response({...mtg,collector_number:'7★'});};const s=scan('mtg',{card_number:'7★'});await groundMagicCardInfo(s);assert.equal(s.card_number,'7★');assert.ok(urls[0].includes('7%E2%98%85'));});
 const pk={id:'ori-7',name:'Example',number:'7',set:{id:'ori',name:'Original Set',ptcgoCode:'ORI'},rarity:'Rare',images:{large:'catalog.jpg'}};
 for(const records of [[{...pk,set:{id:'new',name:'Different Set'}}],[pk,{...pk,id:'ori-7b'}],[{...pk,name:'Example ex'}]])await run(async()=>{
  globalThis.fetch=async()=>response({data:records});const s=scan('pokemon'),before={...s};await groundPokemonCardInfo(s);assert.deepEqual(s,before);
 });
 await run(async()=>{globalThis.fetch=async()=>response({data:[{...pk,id:'wrong',set:{name:'Unrelated'}},pk]});const s=scan('pokemon');await groundPokemonCardInfo(s);assert.equal(s.grounded_id,'ori-7');});
 await run(async()=>{globalThis.fetch=async()=>response({data:[pk],totalCount:251});const s=scan('pokemon'),before={...s};await groundPokemonCardInfo(s);assert.deepEqual(s,before);});
 await run(async()=>{globalThis.fetch=async()=>response({data:[pk]});const s=scan('pokemon',{is_japanese:true}),before={...s};await groundPokemonCardInfo(s);assert.deepEqual(s,before);});
 await run(async()=>{process.env.KV_REST_API_URL='https://kv.example.invalid';process.env.KV_REST_API_TOKEN='synthetic';let keys=[];
  globalThis.fetch=async u=>{keys.push(String(u));return response(String(u).includes('kv.example.invalid')?{result:JSON.stringify({id:'wrong',name:'Example',number:'7',set_name:'Wrong Set',set_code:'BAD'})}:{data:[]});};
  const s=scan('pokemon'),before={...s};await groundPokemonCardInfo(s);assert.deepEqual(s,before);assert.ok(keys[0].includes('ptcg%3Av2%3A'));
  delete process.env.KV_REST_API_URL;delete process.env.KV_REST_API_TOKEN;
 });
 const ygo={id:12345678,name:'Example',card_sets:[{set_code:'NEW-EN001',set_name:'Wrong Set',set_rarity:'Rare'},{set_code:'ORI-EN007',set_name:'Original Set',set_rarity:'Rare'}],card_images:[{image_url:'generic.jpg'}],card_prices:[{tcgplayer_price:'999'}]};
 await run(async()=>{globalThis.fetch=async()=>response({data:[ygo]});const s=scan('yugioh',{card_number:'12345678',set_code:''}),before={...s};await groundYugiohCardInfo(s);assert.equal(s.set_name,before.set_name);assert.equal(s.set_code,'');assert.equal(s.image_url,'original.jpg');assert.equal(s.confidence,'low');assert.equal(s._ygoprodeck_tcgplayer_price,undefined);assert.equal(s.grounded_id,undefined);});
 await run(async()=>{globalThis.fetch=async()=>response({data:[ygo]});const s=scan('yugioh',{card_number:'12345678',set_code:'ORI-EN007'});await groundYugiohCardInfo(s);assert.equal(s.set_name,'Original Set');assert.equal(s.set_code,'ORI-EN007');assert.equal(s._ygoprodeck_tcgplayer_price,undefined);});
 await run(async()=>{globalThis.fetch=async()=>response({data:[{...ygo,card_sets:[...ygo.card_sets,{set_code:'ORI-EN007',set_name:'Original Set',set_rarity:'Ultra Rare'}]}]});const s=scan('yugioh',{card_number:'12345678',set_code:'ORI-EN007'});await groundYugiohCardInfo(s);assert.equal(s.confidence,'low');assert.equal(s.image_url,'original.jpg');});
 await run(async()=>{globalThis.fetch=async()=>response({data:[{...ygo,name:'Different Card'}]});const s=scan('yugioh',{card_number:'',set_code:''}),before={...s};await groundYugiohCardInfo(s);assert.deepEqual(s,before);});
 const lor={Unique_ID:'lor-print',Name:'Example',Card_Num:'7',Set_Name:'Original Set',Set_ID:'ORI',Image:'catalog.jpg'};
 for(const records of [[{...lor,Set_Name:'Wrong Set',Set_ID:'BAD'}],[lor,{...lor,Unique_ID:'variant'}]])await run(async()=>{globalThis.fetch=async()=>response(records);const s=scan('lorcana'),before={...s};await groundLorcanaCardInfo(s);assert.deepEqual(s,before);});
 await run(async()=>{globalThis.fetch=async()=>response([lor]);const s=scan('lorcana');await groundLorcanaCardInfo(s);assert.equal(s.grounded_id,'lor-print');});
 console.log(`catalog-printing-evidence: ${cases} passed, 0 failed -- SUITE COMPLETE, exit=0`);
} finally {globalThis.fetch=oldFetch;for(const [i,key] of ['KV_REST_API_URL','KV_REST_API_TOKEN'].entries()){if(saved[i]===undefined)delete process.env[key];else process.env[key]=saved[i];}}
