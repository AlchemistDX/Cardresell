import assert from 'node:assert/strict';
import { membershipWriterReadiness } from '../api/_membershipWriterReadiness.js';
let passed = 0;
for (const [value, expected] of [[null, 'absent'], ['1', 'installed'], ['0', 'invalid'], ['malformed', 'invalid']]) {
  const result = await membershipWriterReadiness({ billingEnabled: 'on', execute: async command => {
    assert.deepEqual(command, ['GET', 'membership:launch-v2:legacy_fence']);
    return value;
  } });
  assert.equal(result.fence, expected);
  assert.equal(result.cutoverProven, false);
  assert.equal(result.billingRouteEnabled, true);
  passed++;
}
const unavailable = await membershipWriterReadiness({ execute: async () => { throw Error('secret response'); } });
assert.equal(unavailable.datastoreReadable, false);
assert.equal(JSON.stringify(unavailable).includes('secret'), false);
passed++;
console.log(`membership-writer-readiness: ${passed} passed, 0 failed`);
