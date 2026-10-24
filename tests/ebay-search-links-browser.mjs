// Use the shipped app and rendered links; never open eBay or write user data.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('ebay-search-links-browser');let checks=0;
const check=(ok,message)=>{assert.ok(ok,message);checks++;};
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'};
const server=createServer((req,res)=>{
 const path=resolve(ROOT,'.'+new URL(req.url,'http://localhost').pathname);
 if(!path.startsWith(ROOT+'/')||!existsSync(path)){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');res.end(readFileSync(path));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>!r.request().url().startsWith(origin)||r.request().url().includes('/api/')?r.fulfill({status:204,body:''}):r.continue());
 await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof loadCardUI==='function');
 for(const [game,name,category] of [['pokemon','Mew','183454'],['mtg','Opt','183454'],['yugioh','Dark Magician','183454'],['sports','Example player','261328']]) {
  const links=await page.evaluate(({game,name})=>{
   const card={id:'fixture-'+game,name,game,number:'076/214',setName:'Fixture set'};
   selectedCard=card;loadCardUI(card);updateSellLinks(card);
   return [document.getElementById('ebayListBtn').href,window._platSellUrls.ebay,document.getElementById('slEbayBuy').href];
  },{game,name});
  for(const link of links) {
   const url=new URL(link);
   check(url.hostname==='www.ebay.com'&&url.searchParams.get('_sacat')===category,game+' stays in the correct eBay category');
   check(url.searchParams.get('_nkw').includes(name)&&url.searchParams.get('_nkw').includes('/214'),game+' keeps card identity and collector-number denominator');
   check(url.searchParams.get('LH_Sold')==='1'&&url.searchParams.get('LH_Complete')==='1',game+' opens sold comps');
  }
 }
 const unknown=await page.evaluate(()=>buildEbaySearchUrl('Unknown card','1'));
 check(new URL(unknown).searchParams.get('_sacat')==='0','unknown game does not silently become sports');
 const overrides=await page.evaluate(()=>buildEbaySearchUrl('Mew','76/214',{game:'pokemon',category:'183454',sold:false,graded:'PSA 10'}));
 check(!new URL(overrides).searchParams.has('LH_Sold')&&new URL(overrides).searchParams.get('_nkw').includes('PSA 10'),'active and graded search options remain supported');
 await page.evaluate(()=>{
  localStorage.setItem('cardsell_portfolio',JSON.stringify([{id:'fixture-pokemon',card:'Mew',game:'pokemon',number:'76/214',buyPrice:1,currentValue:2},{id:'fixture-sports',card:'Example player',game:'sports',buyPrice:1,currentValue:2}]));
  renderCollectionView();
 });
 for(const [id,category] of [['fixture-pokemon','183454'],['fixture-sports','261328']]) {
  const link=await page.evaluate(id=>{openCollectionCardDetail(id);return document.getElementById('ccmSellBtn').href;},id);
  check(new URL(link).searchParams.get('_sacat')===category,'saved collection detail preserves '+id+' game');
 }
 check(errors.length===0,'no browser errors: '+errors.join('; '));
}finally{await browser.close();await new Promise(r=>server.close(r));}
finish(checks,0);
