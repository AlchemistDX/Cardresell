import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),source=await readFile(new URL('js/ebay-listing-operations.js',root));
const path='js/ebay-listing-operations.'+createHash('sha256').update(source).digest('hex').slice(0,8)+'.js';
let html=await readFile(new URL('index.html',root),'utf8');
const pattern=/js\/ebay-listing-operations(?:\.[a-f0-9]{8})?\.js/g;
if([...html.matchAll(pattern)].length!==1)throw Error('Expected one eBay operations asset');
await writeFile(new URL(path,root),source);await writeFile(new URL('index.html',root),html.replace(pattern,path));console.log(path);
