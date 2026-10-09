// Launch feature contract. Paid access follows the validated, paid-through
// allocation; neither a browser tier nor a scheduled future plan grants access.
// Legacy/audited account capabilities remain a separate compatibility path.
export const MEMBERSHIP_FEATURE_VERSION = 'seller-tools-v1';
export const MEMBERSHIP_PAID_FEATURES = Object.freeze({
  starter: Object.freeze({ bulkGrade: false }),
  casual: Object.freeze({ bulkGrade: false }),
  pro: Object.freeze({ bulkGrade: true }),
  business: Object.freeze({ bulkGrade: true }),
});
