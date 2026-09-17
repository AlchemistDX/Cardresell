/* Test stub. Controlled by globalThis.__STUB.token */
export async function verifyTokenFlexible(idToken) {
  const s = (globalThis.__STUB || {}).token || {};
  if (s.throw) throw new Error(s.throw);
  return { uid: s.uid ?? 'test-uid-1', email: s.email ?? 'seller@example.com' };
}
export default { verifyTokenFlexible };
