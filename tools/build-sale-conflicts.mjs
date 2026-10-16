import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),source=await readFile(new URL('js/sale-conflicts.js',root));
const path='js/sale-conflicts.'+createHash('sha256').update(source).digest('hex').slice(0,8)+'.js';
let html=await readFile(new URL('index.html',root),'utf8');
const pattern=/js\/sale-conflicts\.[a-f0-9]{8}\.js/g;
if(pattern.test(html))html=html.replace(pattern,path);
else html=html.replace(/(<script defer src="\/js\/flip-report\.[a-f0-9]{8}\.js"><\/script>)/,`$1\n<script defer src="/${path}"></script>`);
await writeFile(new URL(path,root),source);await writeFile(new URL('index.html',root),html);console.log(path);
