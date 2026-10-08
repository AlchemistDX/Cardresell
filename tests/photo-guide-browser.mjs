// Local camera-flow integration: real canvas, worker and QA renderer. No APIs,
// accounts or credits. Supply PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {referencedHashedAssets,ROOT} from './_assetRefs.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assets=referencedHashedAssets(),ui=readFileSync(assets.find(a=>a.base==='ui').path,'utf8');
const guide=assets.find(a=>a.base==='photo-guide').ref;
const code=ui.slice(ui.indexOf('function _liveCapCardSharpness('),ui.indexOf('function _liveCapSnap('))+
 ui.slice(ui.indexOf('function _liveCapOutline('),ui.indexOf('// Public entry point used by the sub-row'));
const html=`<meta charset="utf-8"><canvas id="liveCapVideo" width="400" height="560" style="position:absolute;left:0;top:0;width:400px;height:560px"></canvas>
<div id="liveCapOverlay" style="display:flex"></div><div id="liveCapFrameArea" style="position:absolute;left:0;top:0;width:400px;height:560px"></div>
<div id="liveCapFrame" style="position:absolute;left:40px;top:55px;width:320px;height:448px"></div>
<div id="liveCapQABar"><span id="liveCapQAIcon"></span><span id="liveCapQAText"></span><span id="liveCapQAPill"></span></div>
<script src="${guide}"></script><script>
const _LIVECAP_SOFT_THRESHOLD=14;function _liveCapLayout(){}function _liveCapStopQA(){}
window._liveCapState={active:true,role:'face'};window._liveCapQACanvas=document.createElement('canvas');
window._liveCapQACand=null;window._liveCapQAStreak=0;window._liveCapQAState=null;
Object.assign(document.getElementById('liveCapVideo'),{videoWidth:400,videoHeight:560});
${code}</script>`;
const server=createServer((req,res)=>{try{
 if(req.url==='/fixture'){res.setHeader('content-type','text/html');res.end(html);return;}
 if(!/^\/js\/[\w.-]+\.js$/.test(req.url)){res.writeHead(404).end();return;}
 res.setHeader('content-type','text/javascript');res.end(readFileSync(join(ROOT,req.url)));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
 async function scene(mode){return page.evaluate(async mode=>{
  const c=document.getElementById('liveCapVideo'),ctx=c.getContext('2d'),p=ctx.createImageData(400,560);
  for(let y=0;y<560;y++)for(let x=0;x<400;x++){
   let v=mode==='dark'?2:mode==='blank'?110:mode==='bright'?245:
     mode==='soft'?110+40*Math.sin(x/35)*Math.cos(y/35):((x%8<4)!==(y%8<4)?55:180);
   if(mode==='glare' && x>160 && x<200 && y>190 && y<230)v=255;
   const i=(y*400+x)*4;p.data.set([v,v,v,255],i);
  }ctx.putImageData(p,0,0);
  for(let i=0;i<3;i++)await _liveCapQATick();
  return {text:document.getElementById('liveCapQAText').textContent,state:window._liveCapQAState,
   disabled:!!window._liveCapState.outlineDisabled,busy:window._liveCapState.qaBusy,score:window._liveCapLastSharpness};
 },mode);}
 for(const [mode,pattern] of [['dark',/too dark/],['blank',/Not enough detail/],['soft',/View looks soft/],['sharp',/Keep all four/],['glare',/reflection|Bright light/],['bright',/too bright/],['sharp',/Keep all four/]]){
  const result=await scene(mode);assert.match(result.text,pattern,mode);assert.equal(result.disabled,false,'worker remains usable');assert.equal(result.busy,false);if(mode!=='glare')assert.equal(result.score,null,'unlocated samples never become card scores');console.log(mode+': '+result.text);
 }
 assert.deepEqual(errors,[]);
 console.log('Photo guide browser flow: 7 scenarios passed; real worker and canvas; no provider calls.');
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
