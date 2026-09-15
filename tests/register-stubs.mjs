/* Installs the ESM stub loader. Kept for the explicit
 *   node --import ./tests/register-stubs.mjs <suite>
 * invocation. Suites that must run inside the push gate register the hook
 * themselves instead, because the gate's suite() helper cannot pass --import.
 * The flag keeps a double registration from installing the hook twice.
 */
import { register } from 'node:module';
if (!globalThis.__crStubsRegistered) {
  globalThis.__crStubsRegistered = true;
  register(new URL('./loader-stubs.mjs', import.meta.url));
}
