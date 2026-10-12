// Local, deterministic catalog evidence. Never advances a fee verification date.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const check=process.argv.includes('--check');
const summary={version:1,scope:'Local image-reference indexes; not complete catalog coverage or measured recognition accuracy.',indexes:{}};
for(const [game,path] of [['pokemon','card-index.json'],['mtg','mtg-index.json']]){
  const bytes=await readFile(new URL(path,root)),rows=JSON.parse(bytes);
  if(!Array.isArray(rows)||!rows.length||rows.some(r=>!r||typeof r.id!=='string'||!r.id||typeof r.si!=='string'||!r.si))throw Error(`Invalid ${game} index`);
  const uniqueIds=new Set(rows.map(r=>r.id));
  if(uniqueIds.size!==rows.length)throw Error(`Duplicate ${game} printing IDs`);
  summary.indexes[game]={records:rows.length,representedSets:new Set(rows.map(r=>r.si.toLowerCase())).size,
    source:path,sha256:createHash('sha256').update(bytes).digest('hex')};
}
const manifest=JSON.stringify(summary,null,2)+'\n';
let html=await readFile(new URL('accuracy.html',root),'utf8');
for(const [key,value] of [
  ['pokemon-records',summary.indexes.pokemon.records],
  ['pokemon-sets',summary.indexes.pokemon.representedSets],
]){
  const re=new RegExp(`(<div class="stat-num" data-catalog-stat="${key}">)[^<]*(</div>)`,'g');
  if([...html.matchAll(re)].length!==1)throw Error(`Missing or duplicate catalog stat marker: ${key}`);
  html=html.replace(re,(_,a,b)=>a+value.toLocaleString('en-US')+b);
}
const outputs=[['data/catalog-stats.json',manifest],['accuracy.html',html]];
for(const [path,content] of outputs){
  let old;try{old=await readFile(new URL(path,root),'utf8')}catch{}
  if(old===content)continue;
  if(check)throw Error(`${path} is stale. Run node tools/sync-catalog-stats.mjs and review the changes.`);
  await writeFile(new URL(path,root),content);
}
console.log(`Catalog evidence ${check?'verified':'updated'}: Pokémon ${summary.indexes.pokemon.records}/${summary.indexes.pokemon.representedSets} sets; Magic ${summary.indexes.mtg.records}/${summary.indexes.mtg.representedSets} sets.`);
