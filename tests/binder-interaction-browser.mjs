// Full shipped page and assets. Real browser touch/mouse/keyboard input;
// synthetic local photos only, all external services blocked.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
  const path=join(root,pathname==='/'?'index.html':pathname);
  if(!path.startsWith(root)||!existsSync(path)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');
  res.end(readFileSync(path));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
let checks=0;
const check=(label,actual,expected=true)=>{assert.deepEqual(actual,expected,label);checks++;console.log('✓ '+label);};
try {
  for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1440,height:1000}]) {
    const touch=viewport.width!==1440;
    const page=await browser.newPage({viewport,hasTouch:touch,isMobile:touch});
    const errors=[],scanRequests=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(/\/api\/(?:identify|scan|grade|bulk)/.test(url))scanRequests.push(url);
      return url.startsWith(origin)&&!url.includes('/api/')?route.continue():route.fulfill({status:204,body:''});
    });
    await page.goto(origin);
    await page.waitForFunction(()=>typeof startBinderScan==='function');
    await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan();window._idScanCredits=20;});
    await page.selectOption('#binderLayout','2,2');
    const data=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=c.height=2400;const x=c.getContext('2d');
      ['#f00','#0f0','#00f','#ff0'].forEach((color,i)=>{x.fillStyle=color;x.fillRect(i%2*1200,Math.floor(i/2)*1200,1200,1200);});
      return c.toDataURL().split(',')[1];
    });
    const file={name:'binder-interaction.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
    await page.setInputFiles('#binderInput',file);
    const ready=()=>page.waitForFunction(()=>!document.getElementById('binderControls').disabled&&document.querySelectorAll('.binder-pocket').length===4&&document.getElementById('binderPockets').getAttribute('aria-busy')!=='true');
    const state=()=>page.evaluate(()=>({
      margins:['Left','Right','Top','Bottom'].map(k=>Number(document.getElementById('binder'+k).value)),
      crops:[...document.querySelectorAll('.binder-pocket img')].map(e=>e.src),
      selected:[...document.querySelectorAll('.binder-pocket input')].filter(e=>e.checked).length,
      scroll:document.getElementById('bulkBinderReview').scrollTop,
      height:document.getElementById('binderPockets').getBoundingClientRect().height,
      canvasY:document.getElementById('binderPreview').getBoundingClientRect().y,
      move:document.getElementById('binderMovePhoto').getAttribute('aria-pressed'),
      action:getComputedStyle(document.getElementById('binderPreview')).touchAction,
    }));
    const preview=page.locator('#binderPreview'),zoom=page.locator('#binderZoom');
    const select=async()=>{await page.locator('#binderSelectAll').click();await preview.scrollIntoViewIfNeeded();};
    const point=async()=>{await preview.scrollIntoViewIfNeeded();const b=await preview.boundingBox();return {x:b.x+b.width/2,y:Math.max(50,Math.min(viewport.height-70,b.y+b.height/2))};};
    const cdp=await page.context().newCDPSession(page);
    const touchEvent=(type,p)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[p]:[]});
    const swipe=async()=>{
      const p=await point(),before=await state();
      await touchEvent('touchStart',p);
      for(let i=1;i<=6;i++){await touchEvent('touchMove',{x:p.x,y:p.y-i*12});await page.waitForTimeout(20);}
      await touchEvent('touchEnd');
      await page.waitForFunction(s=>document.getElementById('bulkBinderReview').scrollTop>s+25,before.scroll);
      await page.waitForTimeout(180);
      const after=await state();
      check('swiping the photo scrolls the page',after.scroll>before.scroll+25);
      check('scrolling preserves the crop and selection',[after.margins,after.crops,after.selected],[before.margins,before.crops,before.selected]);
    };
    await ready();await select();
    check('binder fits viewport width',await page.locator('#bulkBinderReview').evaluate(e=>e.scrollWidth<=e.clientWidth));
    check('full-photo boundary arrows are visibly disabled',await page.locator('[data-binder-move]:disabled').count(),4);
    const initial=await state();await preview.focus();await page.keyboard.press('ArrowRight');
    check('a boundary key leaves selected crops intact',[(await state()).crops,(await state()).selected],[initial.crops,4]);
    const p=await point(),beforeTap=await state();
    if(touch){await touchEvent('touchStart',p);}else{await page.mouse.move(p.x,p.y);await page.mouse.down();}
    check('pointer down does not clear selections',(await state()).selected,4);
    check('pointer down does not collapse previews',(await state()).height,beforeTap.height);
    if(touch){await touchEvent('touchEnd');}else{await page.mouse.up();}
    check('a tap does not change crop files',(await state()).crops,beforeTap.crops);
    check('a tap does not jump the page',Math.abs((await state()).scroll-beforeTap.scroll)<2);
    if(touch)await swipe();

    await zoom.fill('120');await zoom.dispatchEvent('change');await ready();
    for(const [direction,index,sign] of [['left',0,1],['right',0,-1],['up',2,1],['down',2,-1]]){
      const before=(await state()).margins[index];
      await page.locator(`[data-binder-move="${direction}"]`).click();await ready();
      check(`${direction} button moves the actual crop`,((await state()).margins[index]-before)*sign>0);
    }
    await zoom.focus();const oldZoom=Number(await zoom.inputValue());await page.keyboard.press('ArrowRight');await ready();
    check('native keyboard zoom changes scale',Number(await zoom.inputValue()),oldZoom+1);
    check('crop rebuilding retains slider focus',await zoom.evaluate(e=>document.activeElement===e));
    // Native range drag (rather than just dispatching input/change).
    await zoom.scrollIntoViewIfNeeded();const z=await zoom.boundingBox(),zp={x:z.x+z.width*.5,y:z.y+z.height/2};
    if(touch){await touchEvent('touchStart',zp);await touchEvent('touchMove',{x:zp.x+20,y:zp.y});await touchEvent('touchEnd');}
    else{await page.mouse.move(zp.x,zp.y);await page.mouse.down();await page.mouse.move(zp.x+20,zp.y);await page.mouse.up();}
    await ready();check('native range drag commits usable crops',Number(await zoom.inputValue())>130);
    await zoom.fill('125');await zoom.dispatchEvent('change');await ready();await select();
    if(touch)await page.locator('#binderMovePhoto').click();
    const dp=await point(),beforeDrag=await state();
    if(touch)await touchEvent('touchStart',dp);else{await page.mouse.move(dp.x,dp.y);await page.mouse.down();}
    check('starting a deliberate drag preserves old crops until motion',(await state()).selected,4);
    if(touch)await touchEvent('touchMove',{x:dp.x+20,y:dp.y+10});else await page.mouse.move(dp.x+20,dp.y+10,{steps:3});
    check('actual movement blocks stale-crop handoff',await page.locator('#binderContinue').isDisabled());
    check('actual movement reserves preview space',(await state()).height>=beforeDrag.height);
    check('photo stays steady during crop replacement',Math.abs((await state()).canvasY-beforeDrag.canvasY)<2);
    if(touch)await touchEvent('touchEnd');else await page.mouse.up();
    await ready();const afterDrag=await state();
    check('drag changes source pixels',afterDrag.margins[0]<beforeDrag.margins[0]&&afterDrag.margins[2]<beforeDrag.margins[2]);
    check('releasing a drag returns to scrolling',[afterDrag.move,afterDrag.action],['false','pan-y pinch-zoom']);
    if(touch)await swipe();

    // Cancellation and capture loss must not leave an armed canvas or stale crops.
    for(const ending of touch?['touchCancel','blur']:['captureLoss','blur']){
      await select();if(touch)await page.locator('#binderMovePhoto').click();
      const cp=await point();
      if(touch){await touchEvent('touchStart',cp);await touchEvent('touchMove',{x:cp.x-12,y:cp.y});}
      else{await page.mouse.move(cp.x,cp.y);await page.mouse.down();await page.mouse.move(cp.x-12,cp.y);}
      if(ending==='touchCancel')await touchEvent('touchCancel');
      else if(ending==='captureLoss')await preview.evaluate(e=>{for(let id=1;id<10;id++)if(e.hasPointerCapture(id))e.releasePointerCapture(id);});
      else await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      if(touch&&ending!=='touchCancel')await touchEvent('touchEnd');
      if(!touch)await page.mouse.up();
      await ready();check(`${ending} releases movement mode`,(await state()).move,'false');
      check(`${ending} completes current crops`,await page.locator('.binder-pocket').count(),4);
    }
    await page.locator('#binderMovePhoto').click();await preview.focus();await page.keyboard.press('Escape');
    check('Escape exits photo movement without closing binder',await page.locator('#bulkBinderReview').isVisible());
    check('Escape restores scrolling',(await state()).move,'false');
    // Hold JPEG callbacks to reproduce rapid input racing older crop renders.
    await page.evaluate(()=>{window.originalToBlob=HTMLCanvasElement.prototype.toBlob;window.heldBlobs=[];HTMLCanvasElement.prototype.toBlob=function(cb,...args){originalToBlob.call(this,b=>heldBlobs.push(()=>cb(b)),...args);};});
    await zoom.fill('130');await zoom.dispatchEvent('change');
    await page.waitForFunction(()=>heldBlobs.length>0);
    check('slider stays usable while older crops encode',await zoom.isEnabled());
    await zoom.fill('140');await zoom.dispatchEvent('change');
    await page.waitForFunction(()=>heldBlobs.length>1);
    await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=originalToBlob;heldBlobs.splice(0).reverse().forEach(f=>f());});
    await ready();
    check('only the latest render survives rapid input',await page.locator('.binder-pocket').count(),4);
    check('latest zoom is retained after old work completes',await zoom.inputValue(),'140');
    await page.locator('#binderResetFit').click();await ready();
    check('reset restores full-photo geometry',(await state()).margins,[0,0,0,0]);
    await zoom.fill('125');await zoom.dispatchEvent('change');await ready();
    await page.locator('#binderSelectAll').click();await page.locator('#binderSelectNone').click();
    check('Clear removes selections',await page.locator('#binderContinue').isDisabled());
    await page.locator('#binderSelectAll').click();
    check('quote follows the real selected crop count',await page.locator('#binderContinue').textContent(),'Review 4 cards · 4 ID credits');
    if(process.env.CR_SHOT_DIR){mkdirSync(process.env.CR_SHOT_DIR,{recursive:true});await preview.scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.CR_SHOT_DIR,`binder-interaction-${viewport.width}.png`)});}
    await page.locator('#binderContinue').click();
    check('full shipped app reaches existing confirmation',await page.locator('#bulkCreditConfirm').isVisible());
    const queue=await page.evaluate(async()=>Promise.all(_bulkQueue.map(async q=>{
      const image=await createImageBitmap(q.file),c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(image,0,0,1,1);
      const result={w:image.width,h:image.height,pixel:[...c.getContext('2d').getImageData(0,0,1,1).data].slice(0,3).map(v=>v>128),id:q.scanUid};image.close();return result;
    })));
    check('handoff uses four unique physical crops',new Set(queue.map(q=>q.id)).size,4);
    check('handoff preserves original card order and colors',queue.map(q=>q.pixel),[[true,false,false],[false,true,false],[false,false,true],[true,true,false]]);
    check('handoff uses native adjusted pixels',queue.every(q=>q.w>900&&q.w<1100&&q.h>900&&q.h<1100));
    await page.evaluate(()=>{cancelBulkConfirm();startBinderScan();});
    check('reopen clears photo move state',(await state()).move,'false');
    check('reopen clears previews and pending layout space',[(await state()).crops.length,await page.locator('#binderPockets').evaluate(e=>e.style.minHeight)],[0,'']);
    check('reopen clears busy accessibility state',await page.locator('#binderPockets').getAttribute('aria-busy'),null);
    check('no identification or grading calls before confirmation',scanRequests,[]);
    check('no shipped-page browser errors',errors,[]);
    await page.close();
  }
  console.log(`SUITE COMPLETE: binder-interaction-browser: ${checks} passed, 0 failed`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
