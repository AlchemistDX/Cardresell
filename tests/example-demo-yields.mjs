// 2026-10-10: the first-visit Charizard demo must never replace a card the
// visitor chose some other way while it polls. Runs the shipped function from
// the bundle index.html references, against minimal stubs.
import { readFileSync } from 'node:fs';
const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = idx.match(/\/js\/(core\.[0-9a-f]{8}\.js)/)[1];
const src = readFileSync(new URL('../js/' + core, import.meta.url), 'utf8');
const start = src.indexOf('async function autoRunExampleCard()');
const end = src.indexOf('try { window.autoRunExampleCard', start);
if (start < 0 || end < 0) throw Error('autoRunExampleCard not found in ' + core);
const fnSrc = src.slice(start, end);
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
function env({ rowsAfterMs = 300 } = {}) {
  const listeners = {};
  const si = { value: '', addEventListener: (ev, fn) => { listeners[ev] = fn; } };
  let clicked = 0, rows = false;
  const dl = { classList: { remove() {} }, querySelector: () => rows ? { click: () => { clicked++; } } : null };
  let hidden=false, dialog=false, cancelled=0, searches=0;
  const document = { getElementById: id => id === 'searchInput' ? si : id === 'dropList' ? dl : id==='lookupView' ? {classList:{contains:()=>hidden}} : null };
  const window = {_searchReqId:0};
  const doSearch = () => { searches++;const id=++window._searchReqId;setTimeout(() => { if(id===window._searchReqId)rows = true; }, rowsAfterMs); };
  const make = new Function('document', 'window', 'doSearch', 'onGameSelectChange', '_topOpenDialog', '_invalidateCardSearch',
    `let activeGame = 'pokemon'; let selectedCard=null; let _listingInstance = 0;\n${fnSrc}\nreturn { run: autoRunExampleCard, select: () => { selectedCard={name:'Chosen'};_listingInstance += 1; }, game:g=>activeGame=g };`);
  const api = make(document, window, doSearch, () => {},()=>dialog,()=>{cancelled++;window._searchReqId++;rows=false});
  return { ...api, si, listeners, clicked: () => clicked, navigate:()=>{hidden=true}, modal:()=>{dialog=true}, cancelled:()=>cancelled, searches:()=>searches, newerSearch:()=>{window._searchReqId++} };
}
let e = env();
let r = await e.run();
check('normal first visit still runs the demo', r === true && e.clicked() === 1 && e.si.value === 'Charizard');
e = env({ rowsAfterMs: 600 });
let p = e.run(); setTimeout(() => e.select(), 200); r = await p;
check('a card selected another way mid-poll abandons the demo', r === 'abandoned' && e.clicked() === 0);
e = env({ rowsAfterMs: 600 });
p = e.run(); setTimeout(() => e.listeners.input?.(), 200); r = await p;
check('typing still abandons the demo', r === 'abandoned' && e.clicked() === 0);
e = env(); e.si.value = 'Pikachu'; r = await e.run();
check('existing search text is never replaced', r === 'abandoned' && e.si.value === 'Pikachu' && e.clicked() === 0);
for(const action of ['select','navigate','modal']) {
 e=env();e[action]();r=await e.run();
 check(action+' before startup prevents any demo search',r==='abandoned'&&e.searches()===0&&e.si.value==='');
}
e=env();e.game('mtg');r=await e.run();
check('chosen game is not forced back to Pokémon',r==='abandoned'&&e.searches()===0);
for(const action of ['navigate','modal']) {
 e=env({rowsAfterMs:600});p=e.run();setTimeout(()=>e[action](),100);r=await p;
 check(action+' during search prevents automatic selection',r==='abandoned'&&e.clicked()===0);
 check(action+' withdraws only the demo request and text',e.cancelled()===1&&e.si.value==='');
}
e=env({rowsAfterMs:600});p=e.run();setTimeout(()=>{e.newerSearch();e.modal()},100);r=await p;
check('a newer search is never invalidated by demo cleanup',r==='abandoned'&&e.cancelled()===0);
console.log(`example-demo-yields: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
