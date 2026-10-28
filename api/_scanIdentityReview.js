// A recognized card name is not always an identified physical printing.
// These results remain unpriced, unsaved and refunded until reviewed manually.
export function scanIdentityReview(info) {
  if (!info) return null;
  const name = String(info.card_name || '').trim();
  const game = String(info.card_type || '');
  const result = (kind, message) => ({ kind, name, game, message });
  if (info._ximilar_graded === true && info._slab_verified !== true) return result('slab',
    'Graded slab detected. Check the card printing, grading company and label grade in Card Lookup before using a value. No ID credit was used.');
  if (game === 'onepiece' && info._printed_promo !== true && (/^p(?:-|$)/i.test(String(info.set_code || '')) ||
      /^p-/i.test(String(info.card_number || '')) || /^p-/i.test(String(info._grounded_id || '')) ||
      /^p-/i.test(String(info._ximilar_card_id || '')))) return result('promo',
    'Promo card detected. Review the artwork and event or anniversary stamp to choose the exact printing. No ID credit was used.');
  if (game === 'yugioh' && (!/^[A-Z0-9]{2,6}-(?:(?:EN|DE|FR|IT|PT|SP|JP|KR|TC|AE|EU)[A-Z0-9]{2,4}|[0-9]{3})$/i.test(String(info.set_code || '')) ||
      !info.set_name || /^(?:unknown(?: set)?|n\/a|none)$/i.test(info.set_name))) return result('printing',
    'Card name found; the printed set code is still unconfirmed. Choose the matching printing before using a value. No ID credit was used.');
  return null;
}
