/**
 * Reassemble the logical index.html document.
 *
 * As of the SOL-PLAT-007 asset extraction, index.html no longer contains the
 * application CSS/JS inline — it references hashed files under /js and /css.
 * The application's LOGIC did not change, only its physical file layout, so
 * every existing regression assertion is still valid against the reassembled
 * document. This helper inlines those external assets back into the markup at
 * the exact position of their <script>/<link> tag, which is also their real
 * execution order, so tests keep asserting on the same logical source they
 * always did.
 *
 * Use this instead of reading index.html directly in any test that inspects
 * application JS or CSS.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readAppSource(file = 'index.html') {
  const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
  let src = fs.readFileSync(p, 'utf8');

  // <script defer src="/js/x.hash.js"></script> and
  // <script type="module" src="/js/auth.hash.js"></script>
  src = src.replace(
    /<script([^>]*?)\ssrc="\/(js\/[A-Za-z0-9_.-]+\.js)"([^>]*)><\/script>/g,
    (m, pre, rel, post) => {
      const f = path.join(ROOT, rel);
      if (!fs.existsSync(f)) return m;
      const body = fs.readFileSync(f, 'utf8');
      // Preserve type="module" so module-vs-classic assertions still hold;
      // drop defer/src since they are meaningless on an inline block.
      const isModule = /type\s*=\s*["']module["']/.test(pre + post);
      return `<script${isModule ? ' type="module"' : ''}>${body}</script>`;
    }
  );

  // <link rel="stylesheet" href="/css/app.hash.css">
  src = src.replace(
    /<link\s+rel="stylesheet"\s+href="\/(css\/[A-Za-z0-9_.-]+\.css)"\s*\/?>/g,
    (m, rel) => {
      const f = path.join(ROOT, rel);
      if (!fs.existsSync(f)) return m;
      return `<style>${fs.readFileSync(f, 'utf8')}</style>`;
    }
  );

  return src;
}

module.exports = { readAppSource, ROOT };
