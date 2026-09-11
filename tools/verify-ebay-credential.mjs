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
//   That is a separate question, and at production commit 9aaf326 the deployed
//   code does not perform a token exchange at all — see
//   audit/ROTATION_RECHECK_2026-09-10.md §9.
//
// Both values are read from HIDDEN prompts. Neither is echoed, printed,
// written to a file, or placed in argv, so neither can reach shell history,
// `ps` output, or logs. The issued access token is never printed either —
// only its non-secret metadata.
//
//   node tools/verify-ebay-credential.mjs
//
// Exit 0 = the exchange succeeded.
// Exit 1 = it did not, with eBay's own error reported.
//
// QUOTA: this performs ONE real token exchange against the production
// endpoint. Application-token requests are rate-limited daily. Run it once.

import { createInterface } from 'node:readline';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SCOPE     = 'https://api.ebay.com/oauth/api_scope';

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

const rawApp  = await promptHidden('Replacement App ID  (hidden): ');
const rawCert = await promptHidden('Replacement Cert ID (hidden): ');

// Report the SHAPE of what was supplied without revealing it. This is about
// what YOU typed here — it says nothing about what is stored in Vercel.
for (const [name, raw] of [['App ID', rawApp], ['Cert ID', rawCert]]) {
  if (!raw) { console.error(`FAIL — no ${name} supplied; nothing verified.`); process.exit(1); }
  if (raw !== raw.trim()) {
    console.error(`WARNING: the ${name} you typed has leading or trailing whitespace.`);
    console.error('That is a fact about this input only. Re-run with a clean paste.');
  }
}
const appId  = rawApp.trim();
const certId = rawCert.trim();

const basic = Buffer.from(`${appId}:${certId}`).toString('base64');

let r, text;
try {
  r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString(),
  });
  text = await r.text();
} catch (e) {
  console.error(`INCOMPLETE — could not reach eBay's token endpoint: ${e.message}`);
  console.error('Unreachable is not a failed credential, and it is not a pass either.');
  console.error('Nothing is verified until the exchange actually runs. Retry.');
  process.exit(1);
}

let j;
try { j = JSON.parse(text); } catch {
  console.error(`FAIL — HTTP ${r.status}, response was not JSON.`);
  process.exit(1);
}

if (r.status !== 200 || !j.access_token) {
  console.error(`FAIL — HTTP ${r.status}. eBay did not issue a token.`);
  // eBay's OAuth errors are non-secret and are the whole diagnostic value here.
  if (j.error)             console.error(`  error: ${j.error}`);
  if (j.error_description) console.error(`  description: ${j.error_description}`);
  console.error('invalid_client means the pair was rejected — wrong value, wrong');
  console.error('environment (sandbox vs production), or the Cert ID is not yet active.');
  process.exit(1);
}

// Non-secret provenance only. The access token itself is never printed.
console.log('PASS — eBay issued an application token for this credential pair.');
console.log(`  endpoint    : ${TOKEN_URL}`);
console.log(`  http status : ${r.status}`);
console.log(`  token_type  : ${j.token_type ?? '(absent)'}`);
console.log(`  expires_in  : ${j.expires_in ?? '(absent)'} seconds`);
console.log(`  scope       : ${j.scope ?? SCOPE}`);
console.log(`  observed at : ${new Date().toISOString()}`);
console.log('');
console.log('What this does NOT establish:');
console.log('  - that the deployed application uses this credential;');
console.log('  - that any previously issued token has stopped working.');
console.log('Both are separate checks. See audit/ROTATION_RECHECK_2026-09-10.md §9.');
process.exit(0);
