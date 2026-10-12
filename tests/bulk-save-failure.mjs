import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import vm from 'node:vm';
import {referencedHashedAssets} from './_assetRefs.mjs';
const source=readFileSync(referencedHashedAssets().find(a=>a.base==='ui').path,'utf8');
const fn=parse(source,{ecmaVersion:'latest'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='_bulkSaveToCollection');
let passed=0;
for(const writeOk of [false,true]){
  let minted=0,saved,failures=0,success=0,postSave=0,tracking=0;
  const rows=[{success:true,qty:2,cardName:'Same card',marketPrice:0}],original=structuredClone(rows);
  const window={_bulkSaved:false,trackEvent:()=>tracking++};
  const ctx={window,console,Date,JSON,_crGuardMint:f=>{f();return true},_crNewEntryId:()=> 'copy_'+(++minted),
    loadPortData:()=>[],_bulkScanRowToCard:r=>({card:r.cardName}),savePortData:p=>{saved=p;return writeOk},
    _reportStorageFailure:()=>failures++,getUserKey:()=> 'test',localStorage:{getItem:()=>JSON.stringify(saved)},
    _maybeRerenderCollection(){},showToast:(m,type)=>{if(type==='success')success++},_bulkShowSection(){},_bulkShowPostSaveBar:()=>postSave++};
  vm.createContext(ctx);vm.runInContext(source.slice(fn.start,fn.end),ctx);
  ctx._bulkSaveToCollection(rows,{0:1.25});
  assert.deepEqual(rows,original);passed++;
  assert.equal(saved.length,2);assert.equal(saved[0].buyPrice,1.25);assert.equal(saved[1].buyPrice,1.25);passed++;
  assert.equal(saved[0].currentValue,0);passed++;
  assert.equal(failures,writeOk?0:1);passed++;
  assert.equal(success,writeOk?1:0);passed++;
  assert.equal(postSave,writeOk?1:0);passed++;
  assert.equal(tracking,writeOk?1:0);passed++;
  assert.equal(window._bulkSaved,writeOk);passed++;
}
console.log(`bulk-save-failure: ${passed} passed, 0 failed -- SUITE COMPLETE, exit=0`);
