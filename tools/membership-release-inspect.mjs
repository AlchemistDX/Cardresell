// Ordinary builds do no additional work. Read-only inspection is optional.
// An explicit operator build may run apply/schedule only through the exact
// commit, pause, backup and revocation guards in transitionMembershipOwner.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const stage = process.env.MEMBERSHIP_OWNER_TRANSITION_STAGE;
if (stage || process.env.MEMBERSHIP_OWNER_READ_ONLY_INSPECT === 'enabled') {
  let directory, leader = false;
  try {
    if (stage && !['apply', 'schedule'].includes(stage)) throw Error('invalid_transition_stage');
    // Legacy Vercel builds invokes the root script per function. Coordinate
    // within this build only; durable financial authority stays in Redis.
    // An uncertain leader is never reset. A fresh build reconciles the same
    // durable import/command through the normal idempotent operator.
    if (!/^[a-z0-9-]+\.vercel\.app$/.test(process.env.VERCEL_URL || '')) throw Error('deployment_identity_required');
    const id = createHash('sha256').update(JSON.stringify([
      process.env.VERCEL_URL, process.env.VERCEL_GIT_COMMIT_SHA, stage || 'inspect',
    ])).digest('hex');
    directory = join(tmpdir(), 'cardresell-operator-' + id);
    try { await mkdir(directory, { mode: 0o700 }); leader = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (leader) {
      const { transitionMembershipOwner } = await import('./transition-membership-owner.mjs');
      const result = await transitionMembershipOwner({ stage: stage || 'inspect' });
      console.log((stage ? 'MEMBERSHIP_OWNER_OPERATOR ' : 'MEMBERSHIP_OWNER_READ_ONLY ') + JSON.stringify({
        commit: process.env.VERCEL_GIT_COMMIT_SHA, ...result,
      }));
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
