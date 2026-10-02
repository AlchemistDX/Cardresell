import assert from 'node:assert/strict';
import { membershipWriterReadiness } from '../api/_membershipWriterReadiness.js';
let passed = 0;
for (const [value, expected] of [[null, 'absent'], ['1', 'installed'], ['0', 'invalid'], ['malformed', 'invalid']]) {
  const result = await membershipWriterReadiness({ billingEnabled: 'on', execute: async command => {
    assert.deepEqual(command, ['GET', 'membership:launch-v2:legacy_fence']);
    return value;
  } });
  assert.equal(result.fence, expected);
  assert.equal(result.datastoreAuthorization, 'accepted');
  assert.equal(result.cutoverProven, false);
  assert.equal(result.billingRouteEnabled, true);
  passed++;
}
const unavailable = await membershipWriterReadiness({ execute: async () => { throw Error('secret response'); } });
assert.equal(unavailable.datastoreReadable, false);
assert.equal(JSON.stringify(unavailable).includes('secret'), false);
passed++;
for (const status of [401, 403, 500]) {
  const result = await membershipWriterReadiness({ execute: async () => {
    throw Object.assign(Error('must not expose remote details'), { status });
  } });
  assert.equal(result.datastoreAuthorization, status === 500 ? 'unknown' : 'rejected');
  assert.equal(result.cutoverProven, false);
  assert.equal(JSON.stringify(result).includes('remote details'), false);
  passed++;
}
console.log(`membership-writer-readiness: ${passed} passed, 0 failed`);
