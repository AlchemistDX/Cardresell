// ── Upstash REST client, one implementation ────────────────────────────────
//
// This lived inside api/drafts.js. It moved here the moment a SECOND endpoint
// needed to read the same keys: two copies of the transport is how one of them
// quietly acquires a different error shape, and every caller of the store
// reads `kv_<status>` off the message.
//
// The contract callers depend on, unchanged from the original:
//   * arguments are Redis command words, each URL-encoded as a path segment
//   * a non-2xx response THROWS `kv_<status>` — it never returns a value, so a
//     transport failure can never be mistaken for a missing key. Everything
//     downstream that distinguishes "absent" from "unreadable" rests on this.
//   * the Upstash `result` field is returned bare
//
// Command-in-the-path means the whole command is subject to URL length limits.
// That is fine for the key reads and the small scripts in use, and it is the
// reason a large value is written with a body-form call rather than here.

export function makeKv(url, token) {
  return async function kv(...args) {
    const path = args.map((a) => encodeURIComponent(String(a))).join('/');
    const r = await fetch(`${url}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`kv_${r.status}`);
    const j = await r.json();
    return j.result;
  };
}

/**
 * The credentials, read once, in one place.
 *
 * Returns `null` when either half is missing so a caller can answer 503 rather
 * than construct a client that fails on first use with a confusing message.
 */
export function kvFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return makeKv(url, token);
}
