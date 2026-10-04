# B02 email verification recovery

Scope: Preview branch `feature/launch-membership-v2`, based on `fd99cfc4ab8c38b238c8ab2e40ab8ad1a94343e3`. Production remains the separately verified `7520acb` photo-capture release; do not merge this Preview branch wholesale into Production.

## Confirmed diagnosis

Vercel logs on deployment `dpl_AGzLhNZUhfKE82i6riQSmpisEaBX`, October 4 at 05:21:30 and 05:21:31 UTC, show valid Firebase signature/project/subject, absent or unverified token email authority, and `stored_verification_missing`. The lookup did not report a read failure. This is distinct from the prior provider missing-initial-state error. No owner verification record was created or copied by this investigation.

## Correction

The authenticator keeps rejecting the request with HTTP 401. Only a cryptographically validated identity whose completed lookup supplies no accepted verification gets the fixed `verify_email` action. Invalid identity and lookup exceptions remain generic failures. Catalogue, checkout and account adapters retain admission and side-effect boundaries.

Shop and Subscriptions explain that email verification is required and open the existing verification modal in the same tab. They do not reauthenticate, send email automatically, navigate, clear operation history or enable payment. Controls check the current account before opening verification. Public fallback prices stay disabled.

The Firebase-link claim route previously read `email_verified` from a verifier result exposing `emailVerified`, rejecting verified results. It now requires normalized boolean true. The verification write must return HTTP success and Redis `OK`; failed/uncertain persistence returns 503 before claiming success or awarding credits. Optional display cache remains best effort.

## Verification

- Full local gate: 70 slots, 67 executed passed, three existing explicit skips (real-store drafts, Production smoke under local mode, opt-in condition-pill browser checks).
- Focused membership gate: 37 invocations, zero nonzero exits.
- Server authentication: 43 checks, including action disclosure boundaries and no downstream account/customer/checkout side effects.
- Actual claim handler plus actual cryptographic verifier: 10 synthetic cases, including false/absent/nonboolean verification, already-claimed replay and persistence failures. Private synthetic signing keys and in-memory HTTP only.
- Shop identity/recovery: 162 checks. Auth integrity and asset fingerprints passed.
- Isolated Chromium fixture: Shop and Subscriptions at 390x844 and 1280x900; verification control present, purchases disabled, no sign-in link, no horizontal overflow, close and pending-history preservation. Screenshots inspected. This is not physical-device or real-account acceptance.
- A first fixture run reopened the dialog before its asynchronous close event and timed out; the corrected fixture awaits that event. No pass inferred from the failed run.
- Test-only runtime portability reuses the already-reviewed isolated password-protected loopback Redis helper; legacy syntax and scan tests now read this checkout rather than a different workspace.

## Remaining acceptance and safeguards

B02 is still incomplete until normal owner email verification and authenticated Preview account/enrollment/session recovery succeed. No live purchase, refund, subscription change, cancellation reversal, verification bypass, copied Production verification or provider policy change occurred. Accepted Grade delivery/replay remains accepted; fresh ID delivery and applicable lifecycle gates remain separate. Owner cancellation and held migration remain controlling.

After Preview publication, the owner can refresh the existing Safari Preview tab, open Shop, use Verify email and finish the normal verification prompt, then reopen Shop. Stop if signed out or a different error appears; do not purchase anything. Retain pending-operation history in that same tab.
