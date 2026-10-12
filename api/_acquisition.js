// Bounded, client-reported marketing context. Never payment/ownership authority.
export const ACQUISITION_CAMPAIGNS = Object.freeze([
  'direct', 'shop_qr', 'youtube', 'discord', 'google_ads', 'meta_ads', 'reddit',
  'organic_search', 'referral', 'other_campaign', 'qa',
]);
export function acquisitionCampaign(value) {
  if (value === undefined || value === null || value === 'unknown') return 'unknown';
  return ACQUISITION_CAMPAIGNS.includes(value) ? value : 'other_campaign';
}
