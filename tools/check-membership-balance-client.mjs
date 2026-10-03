import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const file = html.match(/src="\/(js\/core\.[a-f0-9]+\.js)"/)[1];
const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const code = source.slice(source.indexOf('let _settingsCreditsRun = 0;'), source.indexOf('// ── Save TPL key'));
let passed = 0;
const check = (label, value) => { assert.ok(value, label); console.log('PASS ' + label); passed++; };
function fixture({ response = { credits: 1091, idCredits: 1253, isPro: true }, ok = true } = {}) {
  const nodes = Object.fromEntries(['settingsScanCount', 'settingsScanSub', 'idScanCount', 'idScanSub']
    .map(id => [id, { style: {}, textContent: '' }]));
  const user = { uid: 'A', sub: 'A', email: 'synthetic@example.invalid' };
  const calls = [];
  const window = { googleUser: user, _fbCurrentUser: { uid: 'A', getIdToken: async () => 'syntheticA' },
    _userEmail: user.email, _waitForAuth: async () => {}, _idScanCredits: 1228, _scanCredits: 1091 };
  const scope = { window, document: { getElementById: id => nodes[id] }, URLSearchParams,
    fetch: async (url, init) => { calls.push({ url, init }); return { ok, json: async () => response }; } };
  vm.createContext(scope); vm.runInContext(code, scope);
  return { window, nodes, calls, scope, load: () => scope.loadSettingsScanCredits() };
}
const f = fixture(); await f.load();
check('Normal balance request has UID-bound Firebase token', f.calls[0].init.headers.Authorization === 'Bearer syntheticA');
check('Both separate credit balances displayed', f.nodes.idScanCount.textContent === '1253' && f.nodes.settingsScanCount.textContent === '1091');
check('Global scan balances refreshed from authoritative response', f.window._idScanCredits === 1253 && f.window._scanCredits === 1091);
for (const opts of [{ ok: false, response: { error: 'Sign in' } }, { response: { credits: -1, idCredits: 25 } }]) {
  const g = fixture(opts); await g.load();
  check('Unavailable or invalid data never becomes zero balance', g.window._idScanCredits === 1228 && g.nodes.idScanCount.textContent === '—');
}
const mismatch = fixture(); mismatch.window._fbCurrentUser.uid = 'B'; await mismatch.load();
check('Mismatched SDK account cannot request balances', mismatch.calls.length === 0);
let resume;
const race = fixture(); race.window._fbCurrentUser.getIdToken = () => new Promise(resolve => { resume = resolve; });
const pending = race.load(); race.window.googleUser = { uid: 'B' }; resume('syntheticA'); await pending;
check('Account change during token acquisition sends no request', race.calls.length === 0);
let delivered;
const late = fixture();
late.scope.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { delivered = resolve; }) });
const old = late.load(); await new Promise(resolve => setImmediate(resolve));
late.window.googleUser = { uid: 'B' }; delivered({ credits: 2, idCredits: 3 }); await old;
check('Account change during response cannot overwrite balances', late.window._idScanCredits === 1228 && late.window._scanCredits === 1091);
console.log(`${passed} passed, 0 failed`);
