// Preserve the site's inline-CSS and immutable content-addressed JS contract.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('js/membership-shop.js', root));
const digest = createHash('sha256').update(source).digest('hex').slice(0, 8);
await writeFile(new URL(`js/membership-shop.${digest}.js`, root), source);
const css = await readFile(new URL('css/membership-shop.css', root), 'utf8');
let html = await readFile(new URL('index.html', root), 'utf8');
html = html.replace(/<link rel="stylesheet" href="\/css\/membership-shop.css">|<style id="membership-shop-styles">[\s\S]*?<\/style>/,
  `<style id="membership-shop-styles">\n${css}</style>`);
html = html.replace(/src="\/js\/membership-shop(?:\.[a-f0-9]{8})?\.js"/,
  `src="/js/membership-shop.${digest}.js"`);
await writeFile(new URL('index.html', root), html);
console.log(`Membership shop asset: ${digest}`);
