// Run a real binder-page photo through the shipped binder flow locally.
// No network: /api is blocked. Usage:
//   node tools/binder-photo-eval.mjs <photo> [layout=3,3] [left,right,top,bottom margins %] [outDir]
// Prints ticks, pocket sizes, photo-QC result and the local artwork matcher's
// best guess per pocket; saves crops and the grid preview to outDir.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
const [photo, layout = '3,3', margins = '', outDir = '/tmp/binder-eval'] = process.argv.slice(2);
if (!photo) { console.error('usage: node tools/binder-photo-eval.mjs <photo> [layout] [l,r,t,b] [outDir]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const root = resolve(new URL('..', import.meta.url).pathname);
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2' };
const server = createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname);p=join(root,p==='/'?'index.html':p);if(!existsSync(p)){s.statusCode=404;return s.end();}s.setHeader('content-type',types[extname(p)]||'application/octet-stream');s.end(readFileSync(p));});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
const b=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
const page=await b.newPage({viewport:{width:390,height:844}});
await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
await page.route('**/*',r=>{const u=r.request().url(); if(!u.startsWith(origin)||u.includes('/api/')) return r.fulfill({status:204,body:''}); return r.continue();});
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
try {
  await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.CardResellBinder&&window.CardResellFastPath&&window.CardResellPhotoQC,null,{timeout:30000});
  await page.evaluate(()=>{window._bulkQueue=[];document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan();});
  await page.selectOption('#binderLayout',layout);
  const t0=Date.now();
  await page.setInputFiles('#binderInput',photo);
  await page.waitForFunction(()=>!document.getElementById('binderControls').disabled&&document.getElementById('binderStatus').textContent&&!/Opening|Preparing/.test(document.getElementById('binderStatus').textContent),null,{timeout:60000});
  if (margins) {
    const [l,r,t,bm]=margins.split(',').map(Number);
    await page.evaluate(([l,r,t,bm])=>{for(const [k,v] of [['Left',l],['Right',r],['Top',t],['Bottom',bm]]){const e=document.getElementById('binder'+k);e.value=v;e.dispatchEvent(new Event('change'));}},[l,r,t,bm]);
    await page.waitForTimeout(300);
    await page.waitForFunction(()=>!document.getElementById('binderControls').disabled,null,{timeout:60000});
  }
  const ms=Date.now()-t0;
  const state=await page.evaluate(()=>({status:document.getElementById('binderStatus').textContent,
    margins:['Left','Right','Top','Bottom'].map(k=>Number(document.getElementById('binder'+k).value)),
    pockets:[...document.querySelectorAll('.binder-pocket')].map(l=>({ticked:l.querySelector('input').checked,detail:l.dataset.detail||'',empty:!!l.querySelector('.binder-empty-tag')})),
    preview:document.getElementById('binderPreview').hidden?null:document.getElementById('binderPreview').toDataURL('image/jpeg',.85)}));
  if (state.preview) writeFileSync(join(outDir,'preview.jpg'),Buffer.from(state.preview.split(',')[1],'base64'));
  console.log(JSON.stringify({photo,layout,margins:state.margins,ms,status:state.status}));
  if (!state.pockets.length) { console.log('no pockets'); }
  else {
    await page.click('#binderSelectAll'); await page.click('#binderContinue');
    const rows=await page.evaluate(async()=>{const out=[];for(const q of _bulkQueue){const qc=await CardResellPhotoQC.check(q.file,{skipDupe:true});let fp=null;try{fp=await CardResellFastPath.scanFile(q.file);}catch(e){fp={err:String(e)}}
      const g=(fp&&fp.bestGuess)||{};const bytes=Array.from(new Uint8Array(await q.file.arrayBuffer()));
      out.push({name:q.file.name,w:qc.details.width,h:qc.details.height,blur:qc.details.blurScore,qc:qc.ok?'ok':qc.reasons.join('+'),dist:fp&&fp.bestDist,gap:fp&&Number.isFinite(fp.secondDist)?fp.secondDist-fp.bestDist:null,guess:[g.card_name,g.set_name,g.card_number&&('#'+g.card_number)].filter(Boolean).join(' | '),bytes});}return out;});
    rows.forEach((r,i)=>{writeFileSync(join(outDir,r.name),Buffer.from(r.bytes));delete r.bytes;console.log(JSON.stringify({...state.pockets[i],...r}));});
  }
  console.log('page errors',errs.length,errs.slice(0,2).join(' | '));
} finally { await b.close(); server.close(); }
