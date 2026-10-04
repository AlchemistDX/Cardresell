// Bind retries (including reloads) to the same signed owner and photo request.
// Persist only hashes and random operation IDs, never photos or auth tokens.
window.cardResellScanRequest = async function (url, options) {
  if (url !== '/api/scan' || options?.method !== 'POST') throw Error('Invalid scan request.');
  const user = window._fbAuth?.currentUser;
  if (!user?.uid || typeof user.getIdToken !== 'function') throw Error('Sign in before scanning.');
  const current = () => {
    if (window._fbAuth?.currentUser !== user) throw Error('Account changed. Reopen the scanner.');
  };
  const body = JSON.parse(options.body);
  delete body.operation_id;
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
  let response;
  try {
    response = await fetch(url, { ...options,
      headers: { ...options.headers, Authorization: 'Bearer ' + token },
      body: JSON.stringify({ ...body, operation_id: operation }) });
  } catch (_) { throw Error('Connection interrupted. Retry this same photo to check the existing scan.'); }
  current();
  if (response.status === 202) {
    throw Error('This scan is still processing or being checked. Retry the same photo to recover it; do not start another scan.');
  }
  // The response is durable before refreshing the server-owned balances.
  // A refresh failure must never turn a completed scan into a retry.
  try { Promise.resolve(window.loadSettingsScanCredits?.()).catch(() => {}); } catch (_) {}
  return response;
};
