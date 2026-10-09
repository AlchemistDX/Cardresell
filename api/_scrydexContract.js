// Scrydex pilot contract. Keep provider identity and price provenance explicit;
// this is deliberately not a drop-in legacy tcgplayer price object.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const str = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
const money = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
function imageUrl(v) {
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; }
  catch { return ''; }
}
function images(value) {
  return (Array.isArray(value) ? value : []).slice(0, 10).map(i => ({
    type: str(i?.type, 40), small: imageUrl(i?.small), medium: imageUrl(i?.medium), large: imageUrl(i?.large),
  }));
}
export function scrydexRequest(query = {}) {
  const allowed = ['id', 'name', 'language', 'page', 'pageSize', 'prices'];
  if (Object.keys(query).some(k => !allowed.includes(k) || typeof query[k] !== 'string')) throw new Error('Invalid lookup parameters');
  const prices = query.prices ?? '0';
  if (!['0', '1'].includes(prices)) throw new Error('Invalid prices option');
  const params = new URLSearchParams({ casing: 'snake' });
  if (prices === '1') params.set('include', 'prices');
  let path = '/pokemon/v1/cards';
  let page = 1, pageSize = 1, language = null;
  if (query.id) {
    if (!ID.test(query.id) || ['name','language','page','pageSize'].some(k => k in query)) throw new Error('Invalid exact lookup');
    path += '/' + encodeURIComponent(query.id);
  } else {
    // No arbitrary provider query language, path, include or ordering from clients.
    const name = (query.name || '').normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{N} '\u2019.\-♀♂]{2,80}$/u.test(name)) throw new Error('Enter a card name');
    language = query.language || 'EN';
    if (!['EN', 'JA'].includes(language)) throw new Error('Unsupported language');
    const number = (v, def, max) => {
      if (v === undefined) return def;
      if (!/^[1-9]\d*$/.test(v) || Number(v) > max) throw new Error('Invalid page');
      return Number(v);
    };
    page = number(query.page, 1, 100);
    pageSize = number(query.pageSize, 20, 100);
    params.set('q', `name:"${name}" language_code:${language}`);
    params.set('page', String(page)); params.set('page_size', String(pageSize));
  }
  return { url: `https://api.scrydex.com${path}?${params}`, id: query.id || null, page, pageSize, language, prices: prices === '1' };
}
function normalizePrice(p) {
  if (!p || !['raw', 'graded'].includes(p.type) || !/^[A-Z]{3}$/.test(p.currency || '')) return null;
  if (p.type === 'raw' && !['NM','LP','MP','HP','DM'].includes(p.condition)) return null;
  if (p.type === 'graded' && (!str(p.company) || !['string','number'].includes(typeof p.grade))) return null;
  const value = { provider: 'scrydex', type: p.type, currency: p.currency,
    condition: p.type === 'raw' ? p.condition : null,
    company: p.type === 'graded' ? str(p.company, 60) : null,
    grade: p.type === 'graded' ? String(p.grade).slice(0, 30) : null,
    low: money(p.low), mid: money(p.mid), high: money(p.high), market: money(p.market),
    // The published schema does not promise a marketplace or observation date.
    // Never substitute our fetch time for the underlying market observation.
    source: str(p.source, 100) || null, updatedAt: str(p.updated_at, 80) || null,
    isPerfect: typeof p.is_perfect === 'boolean' ? p.is_perfect : null,
    isSigned: typeof p.is_signed === 'boolean' ? p.is_signed : null,
    isError: typeof p.is_error === 'boolean' ? p.is_error : null };
  return [value.low, value.mid, value.high, value.market].some(v => v !== null) ? value : null;
}
export function normalizeScrydexCard(c, includePrices = false) {
  if (!c || !ID.test(c.id || '') || !str(c.name) || !str(c.number) || !ID.test(c.expansion?.id || '')) throw new Error('Invalid provider identity');
  const language = str(c.language_code || c.expansion?.language_code, 10).toUpperCase();
  if (!language) throw new Error('Missing provider language');
  return { provider: 'scrydex', id: c.id, name: str(c.name), number: str(c.number, 40),
    printedNumber: str(c.printed_number, 80), language, rarity: str(c.rarity, 80),
    expansion: { id: c.expansion.id, name: str(c.expansion.name), series: str(c.expansion.series),
      total: count(c.expansion.total), printedTotal: count(c.expansion.printed_total),
      releaseDate: str(c.expansion.release_date, 40), isOnlineOnly: c.expansion.is_online_only === true },
    images: images(c.images), variants: (Array.isArray(c.variants) ? c.variants : []).slice(0, 100).map(v => ({
      name: str(v?.name, 100), images: images(v?.images),
      prices: includePrices && Array.isArray(v?.prices) ? v.prices.slice(0, 500).map(normalizePrice).filter(Boolean) : [],
    })) };
}
export function normalizeScrydexResponse(body, request, fetchedAt) {
  if (!body || (body.status && body.status !== 'success')) throw new Error('Invalid provider response');
  const raw = request.id ? [body.data] : body.data;
  if (!Array.isArray(raw) || raw.length > request.pageSize) throw new Error('Invalid provider page');
  const data = raw.map(c => normalizeScrydexCard(c, request.prices));
  if (request.id && data[0]?.id !== request.id) throw new Error('Provider identity mismatch');
  if (request.language && data.some(c => c.language !== request.language)) throw new Error('Provider language mismatch');
  if (new Set(data.map(c => c.id)).size !== data.length) throw new Error('Duplicate provider identity');
  const total = request.id ? 1 : count(body.total_count ?? body.totalCount);
  if (total === null) throw new Error('Missing provider pagination');
  if (!request.id && (Number(body.page) !== request.page || Number(body.page_size ?? body.pageSize) !== request.pageSize)) throw new Error('Provider pagination mismatch');
  return { provider: 'scrydex', fetchedAt, data, page: request.page, pageSize: request.pageSize,
    totalCount: total, nextPage: request.page * request.pageSize < total && request.page < 100 ? request.page + 1 : null,
    truncated: request.page === 100 && request.page * request.pageSize < total };
}
