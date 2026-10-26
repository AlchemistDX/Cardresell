/* Explicit catalogue recovery for a failed scan. Never submits a photo or spends credits. */
(() => {
  'use strict';
  let active = null;
  const searches = new WeakMap();
  const text = value => typeof value === 'string' ? value.trim().slice(0,240) : '';
  const quote = value => '"' + text(value).replace(/["\\\x00-\x1f]/g, ' ') + '"';
  const price = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  function artwork(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password &&
        ['cards.scryfall.io','c1.scryfall.com','images.pokemontcg.io'].includes(u.hostname) ? u.href : '';
    } catch (_) { return ''; }
  }
  function candidate(card, game) {
    if (!card || !text(card.id) || !text(card.name)) return null;
    if (game === 'mtg' && (card.lang !== 'en' || !card.games?.includes('paper'))) return null;
    const setName = text(game === 'mtg' ? card.set_name : card.set?.name);
    const number = text(game === 'mtg' ? card.collector_number : card.number);
    if (!setName || !number) return null;
    const prices = {};
    if (game === 'mtg') {
      for (const [finish,key] of [['nonfoil','usd'],['foil','usd_foil'],['etched','usd_etched']]) {
        if (card.finishes?.includes(finish)) prices[key] = price(card.prices?.[key]);
      }
    } else {
      for (const [key,p] of Object.entries(card.tcgplayer?.prices || {})) {
        if (/^(normal|holofoil|reverseHolofoil|1stEditionHolofoil|1stEditionNormal|unlimitedHolofoil|unlimitedNormal)$/.test(key))
          prices[key] = price(p?.market) ?? price(p?.mid);
      }
    }
    const variant = Object.keys(prices)[0] || '';
    return {cardName:text(card.name),setName,cardNumber:number,groundedId:text(card.id),
      setCode:text(game === 'mtg' ? card.set : card.set?.id),cardType:game,isJapanese:false,
      rarity:text(card.rarity),foilHint:'',
      imageUrl:artwork(game === 'mtg' ? card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal : card.images?.large || card.images?.small),
      info:{prices,variant,marketPrice:prices[variant] ?? null}};
  }
  const eligible = row => row && !window._bulkProcessing && !window._bulkSaved && !window._bulkDraftBusy &&
    !row.success && (row.definiteMiss || row.photoRejected) &&
    !row._rescanning && !row._photoChecking && !row._replacementPhoto;
  function current(s) {
    return active === s && window._bulkResults === s.results && s.results.includes(s.row) &&
      window._bulkQueue === s.queue && window._fbAuth?.currentUser === s.owner &&
      s.row.file === s.file && eligible(s.row);
  }
  function close() {
    const s = active; active = null;
    if (!s) return;
    s.request?.abort(); clearInterval(s.watch);
    s.dialog.close(); s.dialog.remove();
    if (s.opener?.isConnected) s.opener.focus();
  }
  function node(tag, value, parent, attrs = {}) {
    const el = document.createElement(tag);
    if (value) el.textContent = value;
    for (const [key,v] of Object.entries(attrs)) el.setAttribute(key,v);
    parent?.appendChild(el); return el;
  }
  function picture(src, alt, parent) {
    const unavailable = () => node('span','Image unavailable',parent);
    if (!src) { unavailable(); return; }
    const img = node('img','',parent,{src,alt,loading:'lazy'});
    img.addEventListener('error',()=>{img.remove();unavailable()});
  }
  function style() {
    if (document.getElementById('bulkLookupStyles')) return;
    const css = node('style','',document.head,{id:'bulkLookupStyles'});
    css.textContent = `#bulkLookupDialog{box-sizing:border-box;width:min(620px,calc(100% - 20px));max-width:calc(100% - 20px);max-height:calc(100dvh - 24px);margin:auto;padding:18px;background:#14121c;color:#f3f0ff;border:1px solid #655281;border-radius:16px;overflow:auto;font:16px/1.45 system-ui}
      #bulkLookupDialog::backdrop{background:#000b}#bulkLookupDialog *{box-sizing:border-box}
      #bulkLookupDialog header{display:flex;align-items:center;justify-content:space-between;gap:12px}
      #bulkLookupDialog h2{font-size:21px;margin:0}#bulkLookupDialog p{margin:10px 0;color:#d3cddd}
      #bulkLookupDialog button,#bulkLookupDialog input,#bulkLookupDialog select{font:inherit;min-height:44px;border:1px solid #70637e;border-radius:9px;padding:9px 12px;background:#262132;color:#fff;max-width:100%}
      #bulkLookupDialog button{cursor:pointer}#bulkLookupDialog button:disabled{opacity:.5;cursor:default}
      #bulkLookupDialog :focus-visible{outline:3px solid #c4b5fd;outline-offset:2px}
      #bulkLookupDialog label{display:block;margin:10px 0}#bulkLookupDialog input,#bulkLookupDialog select{display:block;width:100%;margin-top:4px}
      #bulkLookupDialog .lookup-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      #bulkLookupDialog .lookup-results button{text-align:left;overflow-wrap:anywhere;display:flex;flex-direction:column;align-items:center;gap:7px;font-size:14px}
      #bulkLookupDialog img{object-fit:contain;width:100%;height:150px}#bulkLookupDialog .lookup-compare{display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center}
      #bulkLookupDialog .lookup-compare img{height:210px}#bulkLookupDialog .lookup-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
      #bulkLookupDialog .lookup-photo{margin:12px 0}#bulkLookupDialog .lookup-photo summary{cursor:pointer;min-height:44px;padding:10px 0}
      #bulkLookupDialog .lookup-photo img{height:min(42dvh,320px);display:block}
      #bulkLookupDialog .lookup-primary{background:#7748d2;border-color:#bca1ef;font-weight:700}
      #bulkLookupDialog [hidden]{display:none!important}`;
  }
  function open(rowId) {
    close();
    const results = window._bulkResults || [], row = results.find(r=>r?.rowId === rowId);
    if (!eligible(row)) return;
    style();
    const dialog = node('dialog','',document.body,{id:'bulkLookupDialog','aria-labelledby':'bulkLookupTitle'});
    const s = active = {dialog,row,results,queue:window._bulkQueue,owner:window._fbAuth?.currentUser,
      file:row.file,opener:document.activeElement,generation:0,request:null};
    const header = node('header','',dialog);
    const title = node('h2','Find this card',header,{id:'bulkLookupTitle',tabindex:'-1'});
    node('button','Close',header,{type:'button'}).onclick = close;
    node('p','Search by its printed name, then choose the matching picture, set and card number. No scan credits are used.',dialog);
    const searchView = node('div','',dialog);
    const photo = node('details','',searchView,{class:'lookup-photo',open:''});
    node('summary','Your card photo',photo);
    picture(row.objectUrl || row.imageDataUrl,'Your card — read its printed name and number',photo);
    const form = node('form','',searchView);
    const field = (label,tag,attrs) => node(tag,'',node('label',label,form),attrs);
    const game = field('Game','select',{name:'game'});
    node('option','Magic: The Gathering (English)',game,{value:'mtg'});
    node('option','Pokémon (English)',game,{value:'pokemon'});
    const existingGames = [...new Set(results.filter(r=>r?.success).map(r=>r.cardType))];
    game.value = existingGames.length === 1 && existingGames[0] === 'pokemon' ? 'pokemon' : 'mtg';
    const name = field('Card name','input',{name:'name',required:'',maxlength:'120',autocomplete:'off',placeholder:'e.g. Elite Interceptor'});
    const number = field('Card number (optional)','input',{name:'number',maxlength:'30',autocomplete:'off',placeholder:'e.g. 123'});
    const savedSearch = searches.get(row);
    if (savedSearch?.owner === s.owner && savedSearch?.file === s.file) {
      game.value=savedSearch.game; name.value=savedSearch.name; number.value=savedSearch.number;
    } else {
      const read=window.CardResellScanTextRecovery?.suggestion(row);
      if(read && ['mtg','pokemon'].includes(read.game)) {game.value=read.game;name.value=read.name;}
    }
    name.placeholder = game.value === 'mtg' ? 'e.g. Elite Interceptor' : 'e.g. Plusle';
    const remember = () => searches.set(row,{owner:s.owner,file:s.file,game:game.value,name:name.value,number:number.value});
    const submit = node('button','Search catalogue',form,{type:'submit',class:'lookup-primary'});
    const status = node('p','',searchView,{role:'status','aria-live':'polite'});
    const list = node('div','',searchView,{class:'lookup-results'});
    const paging = node('div','',searchView,{class:'lookup-actions'});
    const previous = node('button','Previous page',paging,{type:'button',hidden:''});
    const next = node('button','Next page',paging,{type:'button',hidden:''});
    const confirm = node('section','',dialog,{hidden:''});
    let query = null, page = 1, more = false;
    const invalidate = () => {
      s.generation++; s.request?.abort(); list.replaceChildren(); status.textContent='';
      query=null; previous.hidden=next.hidden=true; submit.disabled=false;
    };
    name.oninput = number.oninput = () => { remember(); invalidate(); };
    game.onchange = () => { remember(); invalidate(); name.placeholder = game.value === 'mtg' ? 'e.g. Elite Interceptor' : 'e.g. Plusle'; };
    function choose(card) {
      if (!current(s)) return close();
      searchView.hidden=true; confirm.hidden=false; confirm.replaceChildren();
      node('h3',card.cardName,confirm);
      node('p',`${card.setName} · #${card.cardNumber} · English`,confirm);
      const compare = node('div','',confirm,{class:'lookup-compare'});
      const yours = node('div','',compare); node('p','Your photo',yours); picture(row.objectUrl || row.imageDataUrl,'Your card',yours);
      const reference = node('div','',compare); node('p','Catalogue printing',reference); picture(card.imageUrl,'Selected catalogue printing',reference);
      node('p','Check the artwork, set and number against your card. You can set its condition and finish in the batch.',confirm);
      if (card.cardType === 'mtg') node('p','We’ll also try to recover other cards from this set. No extra scan credits.',confirm);
      const actions = node('div','',confirm,{class:'lookup-actions'});
      node('button','Back to results',actions,{type:'button'}).onclick=()=>{confirm.hidden=true;searchView.hidden=false;submit.focus()};
      const use = node('button','Use this printing',actions,{type:'button',class:'lookup-primary'});
      use.onclick = () => {
        if (!current(s)) return close();
        // Update this physical copy in place. Photo, scan/copy IDs, quantity,
        // condition and seller metadata remain intact; nothing is saved yet.
        const {info,...identity} = card;
        searches.delete(row);
        Object.assign(row,identity,{success:true,manualIdentity:true,error:'',definiteMiss:false,photoRejected:false,
          textRescue:false,marketPrice:null,priceVariant:'',priceSource:null,tcgplayerUrl:'',unavailableReason:''});
        window._scanApplyFinishReview?.(row,info);
        close();
        window._bulkUpdateRow?.(row.rowId,row);
        window._bulkRefreshResultSummary?.();
        window._bulkDetectDuplicates?.();
        // A page with zero Magic matches has no trusted set for name rescue.
        // The seller's confirmed printing supplies that first set explicitly.
        if (row.cardType === 'mtg' && typeof window._bulkTextRescueMisses === 'function')
          window._bulkTextRescueMisses().catch(() => {});
      };
      use.focus();
    }
    async function search(target) {
      if (!current(s)) return close();
      if (!query) return;
      const version = ++s.generation, controller = new AbortController();
      s.request?.abort(); s.request=controller;
      const timeout = setTimeout(()=>controller.abort(),15000);
      submit.disabled=true; previous.hidden=next.hidden=true; list.replaceChildren(); status.textContent='Searching…';
      const snapshot = query;
      try {
        const mtg = snapshot.game === 'mtg';
        const url = new URL(mtg ? 'https://api.scryfall.com/cards/search' : 'https://api.pokemontcg.io/v2/cards');
        url.searchParams.set('q', (mtg ? `name:${quote(snapshot.name)} game:paper lang:en` : `name:${quote(snapshot.name)}`) +
          (snapshot.number ? ` ${mtg?'cn':'number'}:${quote(snapshot.number)}` : ''));
        url.searchParams.set('page',String(target));
        if (mtg) { url.searchParams.set('unique','prints'); url.searchParams.set('order','released'); url.searchParams.set('dir','desc'); }
        else { url.searchParams.set('pageSize','24'); url.searchParams.set('orderBy','-set.releaseDate'); url.searchParams.set('select','id,name,set,number,rarity,images,tcgplayer'); }
        const response = await fetch(url.href,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});
        const body = response.status === 404 && mtg ? {data:[]} : response.ok ? await response.json() : null;
        if (version !== s.generation || !current(s)) return;
        if (!body || !Array.isArray(body.data)) throw new Error(response.status === 429 ? 'Catalogue is busy. Wait a moment and search again.' : 'Catalogue could not be reached. Please try again.');
        const cards = body.data.map(c=>candidate(c,snapshot.game)).filter(Boolean);
        page=target; more = mtg ? body.has_more === true : target * 24 < Number(body.totalCount);
        status.textContent = cards.length ? `Page ${page} · Choose the printing that matches your card.` : 'No matching cards. Check the name or try without the card number.';
        for (const card of cards) {
          const button = node('button','',list,{type:'button'});
          picture(card.imageUrl,'',button); node('strong',card.cardName,button);
          node('span',`${card.setName} · #${card.cardNumber}`,button);
          button.onclick=()=>choose(card);
        }
        previous.hidden=page<=1; next.hidden=!more;
        node('p',mtg?'Card data: Scryfall':'Card data: Pokémon TCG API',list).style.gridColumn='1 / -1';
      } catch (error) {
        if (version === s.generation && current(s)) {
          status.textContent=error.name==='AbortError'?'Search timed out. Your batch is unchanged; try again.':error.message;
          previous.hidden=page<=1; next.hidden=!more;
        }
      } finally {
        clearTimeout(timeout);
        if (version === s.generation && active === s) submit.disabled=false;
      }
    }
    form.onsubmit = event => {
      event.preventDefault();
      if (!name.value.trim()) return;
      query={game:game.value,name:name.value.trim(),number:number.value.trim().replace(/\/.*$/,'')};
      page=1;more=false;search(1);
    };
    previous.onclick=()=>search(page-1); next.onclick=()=>search(page+1);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
    // A result may finish rescuing, be removed, or change accounts while open.
    s.watch=setInterval(()=>{if (!current(s)) close()},250);
    dialog.showModal();
    // Keep the reference photo visible on phones instead of opening the keyboard.
    if (matchMedia('(pointer:coarse)').matches) title.focus(); else name.focus();
  }
  window.CardResellBulkLookup = {open,close,isEditing:row=>active?.row===row};
})();
