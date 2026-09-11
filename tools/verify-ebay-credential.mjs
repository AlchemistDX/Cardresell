#!/usr/bin/env node
// tools/verify-ebay-credential.mjs
//
// Demonstrates that a REPLACEMENT eBay credential pair can complete a
// client_credentials exchange at eBay's token endpoint.
//
// SCOPE — read this before running it.
//   A pass here establishes ONE thing: eBay's token endpoint accepts this
//   App ID / Cert ID pair and issues an application token.
//   It does NOT establish that the deployed application uses that credential.
//   At production commit 9aaf326 the deployed code performs no token exchange
//   at all — see audit/ROTATION_RECHECK_2026-09-10.md §9.
//   The deployed VERIFICATION TOKEN is a different credential and a different
//   check: tools/verify-challenge.mjs.
//
// Both values are read from HIDDEN prompts. Neither is echoed, written to a
// file, or placed in argv. The issued access token is never printed, and every
// output line — including error paths — is passed through a redactor that
// removes the supplied values and any token-shaped field before printing.
//
//   node tools/verify-ebay-credential.mjs
//
// Exit 0 = the exchange succeeded.  Exit 1 = it did not, or could not run.
//
// QUOTA: this performs ONE real token exchange against the production
// endpoint. Application-token requests are rate-limited daily. Run it once.

import { createInterface } from 'node:readline';

export const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
export const SCOPE     = 'https://api.ebay.com/oauth/api_scope';

/**
 * Remove secrets from any string before it is printed.
 *
 * eBay's error_description is attacker-free but NOT guaranteed secret-free:
 * an OAuth error may quote the client identifier it rejected. Treating the
 * upstream error as inherently non-secret was an assumption, so it is removed
 * here instead of trusted.
 *
 * @param {string} line
 * @param {string[]} secrets  values supplied by the operator
 */
export function redact(line, secrets = []) {
  let out = String(line);
  for (const s of secrets) {
    if (!s || s.length < 4) continue;          // too short to match safely
    out = out.split(s).join('[redacted]');
  }
  // Defence in depth: a JWT/opaque-token shape that reached a message anyway.
  out = out.replace(/\bv\^1\.1#[A-Za-z0-9+/=_^#*]{20,}/g, '[redacted-token]');
  out = out.replace(/\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[redacted-token]');
  return out;
}

/**
 * Perform the exchange and build the report. Pure with respect to I/O: takes
 * a fetch implementation, returns lines rather than printing, so the output
 * handling can be tested against mocked responses.
 *
 * @returns {Promise<{ok: boolean, status: 'pass'|'fail'|'incomplete', out: string[], err: string[]}>}
 */
export async function checkCredential({ appId, certId, fetchImpl = fetch, now = () => new Date() }) {
  const secrets = [appId, certId, Buffer.from(`${appId}:${certId}`).toString('base64')];
  const out = [], err = [];
  const push = (arr, line) => arr.push(redact(line, secrets));

  let r, text;
  try {
    r = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${secrets[2]}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString(),
    });
    text = await r.text();
  } catch (e) {
    push(err, `INCOMPLETE — could not reach eBay's token endpoint: ${e.message}`);
    push(err, 'Unreachable is not a failed credential, and it is not a pass either.');
    push(err, 'Nothing is verified until the exchange actually runs. Retry.');
    return { ok: false, status: 'incomplete', out, err };
  }

  let j;
  try { j = JSON.parse(text); } catch {
    push(err, `FAIL — HTTP ${r.status}, response body was not JSON.`);
    push(err, 'The body is not printed: an unparsed body could contain anything.');
    return { ok: false, status: 'fail', out, err };
  }

  if (r.status !== 200 || !j || !j.access_token) {
    push(err, `FAIL — HTTP ${r.status}. eBay did not issue a token.`);
    if (j && j.error)             push(err, `  error: ${j.error}`);
    if (j && j.error_description) push(err, `  description: ${j.error_description}`);
    push(err, 'invalid_client means the pair was rejected — wrong value, wrong');
    push(err, 'environment (sandbox vs production), or the Cert ID is not yet active.');
    return { ok: false, status: 'fail', out, err };
  }

  push(out, 'PASS — eBay issued an application token for this credential pair.');
  push(out, `  endpoint    : ${TOKEN_URL}`);
  push(out, `  http status : ${r.status}`);
  push(out, `  token_type  : ${j.token_type ?? '(absent)'}`);
  push(out, `  expires_in  : ${j.expires_in ?? '(absent)'} seconds`);
  push(out, `  scope       : ${j.scope ?? SCOPE}`);
  push(out, `  observed at : ${now().toISOString()}`);
  push(out, '');
  push(out, 'What this does NOT establish:');
  push(out, '  - that the deployed application uses this credential;');
  push(out, '  - that any previously issued token has stopped working.');
  push(out, 'Both are separate checks. See audit/ROTATION_RECHECK_2026-09-10.md §9.');
  return { ok: true, status: 'pass', out, err };
}

function promptHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.error('FAIL — refusing to read credentials from a pipe.');
      console.error('Piping routes the secret through a shell. Run this on a terminal.');
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = () => { rl.output.write('\x1b[2K\r' + question); };
    process.stdout.write(question);
    rl.input.on('data', onData);
    rl.question('', (answer) => {
      rl.input.off('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

// ── CLI entry. Skipped on import, so the tests exercise the logic above. ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const rawApp  = await promptHidden('Replacement App ID  (hidden): ');
  const rawCert = await promptHidden('Replacement Cert ID (hidden): ');

  for (const [name, raw] of [['App ID', rawApp], ['Cert ID', rawCert]]) {
    if (!raw) { console.error(`FAIL — no ${name} supplied; nothing verified.`); process.exit(1); }
    if (raw !== raw.trim()) {
      console.error(`WARNING: the ${name} you typed has leading or trailing whitespace.`);
      console.error('That is a fact about this input only. Re-run with a clean paste.');
    }
  }

  const res = await checkCredential({ appId: rawApp.trim(), certId: rawCert.trim() });
  for (const l of res.out) console.log(l);
  for (const l of res.err) console.error(l);
  process.exit(res.ok ? 0 : 1);
}
