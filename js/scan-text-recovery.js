/* On-device name recovery. Suggestions never establish a printing or debit a scan. */
(() => {
  'use strict';
  const LIMIT = {load:15000,worker:20000,read:8000,lookup:7500,total:45000,batch:90000};
  const games = new Set(['mtg','pokemon','pokemonjp','yugioh','lorcana','onepiece','sports']);
  let loading = null, batch = null;
  const suggestions = new WeakMap(), attempted = new WeakMap();
  const gameKey = value => {
    const key=String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
    return ['magic','magicthegathering'].includes(key)?'mtg':key==='pokemonjapanese'?'pokemonjp':key==='disneylorcana'?'lorcana':games.has(key)?key:'';
  };
  function names(text,game) {
    const pokemon=game==='pokemon'||game==='pokemonjp';
    const lines=[...new Set(String(text || '').split('\n').map(s=>{
      s=s.normalize('NFKC').replace(/[|_\\/\[\]{}<>=+*@#$%^&`~]/g,' ').replace(/\s+/g,' ').trim()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
      if(pokemon)s=s.replace(/^(?:basic|stage\s*[12])\s+/i,'')
        .replace(/\s+(?:[lw]v?\.?\s*\d+|hp\s*\d+|\d+\s*hp)\b.*$/i,'')
        .replace(/\s+\d{2,3}(?:\s|$).*$/,'');
      return s.trim();
    }).filter(s=>s.length>=3 && s.length<=100 && /\p{L}{3}/u.test(s) &&
      !/^(?:creature|instant|sorcery|enchantment|artifact|trainer|stage \d|hp \d|evolves|illustrat|copyright)\b/i.test(s)))];
    // A binder pocket may begin with sleeve/background noise. Consider the
    // readable lines in the strip, not just its first two OCR lines.
    const score=s=>{const words=s.match(/\p{L}+/gu)||[];return Math.max(0,...words.map(w=>w.length))+
      words.filter(w=>w.length>=4).length*2-words.filter(w=>w.length<=2).length*1.5;};
    return lines.sort((a,b)=>score(b)-score(a)).slice(0,2);
  }
  function wait(promise, signal, ms) {
    return new Promise((resolve,reject)=>{
      let done=false,timer;
      const finish=(fn,v)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);fn(v)};
      const abort=()=>finish(reject,Object.assign(new Error('Reading stopped'),{name:'AbortError'}));
      signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(reject,Object.assign(new Error('Reading timed out'),{name:'TimeoutError'})),ms);
      Promise.resolve(promise).then(v=>finish(resolve,v),e=>finish(reject,e));
      if(signal.aborted)abort();
    });
  }
  function load() {
    if(window.Tesseract?.createWorker)return Promise.resolve(window.Tesseract);
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');let done=false;
      const finish=ok=>{if(done)return;done=true;clearTimeout(timer);script.onload=script.onerror=null;
        if(ok && window.Tesseract?.createWorker)resolve(window.Tesseract);
        else {script.remove();reject(new Error('Text reader unavailable'))}};
      const timer=setTimeout(()=>finish(false),LIMIT.load);
      script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload=()=>finish(true);script.onerror=()=>finish(false);document.head.appendChild(script);
    });
    const pending=loading;pending.then(()=>{if(loading===pending)loading=null},()=>{if(loading===pending)loading=null});
    return pending;
  }
  async function decode(file,signal) {
    if(typeof createImageBitmap==='function') {
      try {
        const pending=createImageBitmap(file);
        pending.then(bitmap=>{if(signal.aborted)bitmap.close()},()=>{});
        return await wait(pending,signal,LIMIT.read);
      } catch(error) {if(signal.aborted || error.name==='TimeoutError')throw error;}
    }
    return await new Promise((resolve,reject)=>{
      const image=new Image(),url=URL.createObjectURL(file);let done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
        image.onload=image.onerror=null;URL.revokeObjectURL(url);error?reject(error):resolve(image)};
      const abort=()=>{finish(Object.assign(new Error('Reading stopped'),{name:'AbortError'}));image.src=''};
      const timer=setTimeout(()=>{finish(new Error('Photo decode timed out'));image.src=''},LIMIT.read);
      image.onload=()=>finish();image.onerror=()=>finish(new Error('Photo unreadable'));
      signal.addEventListener('abort',abort,{once:true});image.src=url;if(signal.aborted)abort();
    });
  }
  function strip(image,part) {
    const w=image.width || image.naturalWidth,h=image.height || image.naturalHeight;
    const [y0,y1,rotate=0]=part,sw=w*.94,sh=Math.max(1,h*(y1-y0));
    const scale=Math.min(3,1600/Math.max(1,sw));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';
    if(rotate===180){ctx.translate(canvas.width,canvas.height);ctx.rotate(Math.PI)}
    ctx.drawImage(image,w*.03,h*y0,sw,sh,0,0,canvas.width,canvas.height);
    return canvas;
  }
  async function find(file,options={}) {
    const game=gameKey(options.game);if(!file || !game)return null;
    const controller=new AbortController(),signal=controller.signal;
    const current=()=>!signal.aborted && (!options.isCurrent || options.isCurrent());
    const abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted)abort();
    const deadline=setTimeout(abort,LIMIT.total),watch=setInterval(()=>{if(!current())abort()},150);
    let worker,image,finished=false;
    const stop=()=>{if(worker){const w=worker;worker=null;try{Promise.resolve(w.terminate()).catch(()=>{})}catch{}}};
    signal.addEventListener('abort',stop,{once:true});
    try {
      if(!current())return null;
      options.onProgress?.('Loading text reader…');
      const reader=await wait(load(),signal,LIMIT.load);
      if(!current())return null;
      const creation=Promise.resolve().then(()=>current()?reader.createWorker(game==='pokemonjp'?'jpn+eng':'eng'):null);
      creation.then(w=>{if(!w)return;if(!current()||finished){try{Promise.resolve(w.terminate()).catch(()=>{})}catch{}}else worker=w},()=>{});
      worker=await wait(creation,signal,LIMIT.worker);if(!worker || !current())return null;
      await wait(worker.setParameters({tessedit_pageseg_mode:'6'}),signal,5000);
      image=await decode(file,signal);if(!current())return null;
      const windows=game==='lorcana'?[[.38,.65],[.48,.76],[0,.22],[.78,1,180]]:
        game==='sports'?[[.65,1],[0,.25],[.18,.42],[.75,1,180]]:
        [[0,.20],[.12,.35],[.23,.46],[.80,1,180]];
      const seen=new Set(),reads=[];let lookups=0;
      for(let i=0;i<windows.length && current();i++) {
        options.onProgress?.(`Reading card text ${i+1}/${windows.length}…`);
        const canvas=strip(image,windows[i]);let data;
        try {({data}=await wait(worker.recognize(canvas),signal,LIMIT.read))}
        finally {canvas.width=canvas.height=1;}
        for(const name of names(data?.text,game)) {
          if(!current())return null;const key=name.toLocaleLowerCase();if(seen.has(key))continue;
          seen.add(key);reads.push(name);
          if(options.lookup && lookups++<6) {
            options.onProgress?.('Checking the printed name…');
            let hit=null;
            try {hit=await wait(options.lookup(name,game),signal,LIMIT.lookup)}
            catch(error){if(signal.aborted)throw error;}
            if(current() && hit?.name){options.onComplete?.();return {name:String(hit.name).slice(0,120),game,catalogueMatched:true};}
          }
        }
      }
      // Unconfirmed OCR remains visibly a search suggestion. No set, number,
      // price, grounded ID or success flag is inferred from the printed name.
      if(current())options.onComplete?.();
      return current() && reads.length?{name:reads[0],game,catalogueMatched:false}:null;
    } catch(error) {
      if(current())options.onProgress?.('Text recovery could not finish. You can search by name.');
      return null;
    } finally {
      finished=true;clearTimeout(deadline);clearInterval(watch);options.signal?.removeEventListener('abort',abort);
      stop();controller.abort();try{image?.close?.()}catch{}
    }
  }
  function suggestion(row) {
    const s=suggestions.get(row);
    return s && s.file===row.file && s.owner===window._fbAuth?.currentUser?s.value:null;
  }
  function eligible(row) {
    return row && !row.success && row.definiteMiss && !row.providerNeedsReview && row.file &&
      !row._rescanning && !row._photoChecking && !row._replacementPhoto && !window.CardResellBulkLookup?.isEditing?.(row);
  }
  function batchCurrent(job) {
    return batch===job && !job.controller.signal.aborted && window._bulkResults===job.results &&
      window._bulkQueue===job.queue && window._fbAuth?.currentUser===job.owner &&
      !window._bulkProcessing && !window._bulkSaved && !window._bulkDraftBusy;
  }
  function cancelBatch() {const job=batch;batch=null;if(job){job.controller.abort();job.status?.remove()}}
  function recoverBatch() {
    if(batch && batchCurrent(batch))return batch.promise;
    cancelBatch();
    if(window._bulkProcessing || window._bulkSaved || window._bulkDraftBusy)return Promise.resolve(0);
    const results=window._bulkResults || [],owner=window._fbAuth?.currentUser;
    const known=[...new Set(results.filter(r=>r?.success&&!r.providerNeedsReview).map(r=>r.isJapanese?'pokemonjp':gameKey(r.cardType)).filter(Boolean))];
    const selected=gameKey(window.activeGame);
    const choices=results.filter(eligible).map(row=>{
      const hint=gameKey(row.scanGameHint);
      return {row,game:hint==='pokemon'&&selected==='pokemonjp'?selected:hint || (known.length===1?known[0]:selected) || 'mtg'};
    })
      .filter(({row,game})=>['mtg','pokemon','pokemonjp','yugioh','lorcana','onepiece'].includes(game) && !suggestion(row) &&
        !(attempted.get(row)?.file===row.file && attempted.get(row)?.owner===owner && attempted.get(row)?.game===game));
    if(!choices.length)return Promise.resolve(0);
    const job=batch={results,queue:window._bulkQueue,owner,controller:new AbortController()};
    job.promise=(async()=>{
      let found=0;
      const deadline=setTimeout(()=>job.controller.abort(),LIMIT.batch);
      const watch=setInterval(()=>{if(!batchCurrent(job))job.controller.abort()},200);
      const list=document.getElementById('bulkResultsList');
      if(list?.parentElement){
        const box=document.createElement('div'),label=document.createElement('span'),stop=document.createElement('button');
        box.id='bulkNameRecoveryStatus';box.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#211b2d;color:#eee';
        label.setAttribute('role','status');label.setAttribute('aria-live','polite');
        stop.type='button';stop.textContent='Stop';stop.setAttribute('aria-label','Stop reading card names');stop.style.cssText='min-height:44px;padding:8px 16px';
        stop.onclick=()=>cancelBatch();box.append(label,stop);list.parentElement.insertBefore(box,list);job.status=box;job.label=label;
      }
      try {for(let i=0;i<choices.length && batchCurrent(job);i++) {
        const {row,game}=choices[i],file=row.file;
        const current=()=>batchCurrent(job)&&results.includes(row)&&row.file===file&&eligible(row);
        if(!current())continue;
        let completed=false;
        const value=await find(file,{game,signal:job.controller.signal,isCurrent:current,onComplete:()=>{completed=true},
          onProgress:message=>{if(current()&&job.label)job.label.textContent=`Card ${i+1}/${choices.length} · ${message}`},
          lookup:(name,key)=>typeof window._confirmCardByName==='function'?window._confirmCardByName(name,key):null});
        if(!current())continue;
        // Completed empty reads are not repeated on the same photo/account.
        // A timed-out/unavailable reader remains retryable.
        if(completed)attempted.set(row,{file,owner,game});
        if(value){suggestions.set(row,{file,owner,value});found++;window._bulkUpdateRow?.(row.rowId,row)}
      }} finally {clearTimeout(deadline);clearInterval(watch);job.controller.abort();job.status?.remove();if(batch===job)batch=null;}
      return found;
    })();return job.promise;
  }
  window.CardResellScanTextRecovery={find,recoverBatch,cancelBatch,suggestion,gameKey};
})();
