/* Selling guidance is a transparent triage rule, not a demand or price forecast.
   Numerical single-card estimates come only from the existing enabled, current-fee rows. */
(() => {
  'use strict';
  const KEY='cr_selling_preferences_v1';
  const goals={balanced:'Balance money and effort',money:'Highest estimated payout',quick:'Quickest cash offer',easy:'Least work in CardResell'};
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
    if(p.goal==='easy'&&p.ship)return {route:'ebay-draft',title:'Prepare an eBay draft in CardResell',why:'Reuse your selected card details in an eBay draft, then review and export it for Seller Hub. This is the fewest steps within CardResell, not a promise of a faster sale.',next:[low?'At this value, check postage and fees before listing one card. A related lot may take less work, but this action prepares one card’s draft.':'Review the asking price, photos, condition and shipping before exporting.',card.graded?'Use sold comparisons for the exact grader and grade.':'Confirm the exact printing and finish before listing.']};
    if(card.graded){
      if(!p.ship)return {route:'local-single',title:'Offer this slab individually to a local buyer',why:'Your no-shipping preference stays in effect. Use exact grader and grade comparisons when discussing an offer.',next:['Keep graded cards separate from raw-card bulk.']};
      if(p.goal==='quick')return {route:'dealer',title:p.local?'Ask for an individual dealer offer':'Get an individual slab offer and payment date',why:'Ask an eligible buyer what they will actually pay and when. A marketplace listing does not guarantee a quick sale.',next:['Check recent sales for this exact grader and grade.','Do not include the slab in a raw-card bulk shipment.'],buyers:!p.local};
      if(p.goal==='money')return {route:'payout',title:net!==null?`Compare ${q.name} for slab payout`:'Check exact-grade prices and selling costs',why:net!==null?`${q.name} leaves about ${money(net)} before purchase cost under your entered price and costs. Confirm recent sales for this exact grader and grade; a modeled payout is not evidence of demand.`:'No current eligible fee estimate is available. Check your enabled venues and exact-grade comparisons.',next:['Review shipping, insurance and fees before listing.','Other marketplaces require a separate selling workflow. eBay preparation is available below.']};
      return {route:'single',title:'Keep this slab separate from bulk',why:'Graded cards need their own comparable sales and selling costs. A low slab price does not make it eligible for raw-card bulk programs.',next:['Check recent sales for this exact grader and grade.','Compare an individual sale with a dealer or consignment quote if you want less work.']};
    }
    if(p.goal==='quick'&&p.local)return {route:'dealer',title:low?'Take a sorted stack to a local buyer':'Ask a local dealer for a cash offer',why:'A local buyer can quote without a mail-in shipping leg. The offer may be lower than an individual sale; acceptance and payment timing depend on the buyer.',next:[low?'Separate individually wanted cards before offering the remaining stack.':'Keep this card separately priced when discussing a larger collection.','Ask what they will actually pay before visiting or agreeing to sell.']};
    if(!p.ship)return {route:low?'local-lot':'local-single',title:low?'Offer a related lot locally':'Try an individual local sale',why:'Local selling matches your no-shipping preference. Buyer interest, any local platform fees and your travel/time still matter.',next:low?bundleNext:['Use recent sales to set an asking price.','Get a dealer quote if avoiding buyer coordination matters more than the final price.']};
    if(p.goal==='quick')return {route:'buylist',title:'Get an actual buyer offer and payment date',why:'A cash offer gives you a price and payment terms to compare with waiting for a marketplace buyer. No sale-time data is available to rank eBay or another marketplace as fastest. Mail-in inspection and payment take time.',next:['Keep wanted singles itemized before accepting bulk rates.','Check game, language, condition, quantities, shipping and payment timing before agreeing.'],buyers:true};
    if(low){
      if(p.goal==='money'&&sensibleSingle)return {route:'single',title:'An individual listing may be worth it',why:`At your entered costs, ${q.name} leaves about ${money(net)} in proceeds, meeting your ${money(p.minimum)} minimum. This is an estimate if it sells, not evidence of buyer demand.`,next:['Check recent sales for this exact printing and condition before listing.','Consider combined orders or related lots if listing and packing one card is too much work.']};
      return {route:related?'lot':'hold-for-lot',title:bundleTitle,why:`At ${money(card.price)}, fixed fees, postage and your time can consume much of an individual sale. ${p.goal==='money'?'Check for individual demand before putting it in a bulk pile.':'A related lot is a practical starting point.'}`,next:[...bundleNext,'Check itemized buylist offers before accepting bulk rates. “Under $5” does not mean unwanted or worthless.'],buyers:true};
    }
    if(card.costsConfirmed&&net!==null&&(net<=0||net<p.minimum))return {route:'review-costs',title:'Review the price and shipping before listing',why:`Your best available marketplace estimate leaves ${money(net)}, below your ${money(p.minimum)} minimum or no positive proceeds. A higher card value alone does not make the sale worthwhile.`,next:['Check whether the buyer can realistically cover shipping or whether a combined sale reduces the cost.','Keep this card itemized when requesting a dealer offer; do not automatically treat it as bulk.']};
    if(p.goal==='money')return {route:'payout',title:net!==null?`Compare ${q.name} for estimated payout`:'Check selling costs before choosing a venue',why:net!==null?`${q.name} leaves about ${money(net)} before purchase cost under the entered price and costs. This is the highest estimate among enabled venues with current fee schedules, not a prediction of demand or the sale price.`:'No eligible, current-fee comparison is available. Check your enabled venues and the fee schedules.',next:['Confirm actual shipping and packing costs before relying on the estimate.',q?.pid==='ebay'?'Continue through the eBay draft workflow below.':'Other marketplaces require a separate selling workflow. eBay drafts and CSV export remain available below.']};
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
  function style(host){const s=element('style');s.textContent=`.cr-selling-advice{padding:16px;margin:12px 0;border:1px solid var(--gold-text,#926000);border-radius:12px;background:var(--surface,#fff);color:var(--text,#171717)}.cr-selling-advice *{box-sizing:border-box}.cr-selling-advice h3{font-size:1.05rem;margin:0 0 10px}.cr-selling-advice p,.cr-selling-advice li{font-size:.88rem;line-height:1.5;margin:8px 0}.cr-selling-advice ul{padding-left:20px}.cr-selling-advice .ca-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));gap:12px}.cr-selling-advice label{display:flex;flex-direction:column;gap:6px;font-size:.82rem;margin:8px 0}.cr-selling-advice select,.cr-selling-advice input,.cr-selling-advice button{font:inherit;min-height:44px;max-width:100%;padding:8px;border:1px solid var(--border,#777);border-radius:8px;background:var(--surface,#fff);color:var(--text,#171717)}.cr-selling-advice input[type=checkbox]{width:22px;height:22px;min-height:22px}.cr-selling-advice .ca-note{color:var(--text-muted,#555);font-size:.78rem}.cr-selling-advice details>summary{cursor:pointer;min-height:44px;padding:10px 0}.cr-selling-advice .ca-workflow{margin-top:14px;padding-top:14px;border-top:1px solid var(--border,#777)}.cr-selling-advice .ca-actions{display:flex;flex-wrap:wrap;gap:10px}.cr-selling-advice .ca-primary,#sellingPlan .cr-selling-advice .ca-primary{background:var(--gold,#efc45c);color:#171108;font-weight:700}.cr-selling-advice button:disabled{opacity:.6;cursor:wait}.cr-selling-advice :focus-visible{outline:2px solid var(--gold-text,#926000);outline-offset:3px}.cr-selling-advice [role=status]:empty{display:none}.cr-selling-advice [hidden]{display:none!important}`;host.append(s);}
  function controls(host,p,onChange,includeMinimum=true){
    const fields=element('div',null,'ca-fields'),wrap=element('label','What matters most?'),select=element('select');select.setAttribute('aria-label','Selling priority');
    for(const [value,text] of Object.entries(goals)){const o=element('option',text);o.value=value;select.append(o);}select.value=p.goal;select.onchange=()=>{p.goal=select.value;save(p);onChange();};wrap.append(select);fields.append(wrap);host.append(fields);
    const details=element('details');details.append(element('summary','Your selling preferences'));const more=element('div',null,'ca-fields');details.append(more);host.append(details);
    const label=element('label','Minimum proceeds worth packing one card ($)'),input=element('input');input.type='number';input.min='0';input.step='.50';input.value=String(p.minimum);input.setAttribute('aria-label','Minimum proceeds worth packing one card ($)');input.oninput=()=>{p.minimum=input.value.trim()===''?null:Number(input.value);if(amount(p.minimum))save(p);onChange();};label.append(input);if(includeMinimum)more.append(label);
    function check(key,text){const l=element('label'),i=element('input');i.type='checkbox';i.checked=p[key];i.setAttribute('aria-label',text);i.onchange=()=>{p[key]=i.checked;save(p);onChange();};l.append(i,document.createTextNode(text));more.append(l);}
    check('ship','I am willing to ship cards');check('local','I can sell to buyers or shops locally');
    details.append(element('p','Preferences are saved on this device. Proceeds are before what you paid for the cards. The $5 dividing line is a sorting guideline, not a market rule.','ca-note'));return details;
  }
  function mount(host,input){
    if(!host)return;host.replaceChildren();host.className='cr-selling-advice';style(host);host.append(element('h3','Your next selling step'));
    const p=preferences(),card={...input,costsConfirmed:false,related:false};const preferencesBox=controls(host,p,draw);
    const decisions=element('details');decisions.append(element('summary','Refine this recommendation'));
    for(const [key,text] of [['related','I have related cards I can bundle with this one'],['costsConfirmed','I checked the shipping and packing amounts in the fee calculator']]){const label=element('label'),i=element('input');i.type='checkbox';i.setAttribute('aria-label',text);i.onchange=()=>{card[key]=i.checked;draw();};label.append(i,document.createTextNode(text));decisions.append(label);}host.append(decisions);
    const output=element('div');output.setAttribute('aria-live','polite');output.dataset.adviceOutput='';host.append(output,preferencesBox,decisions);
    function draw(){const a=recommend(card,p);output.replaceChildren(element('h3',a.title),element('p',a.why));output.dataset.route=a.route;const how=element('details');how.append(element('summary','Next steps and assumptions'));const list=element('ul');a.next.forEach(s=>list.append(element('li',s)));how.append(list);
      if(a.buyers){const b=element('button','Explore buyers and submission rules');b.type='button';b.onclick=()=>{if(typeof openVenuePicker==='function')openVenuePicker();};output.append(b);}
      if(input.best&&Number.isFinite(input.best.net))how.append(element('p',`Single-card comparison at the entered costs: ${input.best.name} · ${money(input.best.net)} estimated proceeds if sold. ${card.costsConfirmed?'Buyer-tax fee effects and actual demand can still change the result.':'Confirm your shipping and packing amounts before relying on this figure.'}`,'ca-note'));
      how.append(element('p','Suggested next step, not a guaranteed sale or price forecast. Under-$5 cards can still have individual demand. Check the printing, condition and current sales.','ca-note'));
      if(p.ship&&a.route!=='check')ebayWorkflow(output,{prepare:input.prepare,label:'Review eBay draft',quote:input.ebay,primary:a.route==='ebay-draft'});
      output.append(how);
    }
    draw();
  }
  // A workflow recommendation is not a claim of marketplace demand, nor of
  // publishing access. The existing connection dialog owns live status checks.
  function ebayWorkflow(host,{prepare,label,quote,primary=false,note=''}){
    const box=element('div',null,'ca-workflow');box.dataset.ebayWorkflow='';
    if(!primary)box.append(element('strong','eBay · Drafts and CSV export'));
    const next=element('details');next.append(element('summary','What happens next'));
    next.append(element('p','Review in CardResell, then export to eBay Seller Hub. Direct publishing and automatic sales sync are not enabled.','ca-note'));
    if(quote&&Number.isFinite(quote.net))box.append(element('p',`${money(quote.net)} estimated eBay proceeds before purchase cost.`));
    else box.append(element('p','eBay payout estimate unavailable. Review your prices and costs.','ca-note'));
    if(quote&&Number.isFinite(quote.net)&&quote.net<=0)box.append(element('p','These costs leave no positive proceeds. Review the price and postage before exporting.'));
    if(note)next.append(element('p',note,'ca-note'));
    next.append(element('p','Payout assumes the entered sale price and shipping costs. Review exact printing, condition, photos and price before export.','ca-note'));
    const actions=element('div',null,'ca-actions'),status=element('p');status.setAttribute('role','status');status.dataset.workflowStatus='';
    if(prepare){const b=element('button',label);b.type='button';b.dataset.prepareEbay='';if(primary)b.className='ca-primary';
      b.onclick=async()=>{if(b.disabled)return;b.disabled=true;status.textContent='Opening your next step…';
        try{const message=await prepare();if(box.isConnected)status.textContent=message||'';}
        catch(e){if(box.isConnected)status.textContent=e.message||'Could not open this step. Please try again.';}
        finally{if(box.isConnected)b.disabled=false;}
      };actions.append(b);
    }
    const connect=element('button','Check eBay connection');connect.type='button';
    connect.onclick=()=>{if(window.CardResellEbayConnect?.open)window.CardResellEbayConnect.open();else status.textContent='Connection settings are still loading. Please try again.';};
    actions.append(connect);box.append(actions,status,next);host.append(box);
  }
  function mountBatch(host,getRows,options={}){
    const section=element('section',null,'cr-selling-advice');section.dataset.batchAdvice='';style(section);section.append(element('h3','Your next selling step'));host.append(section);
    const p=preferences(),preferencesBox=controls(section,p,draw,false);const output=element('div');output.setAttribute('aria-live','polite');section.append(output,preferencesBox);
    function draw(){const g=summarizeBatch(getRows(),p);output.replaceChildren();if(!g.total){output.append(element('p','Select cards to build your plan.'));return;}
      if(!amount(p.minimum)){output.append(element('p','Enter a non-negative minimum proceeds amount.'));return;}
      const comparison=options.comparison?.(),quotes=[...(comparison?.lots||[]).map(q=>({...q,route:'one lot on '+q.name})),...(comparison?.split?[{...comparison.split,route:'each single on its best modeled venue'}]:[])].sort((a,b)=>b.net-a.net);
      let title,why,route=p.goal;
      if(!p.ship){route=p.local?'local':'hold';title=p.local?'Offer selected cards locally':'Keep these cards for a future sale or trade';why=p.local?'Your no-shipping preference rules out the mailed marketplace estimates. Ask for a local offer or arrange local sales.':'Shipping and local selling are both off. Change your preferences when you are ready to sell.';}
      else if(p.goal==='easy'){route='ebay-drafts';title=`Prepare ${g.total} eBay draft${g.total===1?'':'s'} in one workflow`;why='Review the selected copies together, then prepare and export eBay drafts. Each physical card stays separate.';}
      else if(p.goal==='money'){title='Review the highest estimated payout';why=quotes.length?`Under the entered prices and costs, ${quotes[0].route} leaves about ${money(quotes[0].net/100)} before purchase cost. Actual selling prices and demand can differ. Other venues require separate selling tools.`:'Complete the prices and costs to compare estimated payouts. Missing prices are not zero-value cards.';}
      else if(p.goal==='quick'){route=p.local?'dealer':'offers';title=p.local?'Request a local cash offer':'Get a buyer offer and payment date';why=p.local?'A local quote avoids mail-in transit and inspection. Confirm the actual offer and payment date with the buyer.':'Compare an actual buyer offer with waiting for marketplace sales. No sale-time data is available to promise the fastest venue.';}
      else{title='Separate wanted singles from related lots';why='Review higher-value and graded cards individually. Group related lower-value cards when listing and packing each one is too much work.';}
      output.dataset.route=route;output.append(element('h3',title),element('p',why));
      const checks=element('details');checks.append(element('summary','Selected card checks'));
      if(g.low)checks.append(element('p',`${g.low} raw card${g.low===1?'':'s'} under $5 each: ${p.goal==='easy'&&p.ship?'check whether postage makes individual drafts worthwhile':g.action}.`));
      if(g.singles)checks.append(element('p',`${g.singles} raw card${g.singles===1?'':'s'} at $5 or more: review individually before mixing them into a lot.`));
      if(g.graded)checks.append(element('p',`${g.graded} graded card${g.graded===1?'':'s'}: compare exact grader/grade sales separately; raw-card bulk rules do not apply.`));
      if(g.unknown)output.append(element('p',`${g.unknown} card${g.unknown===1?' needs':'s need'} a value check. Missing prices are not zero-value bulk.`));
      checks.append(element('p','Check for wanted singles before accepting category bulk rates. Group leftovers by game, set, character, team or playable combination. The $5 boundary is a sorting guideline; it does not measure demand.','ca-note'));
      if(p.ship){const q=comparison?.singles?.find(q=>q.pid==='ebay');ebayWorkflow(output,{prepare:options.prepare,label:`Review ${g.total} card${g.total===1?'':'s'} for eBay drafts`,quote:q?{net:q.net/100}:null,primary:p.goal==='easy',note:options.note});}
      output.append(checks);
    }
    draw();return draw;
  }
  window.CardResellAdvice={recommend,summarizeBatch,preferences,mount,mountBatch};
  if(window._crSellingAdviceInput)mount(document.getElementById('sellingAdvice'),window._crSellingAdviceInput);
})();
