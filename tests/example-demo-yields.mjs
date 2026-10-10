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
  const document = { getElementById: id => id === 'searchInput' ? si : id === 'dropList' ? dl : null };
  const window = {};
  const doSearch = () => { setTimeout(() => { rows = true; }, rowsAfterMs); };
  const make = new Function('document', 'window', 'doSearch', 'onGameSelectChange',
    `let activeGame = 'pokemon'; let _listingInstance = 0;\n${fnSrc}\nreturn { run: autoRunExampleCard, select: () => { _listingInstance += 1; } };`);
  const api = make(document, window, doSearch, () => {});
  return { ...api, si, listeners, clicked: () => clicked };
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
console.log(`example-demo-yields: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
