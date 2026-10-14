// Server-only fallback observations. Request metadata correlates these with
// provider logs; no customer, receipt, card, image or raw error data is logged.
export function observeDeepGradeSettlement({ membershipV2, charged, refunded, reconciliationRequired = false } = {}) {
  const outcome = reconciliationRequired ? 'reconciliation_required'
    : charged === 1 && refunded === 1 ? 'quick_charge'
    : charged === 0 && refunded === 2 ? 'full_refund' : 'unconfirmed';
  const confirmed = outcome === 'quick_charge' || outcome === 'full_refund';
  try {
    console.log('GRADE_SETTLEMENT ' + JSON.stringify({
      event: 'deep_grade_fallback_settlement', version: 1,
      billing_version: membershipV2 === true ? 'membership_v2' : 'legacy',
      outcome,
      customer_credits_charged: confirmed ? charged : null,
      customer_credits_refunded: confirmed ? refunded : null,
    }));
  } catch { /* Observability must never change the result or credit adjustment. */ }
}
