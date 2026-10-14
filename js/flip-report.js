// Read-only reports over seller-entered sales. Never infer historical expenses.
(() => {
  'use strict';
  const fields = ['buyPrice','fees','shippingCost','gradingCost'];
  const labels = ['purchase price','fees','shipping','grading'];
  const money = v => {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && !/^\d+(?:\.\d+)?$/.test(v.trim())) return null;
    const n = Number(v), cents = Math.round(n * 100);
    return Number.isFinite(n) && n >= 0 && Number.isSafeInteger(cents) ? cents : null;
  };
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  function record(f) {
    const tracked = f.costMeta && typeof f.costMeta === 'object' && !Array.isArray(f.costMeta);
    const missing = [];
    const costs = fields.map((key,i) => {
      const n = money(f[key]), state = tracked ? f.costMeta[key] : null;
      if (!tracked) { if (n === null || n === 0) { missing.push(labels[i] + ' unverified'); return null; } return n; }
      if ((state === 'zero' && n === 0) || (state === 'value' && n !== null && n > 0)) return n;
      missing.push(labels[i] + (state === 'blank' ? ' missing' : ' needs review')); return null;
    });
    const sale = money(f.sellPrice);
    if (sale === null) missing.push('sale price missing or invalid');
    const complete = !!tracked && !missing.length;
    const totalCost = costs.every(v=>v!==null) ? costs.reduce((a,b)=>a+b,0) : null;
    const net = complete && Number.isSafeInteger(totalCost) && Number.isSafeInteger(sale-totalCost) ? sale-totalCost : null;
    return {f,costs,sale,net,complete:complete && net!==null,
      status:!tracked ? 'Legacy record: cost completeness unverified' : net===null ? 'Incomplete: review inputs' : 'Complete for tracked inputs',
      missing:missing.join('; ') || (!tracked ? 'Historical completeness not recorded' : net===null ? 'Amount exceeds supported range' : '')};
  }
  function build(data, from='', to='') {
    if (!Array.isArray(data) || data.some(f=>!f || typeof f!=='object' || Array.isArray(f))) throw Error('Saved flips could not be read. Reload and try again.');
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from>to)) throw Error('Choose a valid date range with the start on or before the end.');
    const undated = data.filter(f=>!validDate(f.date)).length;
    const rows = data.filter(f=>!(from||to) || (validDate(f.date) && (!from||f.date>=from) && (!to||f.date<=to))).map(record);
    const complete = rows.filter(r=>r.complete);
    const totals = [0,0,0,0,0,0];
    for (const r of complete) [r.sale,...r.costs,r.net].forEach((n,i)=>{totals[i]+=n; if(!Number.isSafeInteger(totals[i])) throw Error('Report total exceeds the supported amount range.');});
    return {rows,totals,complete:complete.length,incomplete:rows.length-complete.length,undated,excludedUndated:from||to ? undated : 0};
  }
  const format = cents => cents === null ? '' : (cents/100).toFixed(2);
  function csv(report) {
    const rows = [['Date','Card','Set','Buy Price','Sell Price','Fees','Shipping','Grading','Net Profit','Platform','Record Status','Missing Inputs','Flip ID','Currency','Report Basis']];
    for (const r of report.rows) rows.push([r.f.date||'',r.f.card||'',r.f.set||'',format(r.costs[0]),format(r.sale),format(r.costs[1]),format(r.costs[2]),format(r.costs[3]),format(r.net),r.f.platform||'',r.status,r.missing,r.f.id??'','USD','Seller-entered sale less purchase, fees, shipping and grading; refunds and other expenses are not tracked']);
    return '\uFEFF'+rows.map((row,rowIndex)=>row.map((value,i)=>{
      let s=String(value);
      if (!(rowIndex>0 && i>=3 && i<=8) && (/^\s*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))) s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    }).join(',')).join('\r\n');
  }
  function download(report, name) {
    if (!report.rows.length) { showToast('No flips match this report.', 'info'); return; }
    const url=URL.createObjectURL(new Blob([csv(report)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  window.CardResellFlipReport={build,csv};
  window.exportFlips=function(){try{download(build(loadFlipsData()),'cardsell_flips.csv');}catch(e){showToast(e.message,'error');}};
  let owner, from='', to='';
  const account=()=>window.googleUser?.uid || window.googleUser?.sub || null;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  function editRecord(row, container) {
    const editOwner=account(), snapshot=JSON.stringify(row.f);
    const form=el('form');form.className='flip-report-editor';
    form.append(el('p','Enter actual amounts. Leave unknown costs blank; enter 0 only when you know there was no cost. Sale price is before the separately recorded fees.'));
    const inputs={};
    for(const [key,label,value] of [['sellPrice','Sale price',format(row.sale)],...fields.map((key,i)=>[key,labels[i],format(row.costs[i])])]){
      const wrap=el('label',label),input=el('input');input.type='number';input.min='0';input.step='0.01';input.value=value;input.setAttribute('aria-label','Edit '+label);inputs[key]=input;wrap.append(input);form.append(wrap);
    }
    const dateLabel=el('label','Sale date'),date=el('input');date.type='date';date.value=validDate(row.f.date)?row.f.date:'';date.setAttribute('aria-label','Edit sale date');dateLabel.append(date);form.append(dateLabel);
    const message=el('p');message.setAttribute('role','status');form.append(message);
    const save=el('button','Save sale corrections');save.type='submit';save.className='fl-sub-btn';
    const cancel=el('button','Cancel');cancel.type='button';cancel.className='fl-sub-btn';cancel.onclick=()=>form.remove();form.append(save,cancel);
    form.onsubmit=event=>{
      event.preventDefault();
      if(editOwner!==account()){form.remove();render();showToast('Account changed. Reopen the sale to edit it.','error');return;}
      const data=loadFlipsData();
      const matches=Array.isArray(data)?data.filter(f=>f && f.id!=null && String(f.id)===String(row.f.id)):[];
      if(row.f.id==null || matches.length!==1 || JSON.stringify(matches[0])!==snapshot){message.textContent='This sale changed or its ID is ambiguous. Close and reopen the report before editing.';save.disabled=true;return;}
      const sale=money(inputs.sellPrice.value);
      if(sale===null || !validDate(date.value)){message.textContent='Enter a valid sale price and sale date.';return;}
      const values={},meta={};
      for(const key of fields){const raw=inputs[key].value.trim(),amount=money(raw);if(raw && amount===null){message.textContent='Costs must be valid amounts of zero or more.';return;}values[key]=amount===null?0:amount/100;meta[key]=!raw?'blank':amount===0?'zero':'value';}
      const updated={...matches[0],...values,sellPrice:sale/100,date:date.value,costMeta:meta,updatedAt:Date.now()};
      updated.profit=_flipNetOf(updated).net;
      const next=data.map(f=>f===matches[0]?updated:f);
      if(saveFlipsData(next)===false){message.textContent='The correction could not be saved on this device. Try again.';return;}
      renderFlipsView();showToast('Sale corrections saved. Report totals updated.','success');
    };
    container.querySelector('form')?.remove();container.append(form);inputs.sellPrice.focus();
  }
  function render() {
    const panel=document.getElementById('flipReportPanel');if(!panel)return;
    if(owner!==account()){owner=account();from='';to='';}
    panel.replaceChildren();
    panel.append(el('h3','Sales and expense report'));
    panel.append(el('p','Based on your saved sales. Complete totals include only records with confirmed purchase, fee, shipping and grading inputs. Refunds, supplies, taxes and other expenses are not tracked here. This is not a tax-ready report.'));
    const controls=el('div');controls.className='flip-report-controls';
    for(const [label,key,value] of [['From','from',from],['Through','to',to]]){
      const wrap=el('label',label+' '),input=el('input');input.type='date';input.value=value;input.setAttribute('aria-label','Report '+label.toLowerCase());
      input.addEventListener('change',()=>{if(key==='from')from=input.value;else to=input.value;render();});wrap.append(input);controls.append(wrap);
    }
    const reset=el('button','All dates');reset.type='button';reset.className='fl-sub-btn';reset.onclick=()=>{from='';to='';render();};controls.append(reset);
    const exportBtn=el('button','Export report CSV');exportBtn.type='button';exportBtn.className='fl-sub-btn';
    exportBtn.onclick=()=>{if(owner!==account()){render();showToast('Account changed. Review this account’s report before exporting.','info');return;}try{download(build(loadFlipsData(),from,to),'cardsell_sales_report.csv');}catch(e){showToast(e.message,'error');}};controls.append(exportBtn);panel.append(controls);
    const status=el('p');status.setAttribute('role','status');panel.append(status);
    try{
      const report=build(loadFlipsData(),from,to);exportBtn.disabled=!report.rows.length;
      status.textContent=`${report.rows.length} sales in report · ${report.complete} complete for tracked inputs · ${report.incomplete} need review.`+(report.excludedUndated?` ${report.excludedUndated} records without valid sale dates excluded by date range.`:report.undated?` ${report.undated} records have no valid sale date.`:'');
      const grid=el('dl');grid.className='flip-report-totals';
      ['Sale proceeds','Purchase costs','Fees','Shipping','Grading','Profit after tracked costs'].forEach((label,i)=>{const box=el('div');box.append(el('dt',label),el('dd',report.complete?'$'+format(report.totals[i]):'—'));grid.append(box);});panel.append(el('p','Totals below cover the '+report.complete+' complete records only.'),grid);
      if(report.rows.length){const details=el('details');details.append(el('summary','Review or correct '+report.rows.length+' sales ('+report.incomplete+' incomplete)'));const list=el('ul');
        for(const r of [...report.rows].sort((a,b)=>Number(a.complete)-Number(b.complete))){const item=el('li');item.append(el('p',(r.f.card||'Unnamed card')+' · '+(r.f.date||'No sale date')+' — '+r.status+'. '+r.missing));const edit=el('button','Correct sale');edit.type='button';edit.className='fl-sub-btn';edit.onclick=()=>editRecord(r,item);item.append(edit);list.append(item);}details.append(list);panel.append(details);}

    }catch(e){status.textContent=e.message;exportBtn.disabled=true;}
  }
  const original=window.renderFlipsView;
  if(typeof original==='function')window.renderFlipsView=function(...args){const result=original.apply(this,args);render();return result;};
  window.toggleFlipReport=function(){const panel=document.getElementById('flipReportPanel');if(!panel)return;panel.hidden=!panel.hidden;document.getElementById('flipReportToggle')?.setAttribute('aria-expanded',String(!panel.hidden));render();};
})();
