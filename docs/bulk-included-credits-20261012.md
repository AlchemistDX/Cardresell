# Bulk scan included credits

The production binder review exposed a second issue: Settings displayed 15
included ID credits, but the bulk confirmation displayed zero available. Bulk
upload, rapid capture, the queue precheck and progress used only purchased
credits. Included monthly/welcome credits must count in the same total.

The UI now adds the included and purchased balances at those four points.
Server authorization and debit behavior are unchanged; a server STOP still
terminates the queue. The previous immutable UI asset remains available.

Validation before release:

- Bulk photo preflight: 26 checks, including included-only, mixed, purchased-only,
  empty balances, progress and server STOP.
- Binder browser: 64 checks, including the supplied nine-card photo, across
  portrait and landscape views; no identification requests submitted.
- Rapid browser: 88 checks across four viewports.
- Asset fingerprints: 109 checks; release build inspector passed.

The user's photo is not stored in this repository. These checks do not claim
successful provider identification or a production credit debit.
