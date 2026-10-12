// Exercise the shipped restore callback with deterministic timers. The live
// regression was a delayed restore replacing a user's newer tab selection.
import vm from 'node:vm';
import { readCoreBundle } from './_assetRefs.mjs';
import { harness } from './_assert.mjs';
const T = harness('restore-navigation');
const { source } = readCoreBundle();
const start = source.indexOf('function _restoreLastLoadedCard()');
const end = source.indexOf('// ── DOM refs', start);
if (start < 0 || end < 0) throw Error('Restore function boundary missing');
const restore = source.slice(start, end);

for (const view of ['lookup', 'collection', 'drafts', 'flips', 'review']) {
  const timers = [], rendered = [];
  const card = { name: 'Saved Minun', game: 'pokemon', number: '194' };
  const snapshot = { ...card, _savedAt: Date.now(), _fullCard: card };
  const ctx = vm.createContext({
    console: { log() {}, warn() {} }, window: {}, activeGame: 'pokemon',
    currentView: view, _CR_LAST_CARD_KEY: 'saved-card',
    localStorage: { getItem: key => key === 'saved-card' ? JSON.stringify(snapshot) : null },
    setTimeout: fn => timers.push(fn),
    document: { getElementById: id => id === 'cardImgPhLabel' ? { textContent: 'No card selected' } : null },
    getComputedStyle: () => ({ display: 'none' }),
    setSelectedCard() {}, loadCardUI: value => rendered.push(value),
  });
  vm.runInContext('function switchView(view) { currentView = view; }\n' + restore, ctx);
  vm.runInContext('_restoreLastLoadedCard()', ctx);
  T.check(`${view}: delayed restore preserves chosen destination`, ctx.currentView === view);
  T.check(`${view}: saved card still hydrates`, rendered.length === 1 && rendered[0].name === card.name);
  // Simulate the user changing tabs before the defensive second hydration.
  ctx.currentView = 'collection';
  timers.shift()();
  T.check(`${view}: rehydration preserves the newer destination`, ctx.currentView === 'collection');
  T.check(`${view}: cleared panel is still restored`, rendered.length === 2);
}
T.done();
