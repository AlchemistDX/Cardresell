// Run after a reviewed catalog import, before publishing its data and HTML.
// New URLs bypass a previously cached index; the core bundle stays immutable.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 8);
let html = await readFile(new URL('index.html', root), 'utf8');
const current = html.match(/src="\/(js\/core\.[a-f0-9]{8}\.js)"/)?.[1];
if (!current) throw Error('Active core asset not found');
let source = await readFile(new URL(current, root), 'utf8');
for (const name of ['card-index', 'mtg-index', 'pokemon-local-metadata']) {
  const bytes = await readFile(new URL(`${name}.json`, root));
  const version = hash(bytes);
  const pattern = new RegExp(`url: '/${name}\\.json(?:\\?v=[a-f0-9]{8})?'`, 'g');
  if ([...source.matchAll(pattern)].length !== 1) throw Error(`Expected one ${name} shard URL`);
  source = source.replace(pattern, `url: '/${name}.json?v=${version}'`);
  console.log(`${name}: ${JSON.parse(bytes).length} records, version ${version}`);
}
const next = `js/core.${hash(source)}.js`;
await writeFile(new URL(next, root), source);
await writeFile(new URL('index.html', root), html.replace(`src="/${current}"`, `src="/${next}"`));
console.log(`Active bundle: ${next}`);
