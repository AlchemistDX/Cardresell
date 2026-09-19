/* Offline HTTP-boundary harness. The production picker handler, credit helpers and
 * selection-debit handler are REAL. Only auth/tier/vision and catalogue/KV
 * boundaries are doubled. Never reads .env or calls a live service. */
import { register } from 'node:module';
import { randomBytes } from 'node:crypto';
import { redisStore, redisRest } from './_idRedis.mjs';

process.env.XIMILAR_API_TOKEN = 'test-placeholder-not-a-credential';
// Synthetic endpoint only; fetch below is intercepted to private Unix-socket
// Redis. Match the production transport's exact Upstash hostname contract.
process.env.KV_REST_API_URL = 'https://scan-billing-test.upstash.io';
process.env.KV_REST_API_TOKEN = 'test-kv-not-a-credential';
if (!globalThis.__crStubsRegistered) {
  globalThis.__crStubsRegistered = true;
  register(new URL('./loader-stubs.mjs', import.meta.url));
}
const scan = (await import('../api/scan.js')).default;
const debit = (await import('../api/scan-debit-id.js')).default;
const refundHandler = (await import('../api/scan-refund.js')).default;
const { TIER_BENEFITS } = await import('./stubs/_tier.js');

export const UID = 'test-confirmation-billing';
export const PAID_KEY = `scans:${UID}:id_paid_left`;
export const monthStamp = () => new Date().toISOString().slice(0, 7).replace('-', '_');
export const freeKey = () => `scans:${UID}:id_free_used_${monthStamp()}`;
export const catalogue = Array.from({ length: 9 }, (_, i) => ({
  id: `set${i}-58`, name: 'Pikachu', number: '58',
  set: { id: `set${i}`, name: `set${i}` }, rarity: 'Common',
  images: { small: '', large: '' },
  tcgplayer: { prices: { normal: { market: 1 + i } } },
}));
export const ambiguous = () => ({
  token: { uid: UID, email: 'confirmation@example.test' },
  tier: 'pro',
  ximilar: { needsPicker: true,
    cardInfo: { card_type: 'pokemon', card_name: 'Pikachu', card_number: '58' },
    candidates: catalogue.map(c => ({ card_name:c.name, card_number:c.number,
      card_type:'pokemon', set_code:c.set.id, set_name:c.set.name, rarity:c.rarity })) },
  catalog: catalogue,
});
export const exact = () => {
  const s = ambiguous();
  s.ximilar.cardInfo.set_code = 'set6';
  s.ximilar.needsPicker = false;
  s.ximilar.candidates = [];
  s.catalog = [catalogue[6]];
  return s;
};

export function billingHarness({ bucket = 'paid', balance = 5 } = {}) {
  const store = redisStore();
  store.set(PAID_KEY, String(balance));
  store.set(freeKey(), '0');
  const commands = [], outbound = [], selections = [];
  const faults = {};
  const originalFetch = globalThis.fetch;
  // Explicit benefits, unlike the legacy no-KV suite's empty tier fixture.
  const originalBenefits = TIER_BENEFITS.pro;
  TIER_BENEFITS.pro = { idGrant: bucket === 'free' ? 30 : 0, gradeGrant: 15 };
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input?.url || input));
    if (u.origin === process.env.KV_REST_API_URL) {
      return redisRest(input, init, commands, faults);
    }
    if (u.hostname === 'api.pokemontcg.io') {
      return Response.json({ data: globalThis.__STUB.catalog || [] });
    }
    outbound.push(u.href);
    throw new Error('offline billing harness blocked ' + u.href);
  };
  async function invoke(handler, body) {
    const res = {
      statusCode: 200, payload: null,
      setHeader() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (faults.throwResponse && payload.success === true && !payload.needsPicker && payload.mode === 'identify') {
          faults.throwResponse = false;
          throw new Error('injected response failure after successful scan record');
        }
        this.payload = payload; return this;
      },
    };
    await handler({
      method: 'POST', headers: { authorization: 'Bearer ' + 'x'.repeat(40) }, body,
    }, res);
    // Drain fire-and-forget stats before assertions.
    await new Promise(resolve => setImmediate(resolve));
    return res;
  }
  let lastPayload;
  return {
    store, commands, outbound, selections, faults,
    net: () => balance - Number(store.get(PAID_KEY)) + Number(store.get(freeKey())),
    scan: async (stub = ambiguous(), extraBody = {}) => {
      globalThis.__STUB = stub;
      const result = await invoke(scan, { imageBase64: Buffer.from('fake-jpeg').toString('base64'),
        mimeType: 'image/jpeg', mode: 'identify',
        ...(process.env.MEMBERSHIP_BILLING_V2 === 'on' ? { operation_id: randomBytes(32).toString('hex') } : {}),
        ...extraBody });
      lastPayload = result.payload;
      return result;
    },
    body: candidate => ({ confirmation_id: lastPayload.confirmation_id,
      scan_id: lastPayload.scan_id, candidate_set: lastPayload.candidate_set,
      mode: 'identify', candidate }),
    pick: async (body) => {
      selections.push(body);
      return invoke(debit, body);
    },
    invokeScan: body => invoke(scan, body),
    refund: scan_id => invoke(refundHandler, { scan_id, reason: 'wrong_card' }),
    restore() {
      globalThis.fetch = originalFetch;
      TIER_BENEFITS.pro = originalBenefits;
    },
  };
}
