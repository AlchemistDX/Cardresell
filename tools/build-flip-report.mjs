import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),source=await readFile(new URL('js/flip-report.js',root));
const path='js/flip-report.'+createHash('sha256').update(source).digest('hex').slice(0,8)+'.js';
let html=await readFile(new URL('index.html',root),'utf8');
const pattern=/js\/flip-report(?:\.[a-f0-9]{8})?\.js/g;
if([...html.matchAll(pattern)].length!==1)throw Error('Expected one flip report asset');
await writeFile(new URL(path,root),source);await writeFile(new URL('index.html',root),html.replace(pattern,path));console.log(path);
