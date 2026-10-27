// Version only after a complete reviewed build. Old immutable assets stay on disk.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root = new URL('../',import.meta.url);
const digest = s => createHash('sha256').update(s).digest('hex');
const manifest = await readFile(new URL('data/catalog/current.json',root));
const url = '/data/catalog/manifest.'+digest(manifest).slice(0,12)+'.json';
if (!(await readFile(new URL(url.slice(1),root))).equals(manifest)) throw Error('Manifest hash mismatch');
let source = await readFile(new URL('js/search-catalog.js',root),'utf8');
source = source.replace(/const MANIFEST = '[^']+';/, `const MANIFEST = '${url}';`);
await writeFile(new URL('js/search-catalog.js',root),source);
const modulePath='js/search-catalog.'+digest(source).slice(0,8)+'.js';
await writeFile(new URL(modulePath,root),source);
let html = await readFile(new URL('index.html',root),'utf8');
if (/src="\/js\/search-catalog\.[a-f0-9]{8}\.js"/.test(html)) html=html.replace(/js\/search-catalog\.[a-f0-9]{8}\.js/,modulePath);
else html=html.replace(/(<script defer src="\/js\/core\.[a-f0-9]{8}\.js"><\/script>)/,`<script defer src="/${modulePath}"></script>\n$1`);
await writeFile(new URL('index.html',root),html);
console.log(modulePath,url);

let accuracy = await readFile(new URL('accuracy.html',root),'utf8');
for (const [game,meta] of Object.entries(JSON.parse(manifest).games)) {
  accuracy = accuracy.replace(new RegExp('(data-catalog-count="'+game+'">)[^<]*'), '$1'+meta.count.toLocaleString('en-US'));
}
await writeFile(new URL('accuracy.html',root),accuracy);
