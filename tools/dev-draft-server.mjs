// tools/dev-draft-server.mjs — LOCAL ONLY. Never imported by the app.
//
// Serves the repo statically AND mounts the REAL api/drafts.js handler, so a
// draft created from the actual popup goes through the actual server:
// signature-verified token, real validation ladder, real idempotency store.
//
// Nothing here is stubbed except the two things the sandbox cannot reach:
//   * Google's JWKS endpoint — replaced with a keypair minted here, so
//     _verifyToken.js still performs a real RS256 signature verification.
//   * Upstash REST — replaced with an in-memory map speaking the same
//     path-style protocol makeKv() uses.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto as wc } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.DEV_PORT || 8100);
const PROJECT_ID = 'cardresell-e0329';
const KV_URL = 'https://kv.dev.invalid';

process.env.KV_REST_API_URL = KV_URL;
process.env.KV_REST_API_TOKEN = 'dev-token';

// ── signing key + JWKS ────────────────────────────────────────────────────
const kp = await wc.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const pubJwk = await wc.subtle.exportKey('jwk', kp.publicKey);
const KID = 'devkid';
const JWKS = { keys: [{ ...pubJwk, kid: KID, alg: 'RS256', use: 'sig' }] };

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function mintToken(sub, email, emailVerified) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID,
    sub, user_id: sub, auth_time: now, iat: now, exp: now + 3600,
    email, email_verified: emailVerified, firebase: { sign_in_provider: 'password' },
  };
  const signing = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = await wc.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, Buffer.from(signing));
  return `${signing}.${b64u(sig)}`;
}

// ── in-memory Upstash over the same REST shape makeKv() speaks ────────────
const store = new Map();
export const kvLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input?.url || input);
  if (url.includes('securetoken@system.gserviceaccount.com')) {
    return new Response(JSON.stringify(JWKS), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.startsWith(KV_URL)) {
    const parts = url.slice(KV_URL.length + 1).split('/').map(decodeURIComponent);
    const [cmd, key, ...rest] = parts;
    kvLog.push(parts.slice(0, 2).join(' '));
    let result = null;
    // EVAL. The lifecycle lock, its fence allocation and every fenced write go
    // through a script, so a store double without `eval` cannot create a draft
    // at all -- it refuses with 'lock-unavailable', which reads like a broken
    // screen rather than a missing command. Same implementation the suites use
    // (tests/_kvScripts.mjs), so the dev server and the suites cannot drift
    // into agreeing with two different script semantics.
    //
    // NOT CLAIMED: `setEx` here ignores its TTL, exactly as the suite double
    // does, and `expire` below returns 1 without recording anything. A lock
    // therefore never lapses on its own in this server. Lock EXPIRY is not
    // testable here and is not tested here.
    if (cmd === 'eval') {
      result = evalScript({
        get: (k) => (store.has(k) ? store.get(k) : null),
        set: (k, v) => { store.set(k, v); },
        del: (k) => { store.delete(k); },
        setEx: (k, v) => { store.set(k, v); },
      }, [key, ...rest]);
    }
    else if (cmd === 'get') result = store.has(key) ? store.get(key) : null;
    else if (cmd === 'set') {
      // NX has to be honoured, not ignored. The quota seed is a SET .. NX and
      // an unconditional write turns "seed once" into "reseed on every
      // create", which would hide a cap that had stopped counting.
      const flags = rest.slice(1).map((f) => String(f).toUpperCase());
      if (flags.includes('NX') && store.has(key)) result = null;
      else if (flags.includes('XX') && !store.has(key)) result = null;
      else { store.set(key, rest[0]); result = 'OK'; }
    }
    else if (cmd === 'del') { result = store.delete(key) ? 1 : 0; }
    else if (cmd === 'expire') result = 1;
    else if (cmd === 'incr') { const n = Number(store.get(key) || 0) + 1; store.set(key, String(n)); result = n; }
    // DECR and SCARD were missing, and their absence was not loud: this shim
    // answers 200 with result:null for a command it does not know, so
    // `releaseDraftSlot` "succeeded" every time without decrementing anything
    // and the quota counter only ever climbed. A quota assertion written
    // against that would have been measuring the double, not the product.
    else if (cmd === 'decr') { const n = Number(store.get(key) || 0) - 1; store.set(key, String(n)); result = n; }
    else if (cmd === 'exists') result = store.has(key) ? 1 : 0;
    else if (cmd === 'scard') { const s = store.get(key); result = s instanceof Set ? s.size : 0; }
    else if (cmd === 'sismember') { const s = store.get(key); result = s instanceof Set && s.has(rest[0]) ? 1 : 0; }
    else if (cmd === 'lpush') { const l = Array.isArray(store.get(key)) ? store.get(key) : []; store.set(key, l); l.unshift(...rest); result = l.length; }
    else if (cmd === 'ltrim') { const l = Array.isArray(store.get(key)) ? store.get(key) : []; store.set(key, l.slice(Number(rest[0]), Number(rest[1]) + 1 || undefined)); result = 'OK'; }
    else if (cmd === 'scan') { result = ['0', [...store.keys()]]; }
    else if (cmd === 'sadd' || cmd === 'srem' || cmd === 'smembers') {
      const s = store.get(key) instanceof Set ? store.get(key) : new Set();
      store.set(key, s);
      if (cmd === 'sadd') { rest.forEach(v => s.add(v)); result = rest.length; }
      else if (cmd === 'srem') { rest.forEach(v => s.delete(v)); result = rest.length; }
      else result = [...s];
    }
    else {
      // Anything still unknown must FAIL rather than answer null. A silent
      // null is the bug: it is indistinguishable from a missing key, and every
      // caller that separates "absent" from "unreadable" rests on kv throwing.
      return new Response(JSON.stringify({ error: 'dev-kv: unimplemented command ' + cmd }),
        { status: 501, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ result }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};

const { evalScript } = await import('../tests/_kvScripts.mjs');
const draftsHandler = (await import('../api/drafts.js')).default;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function shim(req, res, body, query) {
  const vres = {
    statusCode: 200, _headers: {}, _body: null,
    setHeader(k, v) { this._headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this._body = JSON.stringify(o); this.finish('application/json'); return this; },
    send(o) { this._body = typeof o === 'string' ? o : JSON.stringify(o); this.finish('application/json'); return this; },
    end() { this.finish('text/plain'); return this; },
    finish(ct) {
      if (res.writableEnded) return;
      res.writeHead(this.statusCode, { ...this._headers, 'content-type': this._headers['content-type'] || ct });
      res.end(this._body || '');
    },
  };
  const vreq = { method: req.method, headers: req.headers, body, query: query || {}, url: req.url };
  return { vreq, vres };
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/__devtoken') {
    const t = await mintToken(u.searchParams.get('sub') || 'dev-seller-1',
      u.searchParams.get('email') || 'will@example.test',
      u.searchParams.get('verified') !== '0');
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({ token: t }));
  }
  if (u.pathname === '/__kvdump') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ keys: [...store.keys()], commands: kvLog.length }));
  }
  // Simulate the crash window: drop specific KV rows (e.g. the idempotency
  // RESULT record while leaving the RESOURCE pointer intact) so a retry has to
  // recover rather than replay. Prefix match, dev harness only.
  if (u.pathname === '/__kvdel') {
    const pre = u.searchParams.get('prefix') || '';
    const hit = [...store.keys()].filter((k) => k.startsWith(pre));
    hit.forEach((k) => store.delete(k));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ deleted: hit }));
  }
  if (u.pathname === '/__kvget') {
    const pre = u.searchParams.get('prefix') || '';
    const out = {};
    for (const [k, v] of store) if (k.startsWith(pre)) out[k] = String(v).slice(0, 300);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(out));
  }
  if (u.pathname === '/api/drafts' || u.pathname.startsWith('/api/drafts/')) {
    let raw = '';
    for await (const c of req) raw += c;
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    const query = Object.fromEntries(u.searchParams.entries());
    const tail = u.pathname.replace(/^\/api\/drafts\/?/, '');
    if (tail) query.id = tail;
    const { vreq, vres } = shim(req, res, body, query);
    try { await draftsHandler(vreq, vres); }
    catch (e) { if (!res.writableEnded) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e), where: 'dev-server' })); } }
    return;
  }
  if (u.pathname.startsWith('/api/')) {
    // Generic mount: /api/<name> -> api/<name>.js, so the popup's own
    // eligibility round trip runs the real handler too.
    const name = u.pathname.slice(5).split('/')[0];
    const file = path.join(ROOT, 'api', name + '.js');
    if (/^[a-z0-9-]+$/i.test(name) && fs.existsSync(file)) {
      let raw = '';
      for await (const c of req) raw += c;
      let body = {};
      if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
      const query = Object.fromEntries(u.searchParams.entries());
      const { vreq, vres } = shim(req, res, body, query);
      try {
        const mod = await import(pathToFileURL(file).href);
        await mod.default(vreq, vres);
      } catch (e) {
        if (!res.writableEnded) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message || e), where: 'dev-server:' + name })); }
      }
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not mounted in dev server', route: name }));
  }
  let p = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log('dev-draft-server on ' + PORT));
