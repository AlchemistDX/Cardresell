import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
let html=await readFile(new URL('index.html',root),'utf8');
for(const name of ['draft-batch','collection-drafts']){
  const source=await readFile(new URL(`js/${name}.js`,root));
  const path=`js/${name}.${createHash('sha256').update(source).digest('hex').slice(0,8)}.js`;
  const pattern=new RegExp(`js/${name}\\.[a-f0-9]{8}\\.js`,'g');
  if([...html.matchAll(pattern)].length!==1)throw Error('Expected one '+name+' asset');
  await writeFile(new URL(path,root),source);html=html.replace(pattern,path);console.log(path);
}
await writeFile(new URL('index.html',root),html);
