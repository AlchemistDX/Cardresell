// Bulk rows price the scanned printing, not the most expensive variant.
// Owner binder scan 2026-10-10 priced 9 of 9 rows as "Reverse Holofoil".
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const uiRef = html.match(/\/js\/(ui\.[0-9a-f]{8}\.js)/)[1];
const src = fs.readFileSync(new URL('../js/' + uiRef, import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };
const start = src.indexOf('const BULK_VARIANT_ORDER');
const end = src.indexOf('\n}\n', src.indexOf('function _bulkChooseVariant')) + 3;
const ctx = {}; vm.createContext(ctx);
vm.runInContext(src.slice(start, end) + '\nthis.pick=_bulkChooseVariant;', ctx);
const pick = (m, h) => ctx.pick(m, h);
const common = { normal: 0.08, reverseHolofoil: 0.27 };
ok(pick(common, '').variant === 'normal', 'unknown foil -> Normal, not dearer reverse');
ok(pick(common, 'non_foil').variant === 'normal', 'non-foil -> Normal');
ok(pick(common, 'foil').variant === 'reverseHolofoil', 'foil on a common -> Reverse Holo');
ok(pick(common, 'foil').market === 0.27, 'price follows chosen variant');
const holoRare = { holofoil: 1.2, reverseHolofoil: 2.5 };
ok(pick(holoRare, '').variant === 'holofoil', 'holo-only base printing -> Holo');
ok(pick(holoRare, 'foil').variant === 'holofoil', 'foil holo rare -> Holo');
ok(pick({ firstEditionNormal: 3, unlimited: 1 }, '').variant === 'firstEditionNormal', 'first ed normal ahead of unlimited');
ok(pick({ weirdKey: 4 }, '').variant === 'weirdKey', 'unknown key still priced');
ok(pick({}, '') === null, 'no prices -> null');
ok(pick({ normal: null, holofoil: 2 }, '').variant === 'holofoil', 'null prices skipped');
ok(pick(common, 'bogus').variant === 'normal', 'unknown hint -> base printing');
// Every max-price selection now passes through the chooser.
ok((src.match(/const pick = _bulkChooseVariant\(priceMap, foilHint\)/g) || []).length === 2, 'both Pokemon price paths use chooser');
ok(/rarity, foilHint\) \{/.test(src), '_bulkFetchPrice accepts foilHint');
ok((src.match(/result\.rarity, result\.foilHint\)/g) || []).length === 2, 'scan + name edit pass foil hint');
ok(/data\.foil_hint === 'foil' \|\| data\.foil_hint === 'non_foil'/.test(src), 'client whitelists foil_hint');
// Definite miss: no useless same-photo retry.
ok(/result\.definiteMiss = true;/.test(src), 'miss marks definiteMiss');
ok(/\(result\.photoRejected \|\| result\.definiteMiss\) \? '' :/.test(src), 'retry hidden on definite miss');
ok(src.includes('The same photo gives the same result.'), 'miss hint explains');
// A new batch never starts on the previous batch's "Done!".
{const i=src.indexOf("'Scanning 0 of ' + total + '…'"),w=src.indexOf('async function worker()');
 ok(i>0&&i<w&&w-i<600,'progress label reset before workers start');}
// Server mapping (Ximilar taxonomy: "Foil/Holo", "Non-Foil").
const scan = fs.readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
const fs0 = scan.indexOf('function foilHintFrom');
const ctx2 = {}; vm.createContext(ctx2);
vm.runInContext(scan.slice(fs0, scan.indexOf('\n}\n', fs0) + 3) + '\nthis.f=foilHintFrom;', ctx2);
ok(ctx2.f('Foil/Holo') === 'foil', 'Foil/Holo -> foil');
ok(ctx2.f('Non-Foil') === 'non_foil', 'Non-Foil -> non_foil');
ok(ctx2.f('') === '' && ctx2.f(undefined) === '', 'missing -> empty');
ok((scan.match(/foil_hint: foilHintFrom\(cardInfo\._ximilar_foil\)/g) || []).length === 2, 'single + picker replies carry foil_hint');
console.log(`bulk-variant-choice: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
