// Conservative catalogue enrichment. A name/passcode identifies a card, not
// necessarily its printing. These checks do not certify finish or authenticity.
export const catalogText = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const known = value => !['', 'unknown', 'n/a', 'none', 'null'].includes(String(value ?? '').trim().toLowerCase());
export function catalogNumber(value, total = false) {
  const s = String(value ?? '').normalize('NFKC').trim().toLowerCase();
  const n = total ? s.split('/')[0].trim() : s;
  return /^\d+$/.test(n) ? n.replace(/^0+(?=\d)/, '') : n;
}
export function matchesCatalogPrinting(info, record, { total = false, languageRequired = false } = {}) {
  if (!record || !known(info.card_name) || catalogText(info.card_name) !== catalogText(record.name)) return false;
  if (!known(info.card_number) || !known(record.number) || catalogNumber(info.card_number,total) !== catalogNumber(record.number,total)) return false;
  const aliases = (record.setAliases || []).filter(known).map(catalogText);
  // Set names can be localized, while OCR set codes can use provider aliases.
  // Require at least one exact alias; never use token overlap or first result.
  if (![info.set_name,info.set_code].filter(known).some(s => aliases.includes(catalogText(s)))) return false;
  const lang = String(info.language || (info.is_japanese ? 'ja' : '')).toLowerCase();
  const actual = String(record.language || '').toLowerCase();
  const normLang = s => ({japanese:'ja',jpn:'ja',english:'en',eng:'en'}[s] || s);
  if (lang && ((languageRequired && !actual) || (actual && normLang(lang) !== normLang(actual)))) return false;
  return true;
}
export function uniqueCatalogMatch(records, predicate, key = record => record.id) {
  const matches = new Map();
  for (const record of records || []) if (predicate(record)) {
    const id = key(record);
    if (!id) return null; // no durable identity: cannot safely deduplicate
    matches.set(String(id),record);
  }
  return matches.size === 1 ? matches.values().next().value : null;
}
export function ygoPrinting(info, sets) {
  const code = String(info.set_code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}-(EN|DE|FR|IT|PT|SP|JP|KR|TC|AE)[A-Z0-9]{2,4}$/.test(code)) return null;
  let matches = (sets || []).filter(s => String(s.set_code || '').toUpperCase() === code);
  if (matches.length > 1 && known(info.rarity)) matches = matches.filter(s => catalogText(s.set_rarity) === catalogText(info.rarity));
  return uniqueCatalogMatch(matches,()=>true,s => `${s.set_code}|${s.set_rarity || ''}`);
}
