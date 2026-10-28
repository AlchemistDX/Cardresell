/* Identity-only catalog snapshots. Prices and finishes are resolved separately.
   Run tools/build-search-catalogs.py, then tools/version-search-catalog.mjs. */
(function(root) {
  'use strict';
  const MANIFEST = '/data/catalog/manifest.4f12e29f2833.json';
  const pending = new Map();
  const names = new WeakMap();
  function fold(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
  async function read(url, signal) {
    const abort = signal ? null : new AbortController();
    const timer = abort && setTimeout(() => abort.abort(), 15000);
    try {
      const res = await fetch(url, {signal:signal || abort.signal});
      if (!res.ok) throw Error('Catalog unavailable');
      return await res.json();
    } finally { clearTimeout(timer); }
  }
  function once(key, fn) {
    if (!pending.has(key)) pending.set(key, Promise.resolve().then(fn).catch(e => {pending.delete(key); throw e;}));
    return pending.get(key);
  }
  async function load(game) {
    return once(game, async () => {
      const manifest = await once('manifest', () => read(MANIFEST));
      const meta = manifest?.games?.[game];
      if (manifest?.schema !== 1 || !meta || !new RegExp('^/data/catalog/'+game+'\\.[a-f0-9]{12}\\.json$').test(meta.url)) throw Error('Catalog not available for this game');
      const data = await read(meta.url);
      if (data?.schema !== 1 || data.game !== game || !Array.isArray(data.cards) || !data.sets || typeof data.sets !== 'object' || Array.isArray(data.sets)) throw Error('Incomplete catalog');
      if (game === 'mtg' && Array.isArray(meta.parts)) {
        if (!meta.parts.length || meta.parts.length > 64 || !Array.isArray(data.parts) || data.parts.length !== meta.parts.length || data.cards.length !== 0) throw Error('Invalid Magic shard index');
        const urls=new Set();let declared=0;
        for (let i=0;i<meta.parts.length;i++) {
          const part=meta.parts[i];
          if (!part || !/^\/data\/catalog\/mtg-part\.[a-f0-9]{12}\.json$/.test(part.url) || urls.has(part.url) || !Number.isSafeInteger(part.count) || part.count < 1 || part.count > 8500 || part.url !== data.parts[i]?.url || part.count !== data.parts[i]?.count) throw Error('Invalid Magic shard');
          urls.add(part.url);declared+=part.count;
        }
        if (declared !== meta.count) throw Error('Incomplete Magic shard index');
        // One deadline for the whole generation; limit concurrent transfers on phones.
        const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
        const chunks=new Array(meta.parts.length);let next=0;
        async function worker() {
          while (next<meta.parts.length) {
            const i=next++,part=meta.parts[i],shard=await read(part.url,abort.signal);
            if (shard?.schema!==1 || shard.game!=='mtg' || !Array.isArray(shard.cards) || shard.cards.length!==part.count) throw Error('Incomplete Magic shard');
            chunks[i]=shard.cards;
          }
        }
        try { await Promise.all(Array.from({length:Math.min(3,meta.parts.length)},worker)); }
        finally {clearTimeout(timer);abort.abort();}
        data.cards=chunks.flat();
      }
      if (data?.schema !== 1 || data.game !== game || !Array.isArray(data.cards) || data.cards.length !== meta.count || !data.cards.length || !data.sets) throw Error('Incomplete catalog');
      if ((data.nativeCards?.length || 0) !== (meta.nativeCount || 0)) throw Error('Incomplete native catalog');
      const ids = new Set(), represented = new Set();
      for (const c of [...data.cards,...(data.nativeCards || [])]) {
        if (!Array.isArray(c) || c.length < 7 || typeof c[0] !== 'string' || !c[0] || typeof c[1] !== 'string' || !c[1] || ids.has(c[0]) || typeof data.sets[c[2]] !== 'string' || c[6] !== (game === 'pokemonjp' ? 'ja' : 'en')) throw Error('Invalid catalog identity');
        if (game === 'mtg' && (c.length !== 10 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c[0]) || !c[1].trim() || typeof c[2] !== 'string' || !Object.prototype.hasOwnProperty.call(data.sets,c[2]) || !data.sets[c[2]].trim() || typeof c[3] !== 'string' || !c[3].trim() || c[8] !== false || !Array.isArray(c[9]) || c[9].some(a => typeof a !== 'string' || !a.trim()))) throw Error('Invalid Magic printing');
        ids.add(c[0]);
        represented.add(c[2]);
      }
      if (game === 'mtg' && (data.provider !== 'Scryfall' || !Number.isSafeInteger(meta.sets) || represented.size !== meta.sets || Object.keys(data.sets).length !== meta.sets || data.nativeCards?.length)) throw Error('Invalid Magic set inventory');
      return data;
    });
  }
  async function search(game, query) {
    const data = await load(game), q = fold(query), tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return {data, rows:[]};
    const nativeQuery = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(q);
    const candidates = nativeQuery && data.nativeCards?.length ? data.nativeCards : data.cards;
    const rows = candidates.filter(c => {
      const text = fold([c[1],data.sets[c[2]],c[3],...(game === 'mtg' && Array.isArray(c[9]) ? c[9] : [])].join(' '));
      return tokens.every(t => text.includes(t));
    });
    rows.sort((a,b) => Number(fold(b[1]) === q) - Number(fold(a[1]) === q));
    return {data,rows};
  }
  // OCR may establish a plausible name, never a printing or a price. Match
  // only names (not set metadata), and leave ambiguous corrections for review.
  async function suggest(game, query) {
    const data = await load(game), q = fold(query);
    if (q.length < 3 || q.length > 120) return null;
    if (!names.has(data)) {
      const index = new Map();
      for (const c of [...data.cards,...(data.nativeCards || [])]) {
        if (c[8] !== true) {
          index.set(fold(c[1]),c[1]);
          if (game === 'mtg' && Array.isArray(c[9])) for (const face of c[9]) index.set(fold(face),face);
        }
      }
      names.set(data,index);
    }
    const index = names.get(data);
    const hit = value => ({name:index.get(value),cardType:game});
    if (index.has(q)) return hit(q);
    // A short sleeve-noise token before an otherwise exact title is common.
    const clean = q.replace(/^[a-z]{1,2} /,'');
    if (clean !== q && index.has(clean)) return hit(clean);
    if (/[^\x00-\x7f]/.test(q)) return null; // Native names require an exact read.
    const limit = Math.min(2,Math.floor(q.replace(/\s/g,'').length * .15));
    if (!limit) return null;
    let best = limit + 1, matches = [];
    for (const name of index.keys()) {
      if (Math.abs(name.length-q.length)>limit || /[^\x00-\x7f]/.test(name)) continue;
      let previous = Array.from({length:name.length+1},(_,i)=>i), distance = limit+1;
      for (let i=1;i<=q.length;i++) {
        const row=[i];
        for(let j=1;j<=name.length;j++) row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+Number(q[i-1]!==name[j-1]));
        if(Math.min(...row)>limit) {distance=limit+1;break;}
        previous=row;distance=row[name.length];
      }
      if(distance<best){best=distance;matches=[name];}
      else if(distance===best)matches.push(name);
    }
    return best<=limit && matches.length===1 ? hit(matches[0]) : null;
  }
  async function byId(game, id) {
    if (game !== 'mtg' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || '')) return null;
    const data = await load(game);
    const card = data.cards.find(c => c[0] === id);
    return card ? {data, rows:[card]} : null;
  }
  function normalized(data,c) {
    const provider = c[0].startsWith('tcgdex:') ? 'TCGdex' : data.provider;
    const id = data.game === 'mtg' && provider === 'Scryfall' ? c[0] : c[0].startsWith('tcgdex:') ? c[0] : provider === 'TCGCSV / TCGplayer' ? 'tcgplayer:'+c[0] : provider === 'TCGdex' ? 'tcgdex:'+c[0] : 'ygoprodeck:'+c[0];
    const image = /^https:\/\//i.test(c[5]) ? c[5] : '';
    return {id, name:c[1],game:data.game,setName:data.sets[c[2]],setCode:c[2],number:c[3],rarity:c[4],language:c[6],
      images:{small:image,large:image.replace(/\/low\.webp$/, '/high.webp')},priceVariants:[],
      source:provider+' catalog — price not checked',updatedAt:'',catalogAsOf:data.asOf,catalogPresale:c[8]===true,releaseDate:c[7] || '',_localCatalogFallback:true};
  }
  root.CardResellCatalog = Object.freeze({load,search,suggest,byId,normalized});
})(typeof window === 'undefined' ? globalThis : window);
