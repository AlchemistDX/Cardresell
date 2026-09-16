// Temporary protected Preview worker. No authentication bypass or billing changes.
import { STAGE2_PATH, STAGE2_END, stage2Guard } from './_previewIdStage2.js';
export const STAGE2_WORKER_PATH = '/api/preview-id-authenticated-worker';
function runtime(config) {
  const target = self.location.origin + '/api/scan-debit-id';
  const endpoint = self.location.origin + config.page;
  const hex = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
  const live = () => Date.now() < config.end;
  async function boundedFetch(request, options = {}, milliseconds = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), milliseconds);
    const originalSignal = request instanceof Request ? request.signal : null;
    const abort = () => controller.abort();
    if (originalSignal?.aborted) abort();
    originalSignal?.addEventListener('abort', abort, { once: true });
    try { return await fetch(request, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); originalSignal?.removeEventListener('abort', abort); }
  }
  async function boundedText(response) {
    const reader = response.body.getReader(), chunks = [];
    let timer, complete = false, length = 0;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('body_timeout')), 15000); });
    try {
      return await Promise.race([deadline, (async () => {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > 16384) throw Error('body_limit');
          chunks.push(next.value);
        }
        complete = true;
        const bytes = new Uint8Array(length); let offset = 0;
        for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
        return new TextDecoder().decode(bytes);
      })()]);
    } finally {
      clearTimeout(timer);
      if (!complete) reader.cancel().catch(() => {});
    }
  }
  // Only noncredential synthetic binding/state. Original Request/token is
  // never put into IndexedDB, CacheStorage, messages or proof output.
  function open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('cardresell_preview_id_loss_v1', 1);
      let expired = false;
      const timer = setTimeout(() => {
        expired = true; reject(Error('storage_unavailable'));
      }, 8000);
      r.onupgradeneeded = () => r.result.createObjectStore('state');
      r.onsuccess = () => { clearTimeout(timer); expired ? r.result.close() : resolve(r.result); };
      r.onerror = () => { clearTimeout(timer); reject(Error('storage_unavailable')); };
    });
  }
  async function state(transform) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', transform ? 'readwrite' : 'readonly');
      const timer = setTimeout(() => { try { tx.abort(); } catch (_) {} }, 8000);
      const store = tx.objectStore('state'), get = store.get('binding');
      let result = null;
      get.onsuccess = () => {
        result = get.result || null;
        if (transform) {
          try { result = transform(result); if (result) store.put(result, 'binding'); }
          catch (_) { tx.abort(); }
        }
      };
      tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(result); };
      tx.onerror = tx.onabort = () => { clearTimeout(timer); db.close(); reject(Error('storage_unavailable')); };
    });
  }
  function valid(b) {
    return b && typeof b.clientId === 'string' && b.clientId.length <= 128
      && typeof b.parentId === 'string' && b.parentId.length <= 128
      && hex(b.receipt) && hex(b.scan) && hex(b.candidateSet) && b.expires === config.end
      && ['armed','attempted','suppressed','retry_observed','unknown','disarmed'].includes(b.stage);
  }
  async function notify(clientId, phase) {
    const c = await self.clients.get(clientId);
    c?.postMessage({ type: 'stage2-loss-observation', phase });
  }
  self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
  self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
  self.addEventListener('message', e => {
    // srcdoc WindowClient.url is empty in observed Chromium; never infer a
    // fabricated URL. Scope and actual nested client ID establish browser binding.
    if (!e.source || e.source.type !== 'window' || !e.ports[0]) return;
    const port = e.ports[0], reply = value => port.postMessage(value);
    const exactParent = e.origin === self.location.origin
      && e.source.frameType === 'top-level' && e.source.url === endpoint;
    if (e.data?.type === 'stage2-loss-parent' && exactParent && live()) {
      const challenge = crypto.randomUUID();
      e.waitUntil(state(old => {
        if (old && old.stage !== 'linking') throw Error('already_attempted');
        return { stage: 'linking', parentId: e.source.id, challenge };
      }).then(() => reply({ ok: true, challenge }), () => reply({ ok: false })));
      return;
    }
    if (e.data?.type === 'stage2-loss-disarm' && exactParent) {
      e.waitUntil(state(old => {
        return { ...(old || {}), stage: 'disarmed' };
      }).then(() => reply({ ok: true, state: 'disarmed' }), () => reply({ ok: false })));
      return;
    }
    // Observed srcdoc metadata: nested WindowClient, empty URL, origin "null".
    // Only a one-time challenge from the exact controlled parent links it.
    if (e.source.frameType !== 'nested' || !(e.origin === self.location.origin
        || (e.origin === 'null' && e.source.url === ''))) return;
    if (e.data?.type === 'stage2-loss-hello') {
      e.waitUntil((async () => {
        const old = await state(), parent = old?.parentId ? await self.clients.get(old.parentId) : null;
        if (!live() || old?.stage !== 'linking' || e.data.challenge !== old.challenge
            || parent?.url !== endpoint || parent.frameType !== 'top-level') return reply({ ok: false });
        await state(current => {
          if (current?.challenge !== old.challenge || current.stage !== 'linking') throw Error('conflict');
          return { ...current, clientId: e.source.id };
        });
        reply({ ok: true, clientId: e.source.id, nested: true });
      })().catch(() => reply({ ok: false })));
      return;
    }
    if (e.data?.type === 'stage2-loss-arm') {
      const b = e.data.binding;
      if (!live() || !b || !hex(b.receipt) || !hex(b.scan) || !hex(b.candidateSet)
          || b.expires !== config.end || b.clientId !== e.source.id) {
        reply({ ok: false }); return;
      }
      e.waitUntil(state(old => {
        if (old?.stage !== 'linking' || old.clientId !== e.source.id) throw Error('already_attempted');
        return { parentId: old.parentId, clientId: b.clientId, receipt: b.receipt, scan: b.scan,
          candidateSet: b.candidateSet, expires: b.expires, stage: 'armed' };
      }).then(() => reply({ ok: true }), () => reply({ ok: false })));
    } else if (e.data?.type === 'stage2-loss-disarm') {
      e.waitUntil(state(old => {
        if (old?.clientId !== e.source.id) throw Error('wrong_client');
        return { ...old, stage: 'disarmed' };
      })
        .then(() => reply({ ok: true }), () => reply({ ok: false })));
    }
  });
  self.addEventListener('fetch', e => {
    if (!live() || e.request.url !== target || e.request.method !== 'POST') return;
    e.respondWith((async () => {
      let binding;
      try { binding = await state(); } catch (_) { return fetch(e.request); }
      if (!valid(binding) || binding.clientId !== e.clientId
          || !['armed','suppressed'].includes(binding.stage)) return fetch(e.request);
      const parent = await self.clients.get(binding.parentId);
      if (parent?.url !== endpoint || parent.frameType !== 'top-level') return fetch(e.request);
      let requestBody, parsed;
      try {
        requestBody = await boundedText(e.request.clone());
        parsed = JSON.parse(requestBody);
      } catch (_) { return fetch(e.request); }
      if (parsed.confirmation_id !== binding.receipt || parsed.scan_id !== binding.scan
          || parsed.candidate_set !== binding.candidateSet || parsed.mode !== 'identify'
          || parsed.candidate?.set_code !== 'stage2-7') return fetch(e.request);
      const isRetry = binding.stage === 'suppressed';
      let claimedLocally = false;
      try {
        await state(old => {
          if (!valid(old) || old.clientId !== binding.clientId || old.stage !== binding.stage)
            throw Error('state_conflict');
          claimedLocally = true; return { ...old, stage: 'attempted' };
        });
      } catch (_) { return fetch(e.request); }
      if (!claimedLocally) return fetch(e.request);
      const call = async (action, extra = {}) => {
        const r = await boundedFetch(endpoint, {
          method: 'POST', redirect: 'error', cache: 'no-store',
          headers: { 'Content-Type': 'application/json',
            Authorization: e.request.headers.get('Authorization') || '' },
          body: JSON.stringify({ action, clientId: binding.clientId, requestBody, ...extra }),
        });
        const value = JSON.parse(await boundedText(r));
        if (!r.ok || !value.ok) throw Error('proof_unavailable');
        return value;
      };
      const markUnknown = async category => {
        try { await state(old => old?.stage === 'disarmed' ? old : { ...old, stage: 'unknown' }); } catch (_) {}
        try { await call('loss-unknown', { category }); } catch (_) {}
        await notify(binding.clientId, 'UNKNOWN');
      };
      if (!isRetry) {
        try { await call('loss-claim'); }
        catch (_) {
          await markUnknown('claim_unavailable');
          // Unknown claim delivery: no automatic acceptance forward/retry.
          return Response.error();
        }
      }
      let response;
      try { response = await boundedFetch(e.request, {}, 30000); }
      catch (_) { await markUnknown('acceptance_unavailable'); return Response.error(); }
      let responseBody, result;
      try {
        responseBody = await boundedText(response.clone());
        result = JSON.parse(responseBody);
        if (response.status !== 200 || !result?.ok || result.scan_id !== binding.scan
            || result.pickedCard?.set_name !== 'Synthetic Set 7') throw Error();
      } catch (_) { await markUnknown('response_invalid'); return response; }
      try {
        await call(isRetry ? 'loss-retry' : 'loss-commit', { responseBody });
        const local = await state(old => {
          if (!live() || old?.stage === 'disarmed') return old;
          return { ...old, stage: isRetry ? 'retry_observed' : 'suppressed' };
        });
        if (!local || local.stage === 'disarmed' || !live()) return response;
      } catch (_) { await markUnknown('corroboration_unavailable'); return response; }
      await notify(binding.clientId, isRetry ? 'MATCHING_RETRY_RESPONSE_OBSERVED' : 'RESPONSE_SUPPRESSION_SCHEDULED');
      return isRetry ? response : Response.error();
    })());
  });
}
export function stage2WorkerSource() {
  return `(${runtime.toString()})(${JSON.stringify({ page: STAGE2_PATH, end: STAGE2_END })});`;
}
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    stage2Guard(req, STAGE2_WORKER_PATH);
    if (req.method !== 'GET') throw Error();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', STAGE2_PATH);
    res.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'");
    return res.status(200).send(stage2WorkerSource());
  } catch (_) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(404).send('Protected worker unavailable');
  }
}
