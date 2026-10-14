// Printed-name rescue for Magic misses in a bulk/binder batch (2026-10-11).
// Owner binder page (Secrets of Strixhaven) missed 4 of 9 with every card in
// its pocket; the printed names read cleanly. Rescue is strict: only sets this
// batch already identified, close spelling only, and labelled for checking.
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const uiRef = html.match(/\/js\/(ui\.[0-9a-f]{8}\.js)/)[1];
const src = fs.readFileSync(new URL('../js/' + uiRef, import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const a = src.indexOf('const _BULK_TEXT_RESCUE'), b = src.indexOf('window._bulkTextRescueForTest');
ok(a > 0 && b > a, 'rescue block present');
const block = src.slice(a, src.indexOf('\n', b) + 1);

function harness({ texts, scry, results }) {
  const log = { fetches: [], loads: 0, updates: [], toasts: [], terminated: 0 };
  let lastFile = null;
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, putImageData() {},
    getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 255, 200, 210, 220, 255]) }) }) });
  const win = { _bulkResults: results, Tesseract: null };
  const ctx = {
    window: win, console, setTimeout: (f) => setTimeout(f, 0), AbortSignal: { timeout: () => undefined },
    document: { createElement: (t) => { if (t === 'script') { const s = {}; setTimeout(() => { log.loads++;
        win.Tesseract = { createWorker: async () => ({ setParameters: async () => {}, terminate: async () => { log.terminated++; },
          recognize: async () => ({ data: { text: texts[lastFile] || '' } }) }) }; s.onload(); }, 0); return s; } return canvas(); },
      head: { appendChild() {} }, getElementById: () => ({ textContent: '' }) },
    createImageBitmap: async (f) => { lastFile = f; return { width: 500, height: 700, close() {} }; },
    fetch: async (url) => { log.fetches.push(url); const q = new URL(url); const hit = scry(q.searchParams.get('fuzzy'), q.searchParams.get('set'));
      return { ok: !!hit, json: async () => hit }; },
    _bulkFetchPrice: async () => ({ marketPrice: 0.12, variant: 'normal', imageUrl: 'img', tcgplayerUrl: '' }),
    _bulkUpdateRow: (id, r) => log.updates.push([id, r.cardName]),
    _bulkDetectDuplicates() {}, _bulkDraftSyncSelectionUI() {}, showToast: (m) => log.toasts.push(m),
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/scan-finish.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(block, ctx);
  return { ctx, log, api: win._bulkTextRescueForTest };
}
const mtgOk = { success: true, cardType: 'mtg', setCode: 'SOS', rowId: 'r0' };
const miss = (file, rowId) => ({ success: false, definiteMiss: true, file, rowId, error: 'Could not identify card' });
const SOS = { 'Rubble Rouser': '128', 'Sneering Shadewriter': '101', "Killian's Confidence": '197', 'Ravenous Beast': '999' };
const scry = (fuzzy, set) => {
  if (set !== 'sos') return null;
  const f = fuzzy.toLowerCase();
  for (const [name, num] of Object.entries(SOS)) {
    const key = name.toLowerCase().split(' ').pop().slice(0, 5);
    if (f.includes(key)) return { name, set: 'sos', set_name: 'Secrets of Strixhaven', collector_number: num, rarity: 'common' };
  }
  return null;
};

// Acceptance rule.
{ const { api } = harness({ texts: {}, scry, results: [] });
  ok(api.accepts('Rubble Rouser 3', 'Rubble Rouser'), 'stray digit accepted');
  ok(api.accepts('Sneerine Shadewriter', 'Sneering Shadewriter'), 'one-letter misread accepted');
  ok(api.accepts("f Killian's Confidence XZ", "Killian's Confidence"), 'frame junk ignored');
  ok(api.accepts('Elite Interceptor', 'Elite Interceptor // Rejoinder'), 'front face of a split card');
  ok(!api.accepts('Beast ala aaa', 'Ravenous Beast'), 'one shared word is not enough');
  ok(!api.accepts('Chaco Rene mt enna', 'Chase Inspiration'), 'garbled read rejected');
  ok(!api.accepts('', 'Rubble Rouser'), 'empty read rejected');
  ok(api.reads('ee) | |\n( Killian\'s Confidence *32\nx').length === 1, 'short noise lines dropped'); }

// Full run on the owner's page shape.
{ const results = [mtgOk, miss('rub', 'r1'), miss('sne', 'r2'), miss('bea', 'r3'), miss('cha', 'r4')];
  const { api, log } = harness({ scry, results,
    texts: { rub: 'fe\nRubble Rouser 3\n', sne: 'EE Be\nSneerine Shadewriter\n', bea: 'Beast ala aaa\n', cha: 'Chaco Rene mt enna dlt ane\n' } });
  const n = await api.run();
  ok(n === 2, 'two rescued (got ' + n + ')');
  ok(results[1].success && results[1].cardName === 'Rubble Rouser' && results[1].cardNumber === '128' && results[1].setCode === 'sos', 'Rubble Rouser #128');
  ok(results[2].success && results[2].cardName === 'Sneering Shadewriter' && results[2].cardNumber === '101', 'Sneering Shadewriter #101');
  ok(results[1].textRescue === true && results[1].definiteMiss === false && results[1].error === '', 'rescued row labelled, not a miss');
  // Owner's restored bulk flow prices immediately; the catalogue guess remains
  // an estimate until the optional finish control is used, including OCR rescue.
  ok(results[1].marketPrice === 0.12, 'printed-name rescue keeps the automatic catalogue price');
  ok(results[1].finishKey === 'normal' && results[1].foilHint === '', 'printed-name rescue does not invent visual foil evidence');
  ok(results[1].finishConfirmed === false && results[1].finishEstimated === true && results[1].finishOptions[0].market === 0.12, 'automatic finish remains an estimate with a correctable price');
  ok(results[1].finishReviewRequired === false, 'rescued rows do not block the bulk workflow on finish confirmation');
  ok(!results[3].success && results[3].definiteMiss, 'loose one-word match stays a miss');
  ok(!results[4].success, 'garbled read stays a miss');
  ok(log.fetches.length > 0 && log.fetches.every(u => u.startsWith('https://api.scryfall.com/cards/named?fuzzy=') && u.endsWith('&set=sos')), 'every lookup limited to the batch set');
  ok(log.updates.length === 2 && log.toasts.length === 1 && /check them/.test(log.toasts[0]), 'rows repainted and seller told to check');
  ok(log.terminated === 1, 'reader worker released');
  ok(results.slice(1).every(r => r.textRescueTried), 'each miss tried once');
  const again = await api.run();
  ok(again === 0, 'second run does nothing'); }

// No Magic card identified in the batch: nothing loads.
{ const results = [{ success: true, cardType: 'pokemon', setCode: 'sv1' }, miss('rub', 'r1')];
  const { api, log } = harness({ scry, results, texts: { rub: 'Rubble Rouser' } });
  ok(await api.run() === 0 && log.loads === 0 && log.fetches.length === 0, 'Pokemon-only batch: reader never loads'); }

// Batch closed mid-rescue: rows not touched.
{ const results = [mtgOk, miss('rub', 'r1')];
  const h = harness({ scry, results, texts: { rub: 'Rubble Rouser' } });
  h.ctx.window._bulkResults = [];
  ok(await h.api.run() === 0 && !results[1].success, 'closed batch untouched'); }

// Wiring.
ok(/_bulkDraftSyncSelectionUI\(\);\n  \/\/ 2026-10-11: printed-name rescue[^\n]*\n  try \{ _bulkTextRescueMisses\(\)\.catch/.test(src), 'runs after the batch finishes');
ok(src.includes("result.textRescue ? '<div") && src.includes('Matched from the printed name. Please check it.'), 'row shows the check note');
ok(/result\.cardName = trimmed;[\s\S]{0,200}result\.textRescue = false;/.test(src), 'seller rename clears the note');
console.log(`bulk-text-rescue: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
