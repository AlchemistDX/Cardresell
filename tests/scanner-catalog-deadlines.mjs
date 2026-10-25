// Exercise real catalog enrichment; a stalled body must not hang a paid scan.
import assert from 'node:assert/strict';
import { groundMagicCardInfo, groundLorcanaCardInfo, groundYugiohCardInfo } from '../api/scan.js';
const original = { fetch, setTimeout, clearTimeout, log:console.log };
const timers=new Set(); let passed=0;
try {
  console.log=()=>{};
  globalThis.setTimeout=fn=>{const t={fn};timers.add(t);return t};
  globalThis.clearTimeout=t=>timers.delete(t);
  for (const [run, card] of [
    [groundMagicCardInfo,{card_type:'mtg',card_name:'Lightning Bolt',card_number:'146',set_code:'m10'}],
    [groundLorcanaCardInfo,{card_type:'lorcana',card_name:'Fixture',set_code:'1',card_number:'1'}],
    [groundYugiohCardInfo,{card_type:'yugioh',card_number:'12345678'}],
    [groundYugiohCardInfo,{card_type:'yugioh',set_code:'LOB-EN001'}],
  ]) {
    for (const failure of ['body','http','network','parse']) {
      let calls=0; const bodyDeadlines=[]; let abortedBodies=0;
      globalThis.fetch=async (_,init)=>{
        calls++;
        if (failure==='network') throw Error('fixture');
        return {ok:failure!=='http',json:()=>{
          if (failure==='parse') return Promise.reject(Error('fixture'));
          bodyDeadlines.push(timers.size === 1);
          if (timers.size !== 1) return Promise.resolve(null);
          return new Promise((_,reject)=>{
            init.signal.addEventListener('abort',()=>{abortedBodies++;reject(Object.assign(Error('fixture'),{name:'AbortError'}))});
            [...timers][0].fn();
          });
        }};
      };
      const copy=structuredClone(card);await run(copy);
      assert.ok(calls>0);
      if(failure==='body'){assert.ok(bodyDeadlines.length>0 && bodyDeadlines.every(Boolean),'deadline covers every response body');assert.equal(abortedBodies,calls)}
      assert.equal(timers.size,0);assert.deepEqual(copy,card,'failure cannot change identity');passed++;
    }
  }
} finally {Object.assign(globalThis,{fetch:original.fetch,setTimeout:original.setTimeout,clearTimeout:original.clearTimeout});console.log=original.log}
console.log(`scanner-catalog-deadlines: ${passed} passed, 0 failed -- SUITE COMPLETE, exit=0`);
