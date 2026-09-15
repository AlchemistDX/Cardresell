/* ESM resolve hook: redirect api/scan.js's external-service imports to stubs.
 * _identityResolution.js is deliberately NOT stubbed — it is under test. */
import { pathToFileURL } from 'node:url';
const STUBBED = new Set(['./_verifyToken.js', './_ximilar.js', './_ximilar_grade.js', './_tier.js']);
const dir = new URL('./stubs/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (STUBBED.has(specifier) && context.parentURL && context.parentURL.includes('/api/')) {
    return { url: new URL(specifier.replace('./', ''), dir).href, shortCircuit: true };
  }
  return next(specifier, context);
}
