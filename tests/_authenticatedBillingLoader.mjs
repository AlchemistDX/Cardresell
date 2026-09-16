// Offline only: vision is deterministic. Authentication, tier, handlers,
// resolver, confirmation journals and Redis Lua are NOT replaced.
const vision = new Set(['./_ximilar.js', './_ximilar_grade.js']);
export async function resolve(specifier, context, next) {
  if (vision.has(specifier) && context.parentURL?.includes('/api/')) {
    return { url: new URL('./stubs/' + specifier.slice(2), import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
