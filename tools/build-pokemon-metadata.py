#!/usr/bin/env python3
"""Rebuild identity-only local records for historic image gaps from primary data.
No image hashes, images or prices are invented; these records are search-only.
"""
import argparse,hashlib,json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE='https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/'
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--cache',type=Path,required=True);p.add_argument('--as-of',required=True)
a=p.parse_args();a.cache.mkdir(parents=True,exist_ok=True)
def fetch(path):
 url=BASE+path;cache=a.cache/hashlib.sha256(url.encode()).hexdigest()
 if cache.exists():raw=cache.read_bytes()
 else:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'CardResell-Catalog/1.0'}),timeout=25) as response:raw=response.read()
  cache.write_bytes(raw)
 return json.loads(raw),{'url':url,'sha256':hashlib.sha256(raw).hexdigest()}
sets,sets_proof=fetch('sets/en.json');sets={s['id']:s for s in sets}
existing={c['id'] for c in json.loads((ROOT/'card-index.json').read_text())}
rows=[];proof=[]
for sid in ['hsp','mcd14','mcd15','mcd17','mcd18']:
 meta=sets[sid];assert meta['releaseDate'].replace('/','-')<=a.as_of
 cards,source=fetch('cards/en/'+sid+'.json')
 assert len({c['id'] for c in cards})==len(cards)
 assert len(cards)>=meta['total'],(sid,len(cards),meta['total'])
 ids=[]
 for c in cards:
  assert c['id'].startswith(sid+'-') and c['name'] and c['number']
  if c['id'] in existing:continue
  rows.append({'id':c['id'],'n':c['name'],'s':meta['name'],'si':sid,'nu':c['number'],'r':c.get('rarity',''),'g':'pokemon','i':''})
  existing.add(c['id']);ids.append(c['id'])
 proof.append({'set':sid,'name':meta['name'],'records':ids,'provider_count':len(cards),'source':source})
 print(sid,len(ids),flush=True)
(ROOT/'pokemon-local-metadata.json').write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')))
(ROOT/'data/pokemon-metadata-20261009.json').write_text(json.dumps({'as_of':a.as_of,'scope':'Historical identity-only records from primary repository; no reference images, hashes or live prices','sets_source':sets_proof,'sets':proof},indent=2))
print('Total search-only records:',len(rows))
