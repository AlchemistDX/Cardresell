// Isolated local Chromium score-loop benchmark, not phone or scan latency.
// No provider requests, image uploads, or customer credits.
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {resolveCoreBundle} from '../tests/_assetRefs.mjs';
const current=resolveCoreBundle();
const baseline='js/core.dea40438.js';
const extract=s=>s.match(/  function hamming\(a, b\) \{[\s\S]*?\n  \}/)?.[0];
const before=extract(readFileSync(new URL('../'+baseline,import.meta.url),'utf8'));
const after=extract(readFileSync(current.path,'utf8'));
if(!before||!after)throw Error('Expected both shipped distance functions');
const rows=['card-index.json','mtg-index.json'].flatMap(p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url))));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 const result=await page.evaluate(({before,after,rows})=>{
  const functions=[Function('return ('+before+')')(),Function('return ('+after+')')()];
  const probes=[rows[0],rows[Math.floor(rows.length/2)],rows.at(-1)];
  const run=fn=>{let checksum=0;for(let i=0;i<probes.length;i++){const q=probes[i],raw=probes[(i+1)%probes.length];for(const c of rows)checksum+=Math.min(fn(q.p,c.p)*2+fn(q.d,c.d),fn(raw.p,c.p)*2+fn(raw.d,c.d))}return checksum};
  const sums=functions.map(run);if(sums[0]!==sums[1])throw Error('Score checksum changed');
  const samples=[[],[]];
  for(let round=0;round<7;round++)for(const i of round%2?[1,0]:[0,1]){
   const start=performance.now(),sum=run(functions[i]);
   samples[i].push(performance.now()-start);if(sum!==sums[0])throw Error('Unstable score checksum');
  }
  const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
  return {records:rows.length,probes:probes.length,comparisonsPerSample:rows.length*probes.length*4,checksum:sums[0],beforeMs:samples[0],afterMs:samples[1],beforeMedianMs:median(samples[0]),afterMedianMs:median(samples[1]),reductionPercent:100*(1-median(samples[1])/median(samples[0]))};
 },{before,after,rows});
 console.log(JSON.stringify({scope:'local_headless_chromium_score_loop_not_end_to_end_scan',browser:browser.version(),baseline,current:current.rel,...result},null,2));
}finally{await browser.close()}
