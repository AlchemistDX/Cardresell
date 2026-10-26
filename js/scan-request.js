// Bind retries (including reloads) to the same signed owner and photo request.
// Persist only hashes and random operation IDs, never photos or auth tokens.
window.cardResellScanRequest = async function (url, options) {
  if (url !== '/api/scan' || options?.method !== 'POST') throw Error('Invalid scan request.');
  const user = window._fbAuth?.currentUser;
  if (!user?.uid || typeof user.getIdToken !== 'function') throw Error('Sign in before scanning.');
  const recoverable = message => Object.assign(Error(message), { code: 'SCAN_RECOVERABLE' });
  const controller = new AbortController();
  let stopped = null, rejectStop;
  const interrupted = new Promise((_, reject) => { rejectStop = reject; });
  const stop = error => {
    if (stopped) return;
    stopped = error; controller.abort(); rejectStop(error);
  };
  const cancel = () => { const error = Error('Scan cancelled. Retry the same photo to recover any request already sent.'); error.name = 'AbortError'; stop(error); };
  const current = () => {
    if (stopped) throw stopped;
    if (window._fbAuth?.currentUser !== user) throw Error('Account changed. Reopen the scanner.');
  };
  const body = JSON.parse(options.body);
  delete body.operation_id;
  const photos = body.mode === 'grade' ? 'photos' : 'photo';
  const deadline = setTimeout(() => stop(recoverable('This scan is taking longer than expected. Retry the same ' + photos + ' to recover its result before starting another scan.')), body.mode === 'grade' ? 90000 : 45000);
  const watch = setInterval(() => { if (window._fbAuth?.currentUser !== user) stop(Error('Account changed. Reopen the scanner.')); }, 250);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const request = async () => {
    current();
    const canonical = value => value && typeof value === 'object'
      ? Array.isArray(value) ? value.map(canonical)
        : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const bytes = new TextEncoder().encode(JSON.stringify([user.uid, canonical(body)]));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      value => value.toString(16).padStart(2, '0')).join('');
    current();
    const key = 'cardresell:scan-operation:v1:' + digest;
    let operation;
    try {
      operation = sessionStorage.getItem(key);
      if (operation !== null && !/^[a-f0-9]{64}$/.test(operation)) throw Error();
      if (!operation) {
        operation = Array.from(crypto.getRandomValues(new Uint8Array(32)),
          value => value.toString(16).padStart(2, '0')).join('');
        sessionStorage.setItem(key, operation);
        if (sessionStorage.getItem(key) !== operation) throw Error();
      }
    } catch (_) { throw Error('This browser could not save scan recovery. Enable site storage before scanning.'); }
    const token = await user.getIdToken();
    current();
    const send = auth => fetch(url, { ...options,
      signal: controller.signal,
      headers: { ...options.headers, Authorization: 'Bearer ' + auth },
      body: JSON.stringify({ ...body, operation_id: operation }) });
    let response;
    try {
      response = await send(token);
    } catch (_) {
      current(); // A timeout, account change or cancellation must never retry.
      // 2026-10-10: iPhone Safari reuses a keep-alive connection that went stale
      // while the page sat idle (owner's 18-card binder batch: the first three
      // requests hung and failed; none reached the server). Retry ONCE with the
      // same operation id, so the server replays an existing scan instead of
      // charging again; a scan still in flight answers 202 below.
      try {
        await new Promise(resolve => setTimeout(resolve, 900));
        current();
        const retryToken = await user.getIdToken();
        current();
        response = await send(retryToken);
      } catch (error) {
        current();
        if (/^Account changed/.test(error?.message || '')) throw error;
        throw recoverable('Connection interrupted. Retry this same photo to check the existing scan.');
      }
    }
    current();
    if (response.status === 202) {
      throw recoverable('This scan is still processing or being checked. Retry the same photo to recover it; do not start another scan.');
    }
    // Keep the deadline through the body, not just the response headers. Return
    // a buffered Response so every caller can decode JSON without another wait.
    let responseBytes;
    try { responseBytes = await response.arrayBuffer(); }
    catch (_) { current(); throw recoverable('Connection interrupted while reading the result. Retry this same photo to check the existing scan.'); }
    current();
    const buffered = new Response([204, 205, 304].includes(response.status) ? null : responseBytes,
      { status: response.status, statusText: response.statusText, headers: response.headers });
    // The response is durable before refreshing the server-owned balances.
    // A refresh failure must never turn a completed scan into a retry.
    try { Promise.resolve(window.loadSettingsScanCredits?.()).catch(() => {}); } catch (_) {}
    return buffered;
  };
  try { return await Promise.race([request(), interrupted]); }
  finally {
    clearTimeout(deadline); clearInterval(watch);
    options.signal?.removeEventListener('abort', cancel);
  }
};
