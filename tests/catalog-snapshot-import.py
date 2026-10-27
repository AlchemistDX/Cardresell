#!/usr/bin/env python3
"""Provider-boundary checks for the catalog importer; no public requests."""
import importlib.util,pathlib,tempfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('catalog',ROOT/'tools/build-search-catalogs.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
checks=0
def check(value):
 global checks
 assert value;checks+=1
for d in [{'success':True,'errors':[],'results':[{'productId':1}],'totalItems':2},{'success':False,'errors':['offline'],'results':[]},{'success':True,'errors':[],'results':'oops'}]:
 try:m.envelope(d);raise AssertionError('accepted malformed/truncated snapshot')
 except ValueError:checks+=1
check(m.envelope({'success':True,'errors':[],'results':[]})==[])
class Fixture:
 def get(self,name,url):
  if name=='onepiece-groups':return {'success':True,'errors':[],'totalItems':2,'results':[{'groupId':1,'categoryId':68,'name':'Alpha'},{'groupId':2,'categoryId':68,'name':'Announced'}]}
  if name=='tcgcsv-68-2-products':return {'success':True,'errors':[],'results':[]}
  def card(i,name,fields):return {'productId':i,'categoryId':68,'groupId':1,'name':name,'extendedData':[{'name':k,'value':v} for k,v in fields.items()],'imageUrl':'https://example.test/image.jpg','imageCount':0}
  rows=[card(1,'DON!!',{'Rarity':'DON!!'}),card(2,'Luffy',{'Number':'OP01-003','Rarity':'L'}),card(3,'Booster Box',{}),card(4,'Puzzle Insert',{'Rarity':'None'}),card(5,'Energy',{'Number':'None','CardType':'Energy'})]
  return {'success':True,'errors':[],'totalItems':len(rows),'results':rows}
d,c=m.tcg_catalog(Fixture(),68,'onepiece','en')
check(len(d['cards'])==3);check(c['empty_groups']==['2']);check(len(c['excluded'])==2);check(all(x[5]=='' for x in d['cards']));check(d['cards'][-1][3]=='')
class WrongGame(Fixture):
 def get(self,name,url):
  d=super().get(name,url)
  if name.endswith('products') and d['results']:d['results'][0]['categoryId']=85
  return d
try:m.tcg_catalog(WrongGame(),68,'onepiece','en');raise AssertionError('accepted wrong game')
except ValueError:checks+=1
# A failure after one game prepared cannot replace the published manifest.
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp);out=root/'out';out.mkdir();(out/'current.json').write_text('{"games":{}}')
 m.tcg_stamp=lambda:'2026-10-26T20:05:56+0000'
 good={'provider':'test','sets':{'s':'Set'},'cards':[['1','Name','s','1','','','en']]}
 def fails(src,cat,game,lang):
  if game=='lorcana':raise ValueError('provider outage')
  return good.copy(),{'scope':'fixture'}
 m.tcg_catalog=fails
 try:m.build(root/'cache','2026-10-26',out);raise AssertionError('accepted partial multi-game build')
 except ValueError:checks+=1
 check((out/'current.json').read_text()=='{"games":{}}')
 check(list(out.iterdir())==[out/'current.json'])
# A complete-looking response cannot silently erase previously searchable IDs.
with tempfile.TemporaryDirectory() as tmp:
 import json
 root=pathlib.Path(tmp);out=root/'out';out.mkdir()
 old={'cards':[['1','Name','s','1','','','en'],['removed','Missing','s','2','','','en']]}
 (out/'onepiece.old.json').write_text(json.dumps(old))
 before=json.dumps({'games':{'onepiece':{'url':'/data/catalog/onepiece.old.json'}}})
 (out/'current.json').write_text(before)
 try:m.build(root/'cache','2026-10-26',out);raise AssertionError('silently removed previous identity')
 except ValueError as e:check('prior identities disappeared' in str(e))
 check((out/'current.json').read_text()==before)
print(f'catalog-snapshot-import: {checks} passed, 0 failed -- SUITE COMPLETE')
