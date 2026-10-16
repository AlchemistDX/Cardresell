import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),source=await readFile(new URL('js/collection-import.js',root));
const path='js/collection-import.'+createHash('sha256').update(source).digest('hex').slice(0,8)+'.js';
const html=await readFile(new URL('index.html',root),'utf8'),pattern=/js\/collection-import\.[a-f0-9]{8}\.js/g;
if([...html.matchAll(pattern)].length!==1)throw Error('Expected one collection import asset');
await writeFile(new URL(path,root),source);
await writeFile(new URL('index.html',root),html.replace(pattern,path));
console.log(path);
