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
ok(pick(common, 'foil').variant === 'normal', 'generic foil tag cannot establish reverse holo');
ok(pick(common, 'foil').market === 0.08, 'ambiguous finish uses base estimate');
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
// Screenshot regression: the quoted reverse prices are from the owner's rows;
// normal prices below are synthetic fixtures, not current card valuations.
const finishRef = html.match(/\/js\/(scan-finish\.[0-9a-f]{8}\.js)/)[1];
const finishCtx = {}; vm.createContext(finishCtx);
vm.runInContext(fs.readFileSync(new URL('../js/'+finishRef,import.meta.url),'utf8'),finishCtx);
for (const premium of [45.26,44.58,16.23]) {
  const row={cardType:'pokemon',foilHint:'foil',marketPrice:premium};
  finishCtx._scanApplyFinishReview(row,{variant:'reverseHolofoil',prices:{normal:{market:0.50},reverseHolofoil:{market:premium}}});
  ok(row.marketPrice===0.50 && row.finishKey==='normal','premium '+premium+' does not inflate ambiguous binder row');
  ok(row.finishBasis==='base_printing' && !row.finishConfirmed && !row.finishReviewRequired,'base assumption explicit and nonblocking');
  ok(finishCtx._scanFinishFields(row).finishBasis==='base_printing','base assumption survives saving');
  finishCtx._scanChooseFinish(row,'reverseHolofoil');
  ok(row.marketPrice===premium && row.finishConfirmed && !row.finishBasis,'seller can choose exact reverse price instantly');
}
for (const basePrice of [null,0]) {
  const row={cardType:'pokemon',foilHint:'foil'};
  finishCtx._scanApplyFinishReview(row,{variant:'reverseHolofoil',prices:{normal:{market:basePrice},reverseHolofoil:{market:45.26}}});
  ok(row.marketPrice===basePrice,'missing/zero normal price never falls through to premium');
}
const onlyHolo={cardType:'pokemon',foilHint:'foil'};
finishCtx._scanApplyFinishReview(onlyHolo,{variant:'holofoil',prices:{holofoil:12}});
ok(onlyHolo.marketPrice===12 && onlyHolo.finishKey==='holofoil','holo-only catalogue retains price');
const onlyReverse={cardType:'pokemon',foilHint:'foil'};
finishCtx._scanApplyFinishReview(onlyReverse,{variant:'reverseHolofoil',prices:{reverseHolofoil:45.26}});
ok(onlyReverse.marketPrice===null && !onlyReverse.finishKey,'reverse-only feed is not proof of reverse printing');
finishCtx._scanChooseFinish(onlyReverse,'reverseHolofoil');
ok(onlyReverse.marketPrice===45.26 && onlyReverse.finishConfirmed,'reverse-only quote available after optional selection');
const mtg={cardType:'mtg',foilHint:'foil'};
finishCtx._scanApplyFinishReview(mtg,{variant:'usd',prices:{usd:1,usd_foil:5}});
ok(mtg.marketPrice===5,'other game finish handling unchanged');
console.log(`bulk-variant-choice: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
