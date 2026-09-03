// Unit test for filterSportsParallel / pcParallelOf in api/pricecharting.js.
// These are module-private, so we extract them by source and eval.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../api/pricecharting.js', import.meta.url), 'utf8');

function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`missing function ${name}`);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}
const filterSportsParallel = eval(
  `(() => { ${grab('pcParallelOf')} ${grab('_parNorm')} ${grab('filterSportsParallel')} return filterSportsParallel; })()`
);

const P = n => ({ 'product-name': n });
let pass = 0, fail = 0;
const t = (msg, cond) => { if (cond) { pass++; } else { fail++; console.error('FAIL: ' + msg); } };

// The live bug: prod returned [Silver Prizm Fast Break] for parallel="Silver Prizm"
// at confidence "high". A superset bracket is a different, rarer card.
{
  const r = filterSportsParallel(
    [P('Victor Wembanyama [Silver Prizm Fast Break] #136'), P('Victor Wembanyama #136')],
    'Silver Prizm'
  );
  t('Silver Prizm does not silently become Silver Prizm Fast Break', r.keep.length === 0);
  t('refusal names the actual parallel found', /fast break/i.test(r.reason || ''));
  t('refusal tells the user to pick', /pick the exact one/.test(r.reason || ''));
}

// Exact match still works, and beats a superset present in the same pool.
{
  const exact = P('Luka Doncic [Silver Prizm] #280');
  const r = filterSportsParallel([P('Luka Doncic [Silver Prizm Fast Break] #280'), exact, P('Luka Doncic #280')], 'Silver Prizm');
  t('exact bracket match wins', r.keep.length === 1 && r.keep[0] === exact);
  t('exact match carries no refusal reason', r.reason === null);
}

// Case and punctuation are not significant.
{
  const r = filterSportsParallel([P('X [Pink Ice Prizm] #1')], 'pink   ice prizm');
  t('normalizes case and whitespace', r.keep.length === 1);
}

// Per-token matching: "gold" must not match "goldenrod".
{
  const r = filterSportsParallel([P('X [Goldenrod Refractor] #1')], 'Gold');
  t('gold does not substring-match goldenrod', r.keep.length === 0);
  t('non-match reports no-such-parallel, not a superset list', /no 'gold' parallel/.test(r.reason || ''));
}

// No parallel requested -> base card only, never a parallel.
{
  const base = P('Luka Doncic #280');
  const r = filterSportsParallel([P('Luka Doncic [Silver Prizm] #280'), base], '');
  t('no parallel asked -> bare candidate only', r.keep.length === 1 && r.keep[0] === base);
}

// Card exists only as parallels -> refuse rather than guess which one.
{
  const r = filterSportsParallel([P('X [Silver Prizm] #1'), P('X [Gold Prizm] #1')], '');
  t('parallels-only refuses', r.keep.length === 0);
  t('parallels-only lists what exists', /silver prizm/i.test(r.reason || '') && /gold prizm/i.test(r.reason || ''));
}

console.log(`sports-parallel: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
