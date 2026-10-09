// Header membership control: paid plans render a tier badge; Free/signed-out
// keep the Subscriptions upgrade entry. Runs the shipped function with a stub DOM.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : (fail++, console.log('  FAIL', n, d)); };
const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../' + idx.match(/\/(js\/core\.[0-9a-f]{8}\.js)/)[1], import.meta.url), 'utf8');
const i = core.indexOf('function updateHeaderMembership('); let d = 0, j = core.indexOf('{', i), body;
for (let k = j; k < core.length; k++) { if (core[k] === '{') d++; else if (core[k] === '}' && --d === 0) { body = core.slice(i, k + 1); break; } }
const el = () => ({ attrs: {}, textContent: '', title: '', classList: { s: new Set(), add(c) { this.s.add(c); } },
  setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } });
function run(tier, signedIn) {
  const label = el(), button = el();
  const window = { googleUser: signedIn ? { sub: 'A' } : null };
  const document = { getElementById: id => id === 'headerMembershipLabel' ? label : id === 'getProBtn' ? button : null };
  new Function('window', 'document', body + '; updateHeaderMembership(' + JSON.stringify(tier) + ');')(window, document);
  return { label, button };
}
for (const [tier, name, badge] of [['starter', 'Starter', 'starter'], ['casual', 'Casual', 'casual'], ['pro', 'Pro', 'pro'], ['business', 'Business', 'business'],
  ['legacy_pro', 'Pro', 'pro'], ['pro_max', 'Pro Max', 'business'], ['legacy_ultimate', 'Ultimate', 'business']]) {
  const r = run(tier, true);
  check(`${tier} shows "${name}" badge`, r.label.textContent === name && r.button.attrs['data-tier'] === badge, JSON.stringify(r.button.attrs));
  check(`${tier} badge announces the plan`, r.button.attrs['aria-label'] === 'Your plan: ' + name + '. Compare and manage subscriptions');
}
for (const [tier, signed] of [['free', true], ['pro', false], [undefined, true], ['business', false]]) {
  const r = run(tier, signed);
  check(`${tier}/${signed ? 'signed in' : 'signed out'} keeps Subscriptions control`, r.label.textContent === 'Subscriptions' && !('data-tier' in r.button.attrs) && !('aria-label' in r.button.attrs));
}
// Switching from a paid account to a signed-out state must clear the badge.
{ const label = el(), button = el(); const window = { googleUser: { sub: 'A' } };
  const document = { getElementById: id => id === 'headerMembershipLabel' ? label : id === 'getProBtn' ? button : null };
  const f = new Function('window', 'document', body + '; return updateHeaderMembership;')(window, document);
  f('business'); window.googleUser = null; f('business');
  check('badge clears on sign-out', !('data-tier' in button.attrs) && label.textContent === 'Subscriptions'); }
for (const t of ['starter', 'casual', 'pro', 'business'])
  check(`CSS badge style exists for ${t}`, idx.includes(`.hdr #getProBtn[data-tier="${t}"]`));
check('badge re-shows the star icon', idx.includes('.hdr #getProBtn[data-tier]>svg { display:inline-block'));
console.log(`membership-header-badge: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
