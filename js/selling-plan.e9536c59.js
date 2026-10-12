/* Read-only selling estimates. Uses the existing fee engine, never submits listings.
   Each single is a separate order. A lot is one order at the seller's target price. */
(() => {
  'use strict';
  const money = n => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(n);
  const cents = n => Math.round((n + Number.EPSILON) * 100);
  const validPrice = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const quantity = r => Number.isSafeInteger(r.qty) && r.qty > 0 ? r.qty : 1;
  const names = {ebay:'eBay', tcgplayer:'TCGplayer Marketplace', mercari:'Mercari'};
  const games = new Set(['pokemon','mtg','yugioh','lorcana','onepiece','digimon','dragonball']);
  function summarize(rows) {
    return rows.reduce((s,r) => {
      const q = quantity(r); s.count += q;
      if (validPrice(r.price)) { s.valueCents += cents(r.price) * q; s.priced += q; }
      else s.missing += q;
      return s;
    }, {count:0, priced:0, missing:0, valueCents:0});
  }
  function tcgEligible(r) {
    return games.has(r.game) && !r.graded && !r.japanese;
  }
  function calculate(rows, options, feeFor) {
    const selected = rows.filter(r => r.selected !== false), summary = summarize(selected);
    const out = {summary, singles:[], lots:[], split:null};
    if (!summary.count || summary.missing) return out;
    const one = (pid, price, ship, postage) => {
      const fees = cents(feeFor(pid,price,ship));
      return {gross:cents(price)+cents(ship), fees, postage:cents(postage), net:cents(price)+cents(ship)-fees-cents(postage)};
    };
    const add = (a,b,q=1) => { for (const k of ['gross','fees','postage','net']) a[k] += b[k]*q; return a; };
    const zero = () => ({gross:0,fees:0,postage:0,net:0});
    const eligible = (pid,r) => pid !== 'tcgplayer' || tcgEligible(r);
    const byCard = selected.map(r => ({row:r, quotes:options.venues.filter(pid=>eligible(pid,r)).map(pid=>({pid,...one(pid,r.price,options.singleShip,options.singlePostage)})).sort((a,b)=>b.net-a.net)}));
    for (const pid of options.venues) {
      if (selected.every(r=>eligible(pid,r))) {
        const sum = zero(); for (const r of selected) add(sum,one(pid,r.price,options.singleShip,options.singlePostage),quantity(r));
        out.singles.push({pid,...sum});
      }
      // Mixed-game / graded TCG lots need a product/category check we cannot infer.
      const lotOK = selected.every(r=>eligible(pid,r)) && (pid !== 'tcgplayer' || new Set(selected.map(r=>r.game)).size === 1);
      if (lotOK && validPrice(options.lotPrice)) out.lots.push({pid,...one(pid,options.lotPrice,options.lotShip,options.lotPostage)});
    }
    out.singles.sort((a,b)=>b.net-a.net); out.lots.sort((a,b)=>b.net-a.net);
    if (byCard.every(c=>c.quotes.length)) {
      const sum = zero(), assignments=[];
      for (const c of byCard) { const best=c.quotes[0], q=quantity(c.row); add(sum,best,q); assignments.push({row:c.row,pid:best.pid,net:best.net*q,qty:q}); }
      out.split = {...sum,assignments};
    }
    return out;
  }
  function fromBulk() {
    const rows=(window._bulkResults||[]).filter(r=>r && r.success);
    const selected=rows.filter(r=>typeof _bulkDraftIsSelected==='function' && _bulkDraftIsSelected(r));
    const chosen=selected.length ? selected : rows;
    const allCount=rows.reduce((n,r)=>n+quantity(r),0), count=chosen.reduce((n,r)=>n+quantity(r),0);
    const packCost=Math.max(0,Number(window._bulkStartPackCost)||0), perCopy=allCount?packCost/allCount:0;
    return {rows:chosen.map(r=>({name:r.cardName||'Unnamed card',price:r.marketPrice,cost:perCopy,qty:quantity(r),game:r.cardType||'',japanese:r.isJapanese||r.cardType==='pokemonjp',graded:false,source:r.priceSource==='seller'?'Your price':'Scan price'})), cost:perCopy*count};
  }
  function openBulk() { const batch=fromBulk(); open(batch.rows,batch.cost,'Bulk scan'); }
  function openCollection(cards) {
    open(cards.map(r=>({name:r.card||'Unnamed card',price:r.currentValue,cost:validPrice(r.buyPrice)?r.buyPrice:0,qty:1,game:r.game||r.cardType||'',japanese:r.isJapanese||r.game==='pokemonjp',graded:!!(r.grader && r.grade!=null && r.grade!==''),source:'Saved value'})),cards.reduce((n,r)=>n+(validPrice(r.buyPrice)?r.buyPrice:0),0),'Collection');
  }
  function open(input,cost,source) {
    if (!input.length) { if(typeof showToast==='function') showToast('Select at least one identified card.'); return; }
    const previous=document.getElementById('sellingPlan');if(previous){previous.close();previous.remove();}
    const rows=input.map(r=>({...r,selected:true}));
    const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
    const dialog=el('dialog'); dialog.id='sellingPlan'; dialog.setAttribute('aria-labelledby','sellingPlanTitle');
    const style=el('style');style.textContent=`#sellingPlan{box-sizing:border-box;width:min(960px,96vw);max-height:92dvh;border:1px solid #645184;border-radius:16px;padding:0;background:var(--bg,#171717);color:var(--text,#eee);overflow:auto;z-index:11000}#sellingPlan::backdrop{background:#000b}#sellingPlan *{box-sizing:border-box}#sellingPlan header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid #666}#sellingPlan h2{margin:0;font-size:1.3rem}#sellingPlan .sp-body{padding:16px}#sellingPlan p{font-size:.88rem;line-height:1.5}#sellingPlan button,#sellingPlan input,#sellingPlan select{font:inherit;color:inherit;background:var(--panel,#252525);border:1px solid #777;border-radius:8px;min-height:44px;padding:8px}#sellingPlan button{cursor:pointer}#sellingPlan .sp-inputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}#sellingPlan label{display:flex;flex-direction:column;gap:5px;font-size:.82rem}#sellingPlan input[type=number]{width:100%}#sellingPlan .sp-card{display:grid;grid-template-columns:28px minmax(0,1fr) 110px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #666}#sellingPlan .sp-card label{overflow-wrap:anywhere}#sellingPlan input[type=checkbox]{width:22px;height:22px;min-height:22px;accent-color:#9060de}#sellingPlan details{margin:16px 0}#sellingPlan summary{cursor:pointer;min-height:44px;padding:10px 0;font-weight:700}#sellingPlan table{width:100%;border-collapse:collapse;font-size:.83rem}#sellingPlan th,#sellingPlan td{padding:10px 6px;border-bottom:1px solid #666;text-align:left;vertical-align:top}#sellingPlan .sp-table{overflow:auto}#sellingPlan .sp-highlight{padding:14px;border:1px solid #9060de;border-radius:10px;margin:12px 0}#sellingPlan .sp-note{color:var(--muted,#aaa)}#sellingPlan .sp-error{color:#ef965c;font-weight:700}#sellingPlan a{color:var(--gold-text,#c99437)}@media(max-width:440px){#sellingPlan .sp-card{grid-template-columns:24px minmax(0,1fr) 90px}#sellingPlan .sp-body{padding:12px}}`;
    dialog.append(style); const header=el('header'), title=el('h2','Where should I sell these cards?');title.id='sellingPlanTitle';
    const close=el('button','Close');close.type='button';close.onclick=()=>dialog.close();header.append(title,close);dialog.append(header);
    const body=el('div',null,'sp-body');dialog.append(body);
    body.append(el('p',`${source} · Sell together or individually. Estimates for US sellers in USD.`));
    const profile=typeof _crSellerProfile==='function'?_crSellerProfile():{};
    const venues=Object.keys(names).filter(pid=>typeof venueEligible==='function' && venueEligible(pid,true,_venueTier()));
    body.append(el('p',`Compared venues: ${venues.map(v=>names[v]).join(', ')||'none enabled'}. Based on your enabled venues and plan.`,'sp-note'));
    const summary=el('div');summary.id='sellingPlanSummary';summary.setAttribute('role','status');body.append(summary);
    const settings=el('details');settings.append(el('summary','Adjust lot price, shipping and purchase cost'));body.append(settings);
    const fields=el('div',null,'sp-inputs');settings.append(fields);const inputs={};let lotEdited=false,costEdited=false;
    function field(key,label,value) {const wrap=el('label',label), i=el('input');i.type='number';i.min='0';i.step='.01';i.value=String(value);i.setAttribute('aria-label',label);i.oninput=()=>{if(key==='lotPrice')lotEdited=true;if(key==='cost')costEdited=true;render();};inputs[key]=i;wrap.append(i);fields.append(wrap);}
    const initial=summarize(rows);
    field('lotPrice','Target price for the whole lot ($)',initial.missing?'':(initial.valueCents/100).toFixed(2));
    field('lotPostage','Lot: your postage + packing ($)',0);field('lotShip','Lot: shipping paid by buyer ($)',0);
    field('singlePostage','Singles: postage + packing per card ($)',0);field('singleShip','Singles: shipping paid by buyer per card ($)',0);
    field('cost','Purchase cost of these cards ($)',validPrice(cost)?cost.toFixed(2):0);
    const tl=el('label','TCGplayer seller-shipped Marketplace account'), tier=el('select');tier.setAttribute('aria-label','TCGplayer Marketplace account');
    for(const [v,t] of [['l14','Level 1–4'],['pro','Pro (non-Direct)']]){const o=el('option',t);o.value=v;tier.append(o);}tier.value=profile.tcgLevel==='pro'?'pro':'l14';tier.onchange=render;tl.append(tier);fields.append(tl);
    settings.append(el('p','Lot price starts at the sum of known singles values; change it to your intended asking price. It is not a lot appraisal or a buyer offer. Shipping starts at $0—enter your real costs. Singles assume a separate sale and shipment for every copy.','sp-note'));
    const detail=el('details'), ds=el('summary','Review cards and adjust prices');detail.append(ds);body.append(detail);
    function syncDefaults(){const chosen=rows.filter(r=>r.selected),s=summarize(chosen);if(!lotEdited)inputs.lotPrice.value=s.missing?'':(s.valueCents/100).toFixed(2);if(!costEdited)inputs.cost.value=chosen.reduce((n,r)=>n+(validPrice(r.cost)?r.cost:0)*quantity(r),0).toFixed(2);}
    const resetLot=el('button','Use selected singles total as lot price');resetLot.type='button';resetLot.onclick=()=>{lotEdited=false;syncDefaults();render();};detail.append(resetLot);
    rows.forEach(r=>{const line=el('div',null,'sp-card'), check=el('input');check.type='checkbox';check.checked=true;check.setAttribute('aria-label','Include '+r.name);check.onchange=()=>{r.selected=check.checked;syncDefaults();render();};const label=el('div',`${r.name} × ${quantity(r)} · ${r.source}`), price=el('input');price.type='number';price.min='0';price.step='.01';price.value=validPrice(r.price)?r.price.toFixed(2):'';price.setAttribute('aria-label','Price per copy: '+r.name);price.oninput=()=>{r.price=price.value.trim()===''?null:Number(price.value);syncDefaults();render();};line.append(check,label,price);detail.append(line);});
    const assumptions=el('p',null,'sp-note');assumptions.id='sellingPlanAssumptions';settings.after(assumptions);
    const results=el('div');results.id='sellingPlanResults';results.setAttribute('aria-live','polite');assumptions.after(results);
    const notes=el('p',`Same entered sale prices are used across venues; actual demand and sale prices can differ. eBay uses your ${profile.ebayStore==='basic'?'Basic-or-higher Store':'no-Store/Starter'} profile and ${Number(profile.ebayPromo)||0}% promoted rate, without a Top Rated Plus discount. TCGplayer uses seller-shipped Marketplace rates, not Direct. Buyer-tax effects, listing/subscription fees, refunds and cash-out extras are excluded. Review card identity, condition and price freshness before listing. Price edits here only change this estimate; saved cards are unchanged. Other venues, dealer offers and consignment are not compared here.`,'sp-note');body.append(notes);
    const sources=el('p','Fee and listing details: ');
    for(const [name,url] of [['eBay','https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822'],['TCGplayer fees','https://help.tcgplayer.com/hc/en-us/articles/201357836-TCGplayer-Fees'],['TCGplayer lots','https://help.tcgplayer.com/hc/en-us/articles/360008108714-How-to-List-Bulk-Lots-on-TCGplayer'],['Mercari','https://www.mercari.com/us/help_center/article/169/']]){const a=el('a',name);a.href=url;a.target='_blank';a.rel='noopener noreferrer';sources.append(a,document.createTextNode(' · '));}body.append(sources);
    function table(caption,quotes,costCents) {
      const section=el('section');section.append(el('h3',caption));
      if(!quotes.length){section.append(el('p','No compared venue can cover this selection. TCGplayer needs supported raw cards; a lot must use one game. Check your enabled venues.'));return section;}
      const wrap=el('div',null,'sp-table'), t=el('table'), head=el('tr');for(const s of ['Venue','Net payout','After cost'])head.append(el('th',s));t.append(head);
      quotes.forEach(q=>{const tr=el('tr'), venue=el('td',names[q.pid]);const costs=el('div',`Fees ${money(q.fees/100)} · Postage ${money(q.postage/100)}`,'sp-note');costs.style.fontSize='.72rem';venue.append(costs);tr.append(venue,el('td',money(q.net/100)),el('td',money((q.net-costCents)/100)));t.append(tr);});wrap.append(t);section.append(wrap);return section;
    }
    function render() {
      const selected=rows.filter(r=>r.selected), s=summarize(selected);summary.textContent=`${s.count} selected card${s.count===1?'':'s'} · ${s.missing?'Known subtotal':'Selected value'} ${money(s.valueCents/100)}${s.missing?` · ${s.missing} missing a price`:''}`;
      const opts={venues}, invalid=[];for(const [key,i] of Object.entries(inputs)){const n=i.value.trim()===''?0:Number(i.value);if(i.validity.badInput||!Number.isFinite(n)||n<0)invalid.push(key);opts[key]=n;}
      opts.lotPrice=inputs.lotPrice.value.trim()===''?null:opts.lotPrice;
      assumptions.textContent=invalid.length?'Check the amounts above.':`Lot target: ${opts.lotPrice==null?'not set':money(opts.lotPrice)}. Your postage + packing: ${money(opts.lotPostage)} for the lot or ${money(opts.singlePostage)} per single. Purchase cost: ${money(opts.cost)}. Change these assumptions above.`;
      results.replaceChildren();if(!s.count){results.append(el('p','Select at least one card.'));return;}
      if(s.missing||invalid.length){results.append(el('p',s.missing?'Add the missing prices under “Review cards” to compare the complete selection.':'Use non-negative, finite amounts for every cost and price.','sp-error'));return;}
      const feeFor=(pid,price,ship)=>{const lines=pid==='ebay'?feeEbay(price,ship,profile.ebayStore,Number(profile.ebayPromo)||0,false):pid==='tcgplayer'?feeTCGPlayer(price,ship,tier.value):feeMercari(price,ship);return lines.reduce((n,f)=>n+f.a,0);};
      const calc=calculate(rows,opts,feeFor), costCents=cents(opts.cost);
      if(calc.lots.length){const q=calc.lots[0];results.append(el('p',`Best estimated lot payout among compared venues: ${names[q.pid]} · ${money(q.net/100)} at your ${money(opts.lotPrice)} lot price.`,'sp-highlight'));}
      else if(opts.lotPrice==null)results.append(el('p','Enter a target lot price to compare selling together.'));
      results.append(table('Sell together as one lot',calc.lots,costCents),table('Sell as singles on one venue',calc.singles,costCents));
      if(calc.singles.length){const q=calc.singles[0];results.append(el('p',`Best estimated venue for all singles: ${names[q.pid]} · ${money(q.net/100)} net payout.`));}
      if(calc.split){results.append(el('p',`Best venue for each single: ${money(calc.split.net/100)} estimated net payout · ${money((calc.split.net-costCents)/100)} after purchase cost.`,'sp-highlight'));
        const d=el('details');d.append(el('summary','See each card’s recommended venue'));for(const a of calc.split.assignments)d.append(el('p',`${a.row.name} × ${a.qty} → ${names[a.pid]} · ${money(a.net/100)} net`));results.append(d);
        if(calc.lots.length){const delta=calc.split.net-calc.lots[0].net;results.append(el('p',`${delta>=0?'Singles return':'The lot returns'} ${money(Math.abs(delta)/100)} more under these assumptions. A lot needs one sale and shipment; singles need ${s.count}.`));}}
      results.append(el('p','Net payout = sale price + buyer-paid shipping − modeled fees − your postage and packing. “After cost” also subtracts the purchase cost entered above.','sp-note'));
    }
    // The app traps keys at document capture. Intercept at window capture so
    // native dialog focus/Escape work without closing the underlying scan.
    const onKey=e=>{if(dialog.open && (e.key==='Tab'||e.key==='Escape'))e.stopPropagation();};
    window.addEventListener('keydown',onKey,true);dialog.addEventListener('close',()=>{window.removeEventListener('keydown',onKey,true);dialog.remove();});document.body.append(dialog);render();dialog.showModal();close.focus();
  }
  window.CardResellSellingPlan={summarize,calculate,openBulk,openCollection};
})();
