import { randomUUID } from 'node:crypto';
import { verifyTokenFlexible } from './_verifyToken.js';
import { scrydexRequest, normalizeScrydexResponse } from './_scrydexContract.js';
import { scrydexConfig, scrydexKeys, scrydexKv, RESERVE, COMPLETE } from './_scrydexBudget.js';

// Default-off pilot. No browser or scan path is switched by deploying this file.
export function createPokemonProviderHandler({ env = process.env, verify = verifyTokenFlexible,
  kv: injectedKv, fetchFn = fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    const fail = (status, reason) => res.status(status).json({ error: 'Pokémon lookup unavailable', reason });
    if (req.method !== 'GET') return fail(405, 'method');
    let config;
    try { config = scrydexConfig(env, now()); } catch { return fail(503, 'configuration'); }
    if (!config) return fail(503, 'disabled');
    let uid;
    try {
      const token = /^Bearer (\S+)$/i.exec(req.headers?.authorization || '')?.[1];
      if (!token) return fail(401, 'sign_in');
      const account = await verify(token);
      uid = account?.uid;
      if (!uid || uid.startsWith('ktest-') || account.emailVerified !== true) return fail(401, 'verified_account_required');
    } catch { return fail(401, 'sign_in'); }
    if (!config.users.includes(uid)) return fail(403, 'pilot_access');
    let request;
    try { request = scrydexRequest(req.query); } catch { return fail(400, 'invalid_query'); }
    if (request.prices && !config.prices) return fail(403, 'prices_disabled');
    const kv = injectedKv || scrydexKv(env);
    if (!kv) return fail(503, 'storage');
    const keys = scrydexKeys(config, request, uid, now()), token = randomUUID();
    let reservation;
    try {
      reservation = await kv('EVAL', RESERVE, 5, keys.cache, keys.lock, keys.budget, keys.user, keys.cooldown,
        token, config.cap, config.userCap, config.start, config.end);
      if (!Array.isArray(reservation)) throw new Error('Invalid reservation');
      if (reservation[0] === 'cache') {
        const cached = JSON.parse(reservation[1]);
        if (cached.provider !== 'scrydex' || !Array.isArray(cached.data)) throw new Error('Invalid cache');
        return res.status(200).json({ ...cached, cached: true });
      }
    } catch { return fail(503, 'storage'); }
    if (reservation[0] !== 'reserved') {
      if (['busy','cooldown','user'].includes(reservation[0])) res.setHeader('Retry-After', reservation[0] === 'busy' ? '2' : '60');
      return fail(reservation[0] === 'user' ? 429 : 503, reservation[0]);
    }
    let result = null, status = 502, reason = 'upstream';
    try {
      // Deadline includes the response body; redirects never receive credentials.
      const response = await fetchFn(request.url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'X-Api-Key': config.apiKey, 'X-Team-ID': config.team, Accept: 'application/json' } });
      if (!response.ok) {
        if ([401,403,429].includes(response.status) || response.status >= 500) {
          await kv('SET', keys.cooldown, '1', 'EX', response.status === 429 ? 300 : 60);
        }
        await response.body?.cancel();
        status = response.status === 404 ? 404 : 502;
        reason = response.status === 404 ? 'not_found' : 'upstream';
      } else {
        if (!response.body) throw new Error('Empty response');
        const reader = response.body.getReader(), chunks = [];
        let bytes = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Response too large'); }
          chunks.push(Buffer.from(part.value));
        }
        result = normalizeScrydexResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')), request, now());
      }
    } catch { reason = 'upstream'; }
    try {
      // A failed cache write must not cause a second paid call in this request.
      await kv('EVAL', COMPLETE, 2, keys.lock, keys.cache, token, result ? JSON.stringify(result) : '', 86400);
    } catch { /* The allowance was already consumed; the lock expires safely. */ }
    return result ? res.status(200).json({ ...result, cached: false }) : fail(status, reason);
  };
}
export default createPokemonProviderHandler();
