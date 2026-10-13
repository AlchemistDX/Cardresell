/* Selling guidance is a transparent triage rule, not a demand or price forecast.
   Numerical single-card estimates come only from the existing enabled, current-fee rows. */
(() => {
  'use strict';
  const KEY='cr_selling_preferences_v1';
  const goals={balanced:'Balance money and effort',money:'Most money',quick:'Quickest sale',easy:'Least work'};
  const defaults={goal:'balanced',minimum:2,ship:true,local:false};
  const amount=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  function preferences() {
    let p={};try{p=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(_){}
    return {goal:Object.hasOwn(goals,p.goal)?p.goal:defaults.goal,minimum:amount(p.minimum)?p.minimum:defaults.minimum,ship:typeof p.ship==='boolean'?p.ship:true,local:p.local===true};
  }
  function save(p){try{localStorage.setItem(KEY,JSON.stringify(p));}catch(_){}}
  function recommend(card,p) {
    if(!amount(p.minimum))return {route:'check',title:'Check your minimum proceeds',why:'Enter a non-negative amount you would consider worth packing and selling.',next:[]};
    if(!amount(card.price))return {route:'check',title:'Confirm the card and its value first',why:'A missing price is not a bulk price. Check the printing, condition and recent sales before choosing a selling route.',next:[]};
    const low=card.price<5, q=card.best, net=typeof q?.net==='number'&&Number.isFinite(q.net)?q.net:null;
    const sensibleSingle=card.costsConfirmed&&net!==null&&net>=p.minimum&&net>0;
    const related=!!card.related;
    const bundleTitle=related?'Bundle it with related cards':'Set it aside for your next lot';
    const bundleNext=['Group cards by game, set, character, team or playable combination so the lot makes sense to a buyer.','Price the lot for what buyers will pay; adding up singles prices is only a starting point.'];
    if(!p.ship&&!p.local)return {route:'hold',title:'Keep it for a future sale or trade',why:'You have ruled out both shipping and local selling. Save the card until one of those options suits you.',next:['This is a convenience choice, not a prediction that its value will rise.']};
    if(card.graded)return {route:p.local&&p.goal==='quick'?'dealer':'single',title:!p.ship?'Offer this slab individually to a local buyer':p.local&&p.goal==='quick'?'Ask for an individual dealer offer':'Keep this slab separate from bulk',why:'Graded cards need their own comparable sales and selling costs. A low slab price does not make it eligible for raw-card bulk programs.',next:['Check recent sales for this exact grader and grade.','Compare an individual sale with a dealer or consignment quote if you want less work.']};
    if(p.goal==='quick'&&p.local)return {route:'dealer',title:low?'Take a sorted stack to a local buyer':'Ask a local dealer for a cash offer',why:'A local buyer can quote without a mail-in shipping leg. The offer may be lower than an individual sale; acceptance and payment timing depend on the buyer.',next:[low?'Separate individually wanted cards before offering the remaining stack.':'Keep this card separately priced when discussing a larger collection.','Ask what they will actually pay before visiting or agreeing to sell.']};
    if(!p.ship)return {route:low?'local-lot':'local-single',title:low?'Offer a related lot locally':'Try an individual local sale',why:'Local selling matches your no-shipping preference. Buyer interest, any local platform fees and your travel/time still matter.',next:low?bundleNext:['Use recent sales to set an asking price.','Get a dealer quote if avoiding buyer coordination matters more than the final price.']};
    if(p.goal==='quick'||p.goal==='easy')return {route:'buylist',title:low?'Build a sorted stack for one sale':'Compare a buylist or consignment offer',why:low?'One lot or a sorted buylist shipment means fewer listings and parcels. Mail-in payment still takes time, and postage can wipe out a small offer.':'A buyer or consignment service can reduce the work. Compare the actual offer after deductions with an individual listing; a service is not automatically the highest-paying option.',next:[low?'Check itemized buylists for wanted singles first; send only eligible leftovers at category bulk rates.':'Keep higher-value cards itemized instead of accepting a blanket bulk rate.','Check game, language, condition, minimum quantities and shipping before sending.'],buyers:true};
    if(low){
      if(p.goal==='money'&&sensibleSingle)return {route:'single',title:'An individual listing may be worth it',why:`At your entered costs, ${q.name} leaves about ${money(net)} in proceeds, meeting your ${money(p.minimum)} minimum. This is an estimate if it sells, not evidence of buyer demand.`,next:['Check recent sales for this exact printing and condition before listing.','Consider combined orders or related lots if listing and packing one card is too much work.']};
      return {route:related?'lot':'hold-for-lot',title:bundleTitle,why:`At ${money(card.price)}, fixed fees, postage and your time can consume much of an individual sale. ${p.goal==='money'?'Check for individual demand before putting it in a bulk pile.':'A related lot is a practical starting point.'}`,next:[...bundleNext,'Check itemized buylist offers before accepting bulk rates. “Under $5” does not mean unwanted or worthless.'],buyers:true};
    }
    if(card.costsConfirmed&&net!==null&&(net<=0||net<p.minimum))return {route:'review-costs',title:'Review the price and shipping before listing',why:`Your best available marketplace estimate leaves ${money(net)}, below your ${money(p.minimum)} minimum or no positive proceeds. A higher card value alone does not make the sale worthwhile.`,next:['Check whether the buyer can realistically cover shipping or whether a combined sale reduces the cost.','Keep this card itemized when requesting a dealer offer; do not automatically treat it as bulk.']};
    return {route:'single',title:'Start with an individual listing',why:sensibleSingle?`${q.name} has the highest estimated net among your enabled venues with current fee schedules: ${money(net)} before purchase cost.`:'At $5 or more, reviewing an individual sale is a practical starting point. Confirm shipping, fees and demand before deciding.',next:['Verify recent sold prices for this printing and condition.','Use the fee comparison below with your real postage and packing cost.']};
  }
  function summarizeBatch(rows,p){
    const selected=rows.filter(r=>r.selected!==false),groups={low:0,singles:0,graded:0,unknown:0,total:0};
    for(const r of selected){const q=Number.isSafeInteger(r.qty)&&r.qty>0?r.qty:1;groups.total+=q;groups[!amount(r.price)?'unknown':r.graded?'graded':r.price<5?'low':'singles']+=q;}
    let action=p.goal==='money'?'Check wanted singles first, then bundle the leftovers':p.goal==='quick'&&p.local?'Ask a local buyer about the sorted low-value stack':p.goal==='quick'||p.goal==='easy'?'Compare one related lot with a sorted buylist shipment':'Bundle the low-value cards into related lots';
    if(!p.ship)action=p.local?'Offer related low-value lots locally':'Set aside the low-value cards for a future lot or trade';
    return {...groups,action};
  }
  function element(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}
  function style(host){const s=element('style');s.textContent=`.cr-selling-advice{padding:16px;margin:12px 0;border:1px solid var(--gold-text,#926000);border-radius:12px;background:var(--surface,#fff);color:var(--text,#171717)}.cr-selling-advice *{box-sizing:border-box}.cr-selling-advice h3{font-size:1.05rem;margin:0 0 10px}.cr-selling-advice p,.cr-selling-advice li{font-size:.88rem;line-height:1.5;margin:8px 0}.cr-selling-advice ul{padding-left:20px}.cr-selling-advice .ca-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:12px}.cr-selling-advice label{display:flex;flex-direction:column;gap:6px;font-size:.82rem;margin:8px 0}.cr-selling-advice select,.cr-selling-advice input,.cr-selling-advice button{font:inherit;min-height:44px;max-width:100%;padding:8px;border:1px solid var(--border,#777);border-radius:8px;background:var(--surface,#fff);color:var(--text,#171717)}.cr-selling-advice input[type=checkbox]{width:22px;height:22px;min-height:22px}.cr-selling-advice .ca-note{color:var(--text-muted,#555);font-size:.78rem}.cr-selling-advice details>summary{cursor:pointer;min-height:44px;padding:10px 0}.cr-selling-advice [hidden]{display:none!important}`;host.append(s);}
  function controls(host,p,onChange,includeMinimum=true){
    const fields=element('div',null,'ca-fields'),wrap=element('label','What matters most?'),select=element('select');select.setAttribute('aria-label','Selling priority');
    for(const [value,text] of Object.entries(goals)){const o=element('option',text);o.value=value;select.append(o);}select.value=p.goal;select.onchange=()=>{p.goal=select.value;save(p);onChange();};wrap.append(select);fields.append(wrap);host.append(fields);
    const details=element('details');details.append(element('summary','Your selling preferences'));const more=element('div',null,'ca-fields');details.append(more);host.append(details);
    const label=element('label','Minimum proceeds worth packing one card ($)'),input=element('input');input.type='number';input.min='0';input.step='.50';input.value=String(p.minimum);input.setAttribute('aria-label','Minimum proceeds worth packing one card ($)');input.oninput=()=>{p.minimum=input.value.trim()===''?null:Number(input.value);if(amount(p.minimum))save(p);onChange();};label.append(input);if(includeMinimum)more.append(label);
    function check(key,text){const l=element('label'),i=element('input');i.type='checkbox';i.checked=p[key];i.setAttribute('aria-label',text);i.onchange=()=>{p[key]=i.checked;save(p);onChange();};l.append(i,document.createTextNode(text));more.append(l);}
    check('ship','I am willing to ship cards');check('local','I can sell to buyers or shops locally');
    details.append(element('p','Preferences are saved on this device. Proceeds are before what you paid for the cards. The $5 dividing line is a sorting guideline, not a market rule.','ca-note'));
  }
  function mount(host,input){
    if(!host)return;host.replaceChildren();host.className='cr-selling-advice';style(host);host.append(element('h3','What should I do with this card?'));
    const p=preferences(),card={...input,costsConfirmed:false,related:false};controls(host,p,draw);
    const decisions=element('details');decisions.append(element('summary','Refine this recommendation'));
    for(const [key,text] of [['related','I have related cards I can bundle with this one'],['costsConfirmed','I checked the shipping and packing amounts in the fee calculator']]){const label=element('label'),i=element('input');i.type='checkbox';i.setAttribute('aria-label',text);i.onchange=()=>{card[key]=i.checked;draw();};label.append(i,document.createTextNode(text));decisions.append(label);}host.append(decisions);
    const output=element('div');output.setAttribute('aria-live','polite');output.dataset.adviceOutput='';host.append(output);
    function draw(){const a=recommend(card,p);output.replaceChildren(element('h3',a.title),element('p',a.why));output.dataset.route=a.route;const how=element('details');how.append(element('summary','Next steps and assumptions'));const list=element('ul');a.next.forEach(s=>list.append(element('li',s)));how.append(list);
      if(a.buyers){const b=element('button','Explore buyers and submission rules');b.type='button';b.onclick=()=>{if(typeof openVenuePicker==='function')openVenuePicker();};output.append(b);}
      if(input.best&&Number.isFinite(input.best.net))how.append(element('p',`Single-card comparison at the entered costs: ${input.best.name} · ${money(input.best.net)} estimated proceeds if sold. ${card.costsConfirmed?'Buyer-tax fee effects and actual demand can still change the result.':'Confirm your shipping and packing amounts before relying on this figure.'}`,'ca-note'));
      how.append(element('p','Suggested next step, not a guaranteed sale or price forecast. Under-$5 cards can still have individual demand. Check the printing, condition and current sales.','ca-note'));output.append(how);
    }
    draw();
  }
  function mountBatch(host,getRows){
    const section=element('section',null,'cr-selling-advice');section.dataset.batchAdvice='';style(section);section.append(element('h3','A starting plan for these cards'));host.append(section);
    const p=preferences();controls(section,p,draw,false);const output=element('div');output.setAttribute('aria-live','polite');section.append(output);
    function draw(){const g=summarizeBatch(getRows(),p);output.replaceChildren();if(!g.total){output.append(element('p','Select cards to build your plan.'));return;}
      if(!amount(p.minimum)){output.append(element('p','Enter a non-negative minimum proceeds amount.'));return;}
      if(g.low)output.append(element('p',`${g.low} raw card${g.low===1?'':'s'} under $5 each: ${g.action}.`));
      if(g.singles)output.append(element('p',`${g.singles} raw card${g.singles===1?'':'s'} at $5 or more: ${p.goal==='quick'||p.goal==='easy'?'keep these itemized when comparing a dealer or consignment quote':'review individual listings before mixing them into a lot'}.`));
      if(g.graded)output.append(element('p',`${g.graded} graded card${g.graded===1?'':'s'}: compare exact grader/grade sales separately; raw-card bulk rules do not apply.`));
      if(g.unknown)output.append(element('p',`${g.unknown} card${g.unknown===1?' needs':'s need'} a value check. Missing prices are not zero-value bulk.`));
      output.append(element('p','Check for wanted singles before accepting category bulk rates. Group leftovers by game, set, character, team or playable combination. The $5 boundary is a sorting guideline; it does not measure demand.','ca-note'));
      output.append(element('p','Use the comparisons below after choosing a route. Enter actual shipping and a realistic lot price; an itemized buyer quote is optional, not required to start.','ca-note'));
    }
    draw();return draw;
  }
  window.CardResellAdvice={recommend,summarizeBatch,preferences,mount,mountBatch};
  if(window._crSellingAdviceInput)mount(document.getElementById('sellingAdvice'),window._crSellingAdviceInput);
})();
