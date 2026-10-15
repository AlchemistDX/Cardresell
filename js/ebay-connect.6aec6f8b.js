/* Optional read-only seller connection. No credentials enter browser storage. */
(() => {
  'use strict';
  const owner=()=>window.googleUser?.sub||null;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
  let checkedOwner=null,requestNumber=0,active=null;
  async function request(action,method='GET',expected=owner()) {
    if(!expected || owner()!==expected)throw Error('Sign in to the CardResell account that started this connection.');
    const token=await _crIdToken();
    if(!token || owner()!==expected)throw Error('Your account changed. Reopen the eBay connection.');
    const response=await fetch('/api/ebay-connect?action='+action,{method,credentials:'same-origin',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});
    const data=await response.json();
    if(owner()!==expected)throw Error('Your account changed. Reopen the eBay connection.');
    if(!response.ok)throw Error(data.error||'Could not check the eBay connection. Try again.');
    return data;
  }
  async function mount(force=false) {
    const b=document.getElementById('ebayConnectionBtn');if(!b)return;
    const current=owner();if(checkedOwner===current&&!force)return;
    checkedOwner=current;const n=++requestNumber;b.hidden=true;
    if(!current)return;
    try{const data=await request('status','GET',current);if(n!==requestNumber||owner()!==current)return;b.hidden=!data.available&&!data.connected;b.textContent=data.connected?'eBay connected':'Connect eBay';}catch{checkedOwner=null;}
  }
  async function open(outcome) {
    if(active){active.dialog.focus();return;}
    if(!document.getElementById('ebayConnectStyle')) {
      const s=el('style');s.id='ebayConnectStyle';s.textContent=`
.ebay-connect{color:var(--text,#eee);background:var(--bg,#111);border:1px solid var(--border,#444);border-radius:16px;width:min(560px,calc(100vw - 24px));max-height:calc(100dvh - 32px);box-sizing:border-box;padding:20px;overflow:auto;overscroll-behavior:contain}
.ebay-connect::backdrop{background:rgba(0,0,0,.75)}.ebay-connect header,.ebay-connect-actions{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}.ebay-connect h2{margin:0;font-size:1.2rem}.ebay-connect p{font-size:.9rem;line-height:1.6}.ebay-connect button{min-height:44px;padding:10px 14px;font:inherit;color:var(--text,#eee);background:var(--surface-2,#222);border:1px solid var(--border,#555);border-radius:8px;cursor:pointer}.ebay-connect button:disabled{opacity:.5;cursor:default}.ebay-connect button:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:2px}.ebay-connect [data-primary]{background:var(--gold,#d4af37);color:#171108;font-weight:700}.ebay-connect [role=alert]{color:var(--danger-text,#ff9999)}.ebay-connect dl{display:grid;grid-template-columns:1fr auto;gap:12px;font-size:.85rem}.ebay-connect dd{margin:0;text-align:right}.ebay-connect [hidden]{display:none!important}
`;document.head.append(s);
    }
    const dialog=el('dialog');dialog.id='ebayConnectDialog';dialog.className='ebay-connect';dialog.setAttribute('aria-labelledby','ebayConnectTitle');
    const state={dialog,owner:owner(),closed:false};active=state;
    const header=el('header'),title=el('h2','eBay seller connection');title.id='ebayConnectTitle';header.append(title,button('Close',()=>dialog.close()));dialog.append(header);
    dialog.append(el('p','Check your eBay seller registration, policies, and inventory locations. This connection is read-only. Listing publication and automatic inventory sync are not enabled.'));
    const status=el('p','Checking connection…');status.setAttribute('role','status');dialog.append(status);
    const error=el('p');error.setAttribute('role','alert');dialog.append(error);
    const details=el('div');dialog.append(details);
    const actions=el('div');actions.className='ebay-connect-actions';dialog.append(actions);
    const current=()=>active===state&&!state.closed&&owner()===state.owner;
    const closeOnChange=setInterval(()=>{if(!current()){dialog.close();mount(true);}},300);
    dialog.addEventListener('close',()=>{state.closed=true;clearInterval(closeOnChange);if(active===state)active=null;dialog.remove();document.getElementById('ebayConnectionBtn')?.focus();},{once:true});
    document.body.append(dialog);dialog.showModal();
    const notes={denied:'You declined eBay authorization. Your existing connection was not changed.',expired:'That authorization expired. Start again from this dialog.',error:'eBay authorization could not be completed. Try connecting again.',unavailable:'Direct eBay connection is not available yet.'};
    if(notes[outcome])error.textContent=notes[outcome];
    async function run(work) {
      if(!current())return;actions.querySelectorAll('button').forEach(b=>b.disabled=true);error.textContent='';
      try{await work();}catch(e){if(current()){error.textContent=e.message||'Could not complete this action. Try again.';if(!actions.children.length)actions.append(button('Retry',()=>run(refresh)));}}
      finally{if(current())actions.querySelectorAll('button').forEach(b=>b.disabled=false);}
    }
    async function refresh() {
      if(!current())return;
      const data=await request('status','GET',state.owner);if(!current())return;
      actions.replaceChildren();details.replaceChildren();mount(true);
      if(!data.available) {
        status.textContent='Direct eBay connection is being prepared. You can prepare listing drafts and export a Seller Hub CSV from Drafts.';
        if(data.connected)actions.append(button('Disconnect eBay',disconnect));
        return;
      }
      status.textContent=(data.environment==='sandbox'?'eBay Sandbox · ':'')+(data.connected?'Connected to '+data.username+(data.reconnectRequired?' · Authorization expired. Reconnect to continue.':'.'):'No eBay account connected.');
      if(data.pending) {
        details.append(el('p','Finish connecting '+data.pending.username+' to your current CardResell account. Confirm only if this is the seller account you intended to use.'));
        const confirm=button('Confirm eBay connection',()=>run(async()=>{await request('confirm','POST',state.owner);if(current())await refresh();}));confirm.dataset.primary='';actions.append(confirm);
      } else {
        const connect=button(data.connected?'Reconnect eBay':'Continue to eBay',()=>run(async()=>{
          const result=await request('start','POST',state.owner);if(!current())return;
          const url=new URL(result.url);
          if(!['https://auth.ebay.com','https://auth.sandbox.ebay.com'].includes(url.origin)||url.pathname!=='/oauth2/authorize')throw Error('The eBay authorization link could not be confirmed.');
          window.location.assign(url.href);
        }));connect.dataset.primary='';actions.append(connect);
      }
      if(data.connected)actions.append(button('Check seller setup',()=>run(async()=>{
        status.textContent='Checking seller setup for eBay US…';const report=await request('readiness','POST',state.owner);if(!current())return;
        details.replaceChildren();const list=el('dl');
        const rows=[['Seller registration',report.sellerRegistered===true?'Complete':report.sellerRegistered===false?'Incomplete':'Could not check'],['Shipping policies',report.fulfillmentPolicies],['Payment policies',report.paymentPolicies],['Return policies',report.returnPolicies],['Enabled inventory locations',report.inventoryLocations]];
        rows.forEach(([label,value])=>list.append(el('dt',label),el('dd',value===null?'Could not check':String(value))));details.append(list);
        status.textContent=report.reconnectRequired?'eBay authorization expired or was revoked. Use Reconnect eBay to authorize again.':report.partial?'Some eBay checks were unavailable. Retry to confirm the remaining items.':'Seller setup checked for eBay US.';
        details.append(el('p','These checks describe account setup only. Each draft still needs reviewed card details, photos, price, and selling terms before it can be listed.'));
      })),button('Disconnect eBay',disconnect));
    }
    function disconnect() {
      details.replaceChildren(el('p','Remove your saved eBay connection? This removes authorization tokens from CardResell. Existing eBay listings stay on eBay.'));
      actions.replaceChildren(button('Keep connection',()=>run(refresh)),button('Confirm disconnect',()=>run(async()=>{await request('disconnect','DELETE',state.owner);if(current())await refresh();})));
    }
    if(!state.owner) {
      status.textContent='Sign in to the CardResell account that started this connection.';
      actions.append(button('Sign in',()=>{dialog.close();window.triggerGoogleSignIn?.('collection');}));
    } else await run(refresh);
  }
  window.CardResellEbayConnect={mount,open};
  mount();
  const url=new URL(window.location.href),outcome=url.searchParams.get('ebay_connection');
  if(['review','denied','expired','error','unavailable'].includes(outcome)) {
    url.searchParams.delete('ebay_connection');history.replaceState(history.state,'',url.pathname+url.search+url.hash);
    // Give the existing Firebase session restoration a chance to finish. The
    // dialog still offers sign-in if restoration does not complete promptly.
    let tries=0;const timer=setInterval(()=>{if(owner()||++tries>=20){clearInterval(timer);open(outcome);}},250);
  }
})();
