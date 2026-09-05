/**
 * ESM wrapper around _appsource.cjs — see that file for why this exists.
 * Reassembles the logical index.html (inlining the hashed /js and /css assets
 * extracted in SOL-PLAT-007) so regression assertions stay valid unchanged.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readAppSource, ROOT } = require('./_appsource.cjs');
export { readAppSource, ROOT };
