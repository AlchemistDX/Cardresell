/* Offline HTTP-boundary harness. The handler, resolver, credit helpers and
 * selection-debit handler are REAL. Only auth/tier/vision and catalogue/KV
 * boundaries are doubled. Never reads .env or calls a live service. */
import { register } from 'node:module';

process.env.XIMILAR_API_TOKEN = 'test-placeholder-not-a-credential';
process.env.KV_REST_API_URL = 'https://scan-billing.test.invalid';
process.env.KV_REST_API_TOKEN = 'test-kv-not-a-credential';
if (!globalThis.__crStubsRegistered) {
  globalThis.__crStubsRegistered = true;
  register(new URL('./loader-stubs.mjs', import.meta.url));
}
const scan = (await import('../api/scan.js')).default;
const debit = (await import('../api/scan-debit-id.js')).default;
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
  ximilar: { cardInfo: { card_type: 'pokemon', card_name: 'Pikachu', card_number: '58' } },
  catalog: catalogue,
});
export const exact = () => {
  const s = ambiguous();
  s.ximilar.cardInfo.set_code = 'set6';
  s.catalog = [catalogue[6]];
  return s;
};

export function billingHarness({ bucket = 'paid', balance = 5 } = {}) {
  const store = new Map([[PAID_KEY, String(balance)], [freeKey(), '0']]);
  const commands = [], outbound = [], selections = [];
  const originalFetch = globalThis.fetch;
  // Explicit benefits, unlike the legacy no-KV suite's empty tier fixture.
  const originalBenefits = TIER_BENEFITS.pro;
  TIER_BENEFITS.pro = { idGrant: bucket === 'free' ? 30 : 0, gradeGrant: 15 };
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input?.url || input));
    if (u.origin === process.env.KV_REST_API_URL) {
      // Split BEFORE decoding: SET values can contain URL-encoded slashes.
      const [cmd, key, value, extra] = u.pathname.slice(1).split('/').map(decodeURIComponent);
      commands.push({ cmd, key, value, ex: u.searchParams.get('EX') });
      let result;
      switch (cmd) {
        case 'get': result = store.get(key) ?? null; break;
        case 'set': store.set(key, value); result = 'OK'; break;
        case 'setex': store.set(key, extra); result = 'OK'; break;
        case 'incr':
        case 'decr':
          result = Number(store.get(key) || 0) + (cmd === 'incr' ? 1 : -1);
          store.set(key, String(result)); break;
        default: outbound.push(`unknown KV command: ${cmd}`); throw new Error(outbound.at(-1));
      }
      return Response.json({ result });
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
      json(payload) { this.payload = payload; return this; },
    };
    await handler({
      method: 'POST', headers: { authorization: 'Bearer ' + 'x'.repeat(40) }, body,
    }, res);
    // Drain fire-and-forget stats before assertions.
    await new Promise(resolve => setImmediate(resolve));
    return res;
  }
  return {
    store, commands, outbound, selections,
    net: () => balance - Number(store.get(PAID_KEY)) + Number(store.get(freeKey())),
    scan: async (stub = ambiguous()) => {
      globalThis.__STUB = stub;
      return invoke(scan, { imageBase64: Buffer.from('fake-jpeg').toString('base64'),
        mimeType: 'image/jpeg', mode: 'identify' });
    },
    pick: async (pickedCard) => {
      selections.push(pickedCard);
      return invoke(debit, { pickedCard });
    },
    restore() {
      globalThis.fetch = originalFetch;
      TIER_BENEFITS.pro = originalBenefits;
    },
  };
}
