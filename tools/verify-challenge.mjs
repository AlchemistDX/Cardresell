#!/usr/bin/env node
// tools/verify-challenge.mjs
//
// Confirms the DEPLOYED endpoint is hashing the token you supply — the step
// that must pass AFTER a redeploy reports READY and BEFORE the new token is
// saved in eBay's portal. READY means the build finished; it does not mean the
// replacement value is the one being hashed.
//
// The token is read from a HIDDEN prompt (interactive terminal required). It is never
// echoed, never printed, never written to a file, and never placed in argv, so
// it cannot reach shell history, `ps` output, or logs.
//
//   node tools/verify-challenge.mjs
//
// Exit 0 = the endpoint hashes exactly the token you supplied.
// Exit 1 = it does not, with the corruption shape named when identifiable.

import { createHash } from 'node:crypto';
import { promptHidden } from './hidden-prompt.mjs';

const ENDPOINT = 'https://www.cardresell.org/api/ebay-notifications';

const raw = await promptHidden('Verification token (hidden): ');
if (!raw) { console.error('no token supplied — nothing verified'); process.exit(1); }

// Report the shape of what was supplied without revealing it. A trailing
// newline in YOUR paste is itself the defect this whole exercise is about.
if (raw !== raw.trim()) {
  console.error('WARNING: the value you supplied has leading or trailing whitespace.');
  console.error('If that is what you pasted into Vercel, fix it there before continuing.');
}
const token = raw.trim();

const CHAL = 'verify-' + Date.now();
const hash = (t) => {
  const h = createHash('sha256');
  h.update(CHAL); h.update(t); h.update(ENDPOINT);
  return h.digest('hex');
};

let r, j;
try {
  r = await fetch(`${ENDPOINT}?challenge_code=${encodeURIComponent(CHAL)}`,
                  { headers: { Accept: 'application/json' } });
  j = await r.json();
} catch (e) {
  console.error(`FAIL — could not reach the endpoint: ${e.message}`);
  console.error('Unreachable is not the same as wrong. Retry before concluding anything.');
  process.exit(1);
}

if (r.status !== 200 || !j?.challengeResponse) {
  console.error(`FAIL — endpoint answered ${r.status} without a challengeResponse.`);
  process.exit(1);
}

if (j.challengeResponse === hash(token)) {
  console.log('PASS — the deployed endpoint hashes exactly the token you supplied.');
  console.log('Safe to save that token in eBay\'s portal now.');
  process.exit(0);
}

// Name the corruption rather than guessing, same shapes the live harness knows.
const shapes = [
  ['a trailing newline',            token + '\n'],
  ['a trailing CRLF',               token + '\r\n'],
  ['a literal backslash-n',         token + '\\n'],
  ['wrapping double quotes',        `"${token}"`],
  ['quotes + a literal newline',    `"${token}\\n"`],
  ['a trailing space',              token + ' '],
];
const hit = shapes.find(([, v]) => j.challengeResponse === hash(v));

console.error('FAIL — the endpoint is NOT hashing the token you supplied.');
if (hit) {
  console.error(`It is hashing your token plus ${hit[0]}.`);
  console.error('The stored Vercel value carries a stray character. Fix it there, redeploy, re-run.');
} else {
  console.error('The value it hashes is not your token in any known malformed shape.');
  console.error('Most likely the redeploy has not picked up the new variable, or the');
  console.error('deployment serving this domain is not the one you just redeployed.');
  console.error('Check the live deployment\'s commit before changing anything else.');
}
console.error('DO NOT save the new token in eBay\'s portal until this passes.');
process.exit(1);
