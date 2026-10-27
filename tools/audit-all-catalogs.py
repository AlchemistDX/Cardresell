#!/usr/bin/env python3
"""Audit every supported game without equating a provider feed to all printed cards.
Consumes the immutable source snapshots used by build-search-catalogs.py.
"""
import argparse,collections,hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
def audit(cache, catalog, as_of):
 def read(name): return json.loads((cache/(name+'.json')).read_text())
 result={'as_of':as_of,'claim':'Coverage is relative to named source snapshots, not a certification of all printings or scanner recognition.','games':{}}
 manifest=json.loads((catalog/'current.json').read_text()); build=json.loads((catalog/'coverage.json').read_text())
 for game,meta in manifest['games'].items():
  path=ROOT/meta['url'].lstrip('/') if catalog==ROOT/'data/catalog' else catalog/pathlib.Path(meta['url']).name
  raw=path.read_bytes();data=json.loads(raw)
  assert len(data['cards'])==meta['count'] and len({c[0] for c in data['cards']})==meta['count']
  assert hashlib.sha256(raw).hexdigest()==build['games'][game]['asset_sha256']
  result['games'][game]={'searchable_records':meta['count'],'provider':meta['provider'],'represented_sets':build['games'][game]['represented_sets'],'scope':build['games'][game]['scope'],'full_physical_catalog_verified':False}
  for key in ['set_count_mismatches','empty_groups','provider_groups','groups_checked','provider_card_identities','identity_only_records','excluded_pocket_cards','excluded_pocket_sets','supplemental_native_records','native_scope']:
   if key in build['games'][game]:result['games'][game][key]=build['games'][game][key]
 for game,filename,snapshot in [('pokemon','card-index.json','pokemon-primary-sets'),('mtg','mtg-index.json','mtg-sets')]:
  local=json.loads((ROOT/filename).read_text()); counts=collections.Counter(c.get('si') for c in local)
  sets=read(snapshot); sets=sets if isinstance(sets,list) else sets['data']
  released=[s for s in sets if (s.get('releaseDate') or s.get('released_at') or '9999').replace('/','-')<=as_of and not s.get('digital')]
  missing=[{'id':s.get('code',s['id']),'name':s['name'],'provider_count':s.get('card_count',s.get('total'))} for s in released if not counts[s.get('code',s['id'])]]
  g=result['games'].setdefault(game,{'provider':'Scryfall','full_physical_catalog_verified':False,'scope':'Live paper printing search with pagination; English by default. Includes variations/extras. Not a local complete catalog.'})
  g.update(local_visual_references=len(local),local_reference_sets=len(counts),released_provider_sets=len(released),sets_without_local_visual_references=missing)
  if game=='mtg':g['live_paper_printing_count']=read('mtg-paper-count')['total_cards']
 jp=read('pokemonjp-cards');counts=collections.Counter(c['id'].rsplit('-',1)[0] for c in jp)
 result['games']['pokemonjp']['secondary_tcgdex_set_count_mismatches']=[{'id':s['id'],'name':s['name'],'declared':s['cardCount']['total'],'returned':counts[s['id']]} for s in read('pokemonjp-sets') if s['cardCount']['total']!=counts[s['id']]]
 result['games']['sports']={'full_physical_catalog_verified':False,'scope':'PriceCharting/SportsCardsPro and research searches; no enumerated manufacturer/year/set/parallel checklist. Search results cannot prove complete catalog coverage.'}
 result['games']['other']={'full_physical_catalog_verified':False,'scope':'Manual-entry workflow; no live full catalog.'}
 result['scan_limits']='Ximilar recognition coverage is separate from searchable metadata and local image hashes. No provider-wide recognition benchmark was run.'
 result['refresh']='Reviewable snapshot builder; updater is not a confirmed daily production job. Refresh and deploy together after verification.'
 return result
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=pathlib.Path,required=True);p.add_argument('--catalog',type=pathlib.Path,default=ROOT/'data/catalog');p.add_argument('--as-of',required=True);p.add_argument('--report',type=pathlib.Path,required=True);a=p.parse_args();r=audit(a.cache,a.catalog,a.as_of);a.report.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({g:{k:v for k,v in d.items() if k in ['searchable_records','local_visual_references','live_paper_printing_count','full_physical_catalog_verified']} for g,d in r['games'].items()},indent=2))
