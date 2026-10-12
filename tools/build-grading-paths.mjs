import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
let html = await readFile(new URL('index.html', root), 'utf8');
for (const ext of ['js', 'css']) {
  const source = await readFile(new URL(`${ext}/grading-paths.${ext}`, root));
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
  const path = `${ext}/grading-paths.${hash}.${ext}`;
  await writeFile(new URL(path, root), source);
  const pattern = new RegExp(`${ext}/grading-paths\\.[a-f0-9]{8}\\.${ext}`, 'g');
  if ([...html.matchAll(pattern)].length !== 1) throw Error('Expected one grading-paths asset reference: ' + ext);
  html = html.replace(pattern, path);
  console.log(path);
}
await writeFile(new URL('index.html', root), html);
