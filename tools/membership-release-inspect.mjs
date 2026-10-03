// Ordinary builds do no additional work. Read-only inspection is optional.
// An explicit operator build may run apply/schedule only through the exact
// commit, pause, backup and revocation guards in transitionMembershipOwner.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const stage = process.env.MEMBERSHIP_OWNER_TRANSITION_STAGE;
const previewInspect = !!process.env.MEMBERSHIP_PREVIEW_INSPECT_COMMIT;
const sandboxRehearsal = !!process.env.MEMBERSHIP_SANDBOX_REHEARSAL_COMMIT;
if (stage || previewInspect || sandboxRehearsal || process.env.MEMBERSHIP_OWNER_READ_ONLY_INSPECT === 'enabled') {
  let directory, leader = false;
  try {
    if (stage && !['apply', 'schedule'].includes(stage)) throw Error('invalid_transition_stage');
    if ((previewInspect || sandboxRehearsal) && (stage || process.env.MEMBERSHIP_OWNER_READ_ONLY_INSPECT === 'enabled')
      || previewInspect && sandboxRehearsal) throw Error('mixed_operator_scope');
    // Legacy Vercel builds invokes the root script per function. Coordinate
    // within this build only; durable financial authority stays in Redis.
    // An uncertain leader is never reset. A fresh build reconciles the same
    // durable import/command through the normal idempotent operator.
    if (!/^[a-z0-9-]+\.vercel\.app$/.test(process.env.VERCEL_URL || '')) throw Error('deployment_identity_required');
    const id = createHash('sha256').update(JSON.stringify([
      process.env.VERCEL_URL, process.env.VERCEL_GIT_COMMIT_SHA,
      sandboxRehearsal ? 'sandbox_rehearsal' : previewInspect ? 'preview_inspect' : stage || 'inspect',
    ])).digest('hex');
    directory = join(tmpdir(), 'cardresell-operator-' + id);
    try { await mkdir(directory, { mode: 0o700 }); leader = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (leader) {
      if (sandboxRehearsal) {
        const { prepareMembershipSandboxRehearsal } = await import('./prepare-membership-sandbox-rehearsal.mjs');
        console.log('MEMBERSHIP_SANDBOX_REHEARSAL ' + JSON.stringify(await prepareMembershipSandboxRehearsal()));
      } else if (previewInspect) {
        const { inspectMembershipPreview } = await import('./inspect-membership-preview.mjs');
        console.log('MEMBERSHIP_PREVIEW_READ_ONLY ' + JSON.stringify(await inspectMembershipPreview()));
      } else {
      const { transitionMembershipOwner } = await import('./transition-membership-owner.mjs');
      const result = await transitionMembershipOwner({ stage: stage || 'inspect' });
      if (result.paidReconciliation) console.log('MEMBERSHIP_OWNER_PAID_RECONCILIATION ' + JSON.stringify({
        commit: process.env.VERCEL_GIT_COMMIT_SHA, ...result.paidReconciliation,
      }));
      if (result.checkoutInspection) console.log('MEMBERSHIP_PAID_CHECKOUT_INSPECTION ' + JSON.stringify({
        commit: process.env.VERCEL_GIT_COMMIT_SHA,
        paidCheckout: result.checkoutInspection.paidCheckout,
        records: result.checkoutInspection.records,
        balances: result.checkoutInspection.balances,
      }));
      console.log((stage || result.paidReconciliation ? 'MEMBERSHIP_OWNER_OPERATOR ' : process.env.MEMBERSHIP_OWNER_CHECKOUT_RECOVERY === 'enabled'
        ? 'MEMBERSHIP_OWNER_CHECKOUT_RECOVERY ' : 'MEMBERSHIP_OWNER_READ_ONLY ') + JSON.stringify({
        commit: process.env.VERCEL_GIT_COMMIT_SHA, ...result,
      }));
      }
      await writeFile(join(directory, 'confirmed'), 'ok', { flag: 'wx', mode: 0o600 });
    } else {
      const until = Date.now() + 120000;
      let ready = false;
      while (Date.now() < until) {
        try { ready = await readFile(join(directory, 'confirmed'), 'utf8') === 'ok'; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (ready) break;
        try {
          await readFile(join(directory, 'unconfirmed'), 'utf8');
          throw Error('operator_phase_unconfirmed');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!ready) throw Error('operator_phase_unconfirmed');
      console.log('MEMBERSHIP_OWNER_SHARED_PHASE_CONFIRMED');
    }
  } catch (error) {
    if (leader) await writeFile(join(directory, 'unconfirmed'), 'unconfirmed', { mode: 0o600 }).catch(() => {});
    console.error('MEMBERSHIP_OWNER_OPERATOR_UNCONFIRMED ' + (
      /^[a-z_]+$/.test(error?.message || '') ? error.message : 'unconfirmed'
    ));
    process.exitCode = 1;
  }
}
