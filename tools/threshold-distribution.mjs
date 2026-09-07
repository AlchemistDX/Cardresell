const UA = { headers: { 'User-Agent': 'cardresell-threshold-audit/1.0' } };
const BASE = 'https://tcgcsv.com/tcgplayer';
const CATS = { Pokemon: 3, MTG: 1, YuGiOh: 2, Lorcana: 71, 'One Piece': 68 };
const rows = [];
for (const [name, cat] of Object.entries(CATS)) {
  let groups = [];
  try { groups = (await (await fetch(`${BASE}/${cat}/groups`, UA)).json()).results || []; } catch {}
  // spread across the catalog rather than the first N listed
  const step = Math.max(1, Math.floor(groups.length / 14));
  const pick = groups.filter((_, i) => i % step === 0).slice(0, 14);
  for (const g of pick) {
    try {
      const res = (await (await fetch(`${BASE}/${cat}/${g.groupId}/prices`, UA)).json()).results || [];
      for (const p of res) {
        const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
        const mid = num(p.midPrice);
        if (mid) rows.push({ game: name, mid, hi: num(p.highPrice), mk: num(p.marketPrice), lo: num(p.lowPrice) });
      }
    } catch {}
  }
  console.log(`${name}: ${rows.filter(r => r.game === name).length}`);
}
const pct = (n, d) => d ? (100*n/d).toFixed(2)+'%' : '—';
const mm = rows.filter(r => r.mk).map(r => r.mk / r.mid);
const hm = rows.filter(r => r.hi).map(r => r.hi / r.mid);
console.log(`\nn = ${rows.length}`);
console.log(`\nmarket/mid  max = ${Math.max(...mm).toFixed(3)}   (divergence needs > 3.0 to fire)`);
console.log(`  > 3.0 : ${mm.filter(x=>x>3).length}  (${pct(mm.filter(x=>x>3).length, mm.length)})`);
console.log(`  < 1/3 : ${mm.filter(x=>x<1/3).length}  (${pct(mm.filter(x=>x<1/3).length, mm.length)})`);
const inv = mm.filter(x => x > 1.1765);
console.log(`  > 1.1765 (floor inverts): ${inv.length}  (${pct(inv.length, mm.length)})`);
console.log(`  of those undisclosed (<=3): ${inv.filter(x=>x<=3).length}  (${pct(inv.filter(x=>x<=3).length, inv.length)})`);
console.log(`\nhigh/mid  clamped by 3x: ${pct(hm.filter(x=>x>3).length, hm.length)}   above cited 10x harm: ${pct(hm.filter(x=>x>10).length, hm.length)}`);
console.log(`  in 3x–10x (clamped, below cited harm): ${pct(hm.filter(x=>x>3&&x<=10).length, hm.length)}`);
console.log(`  in 1.53x–3x (blend inversion band): ${pct(hm.filter(x=>x>1.5294&&x<=3).length, hm.length)}`);
console.log(`  excluded from the blend by H<=D*3: ${pct(hm.filter(x=>x>3).length, hm.length)}`);
