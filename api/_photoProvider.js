/**
 * THE resolver for the configured photo host.
 *
 * This is the only place that reads PHOTO_HOST_PROVIDER. `photoHostFromEnv`
 * used to live in `_photoHost.js`, but the R2 provider imports the export
 * contract from that file, so resolving there would make the two modules
 * circular. Moving resolution up into its own module keeps it at exactly one
 * implementation -- the alternative considered was a second resolver for R2
 * beside the original, which is precisely the duplicate-behaviour shape this
 * codebase forbids.
 *
 * NULL IS STILL A SUPPORTED ANSWER. Before R2 is configured, every caller
 * must handle "not hosted" by SAYING photos were not hosted, which is why
 * this returns null rather than a stub yielding unreachable URLs.
 */

import { makeFakePhotoHost } from './_photoHost.js';
import { r2HostFromEnv } from './_r2Host.js';

export const PHOTO_PROVIDER_STATE = Object.freeze({
  NONE: 'NONE',                 // nothing chosen -- the documented pre-hosting state
  READY: 'READY',
  MISCONFIGURED: 'MISCONFIGURED', // chosen but incomplete -- must be visible, not silent
  UNKNOWN_PROVIDER: 'UNKNOWN_PROVIDER',
});

/**
 * Resolve the host, with a state and a reason.
 *
 * A bare null could not distinguish "no provider chosen" from "r2 chosen but
 * PHOTO_KEY_SECRET absent". Those need different answers: the first is
 * expected and gets the blank-column disclosure; the second is a deployment
 * mistake that must surface rather than quietly producing listings with no
 * photographs.
 */
export function resolvePhotoProvider(env = process.env, fetchImpl) {
  const provider = String((env && env.PHOTO_HOST_PROVIDER) || '').trim().toLowerCase();
  if (!provider) return { state: PHOTO_PROVIDER_STATE.NONE, host: null };

  if (provider === 'r2') {
    const r = r2HostFromEnv(env, fetchImpl);
    if (!r.ok) {
      return { state: PHOTO_PROVIDER_STATE.MISCONFIGURED, host: null, missing: r.missing };
    }
    return { state: PHOTO_PROVIDER_STATE.READY, host: r.host };
  }

  if (provider === 'fake') {
    // Reachable only where the base URL is also supplied, so a stray value in
    // a real environment cannot route seller photographs to a fake.
    const baseUrl = String((env && env.PHOTO_HOST_BASE_URL) || '').trim();
    if (!baseUrl) return { state: PHOTO_PROVIDER_STATE.MISCONFIGURED, host: null, missing: ['PHOTO_HOST_BASE_URL'] };
    return { state: PHOTO_PROVIDER_STATE.READY, host: makeFakePhotoHost({ baseUrl }) };
  }

  // An environment typo degrades to "photos were not hosted, and we said so"
  // rather than a 500 on the export path.
  return { state: PHOTO_PROVIDER_STATE.UNKNOWN_PROVIDER, host: null, provider };
}

/** The host alone, for callers that only branch on hosted / not hosted. */
export function photoHostFromEnv(env = process.env, fetchImpl) {
  return resolvePhotoProvider(env, fetchImpl).host;
}
