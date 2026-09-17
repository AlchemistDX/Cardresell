/* ESM resolve hook: redirect only external auth/tier/vision imports to stubs.
 * Production scan/debit/refund handlers and the billing Lua remain real. */
import { pathToFileURL } from 'node:url';
const STUBBED = new Set(['./_verifyToken.js', './_ximilar.js', './_ximilar_grade.js', './_tier.js']);
const dir = new URL('./stubs/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (STUBBED.has(specifier) && context.parentURL && context.parentURL.includes('/api/')) {
    return { url: new URL(specifier.replace('./', ''), dir).href, shortCircuit: true };
  }
  return next(specifier, context);
}
