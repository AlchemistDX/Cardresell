// Exercise the shell gate with isolated fake suites, never application services.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'cr-gate-check-'));
try {
  writeFileSync(join(dir, 'node'), `#!/bin/sh
if [ "$1" = tests/membership-environment.mjs ]; then
  case "$GATE_FAULT" in
    incomplete) exit 0;;
    partial) echo 'INCOMPLETE RUN -- SUITE COMPLETE, exit=0'; exit 0;;
    nonzero) echo 'SUITE COMPLETE, exit=0'; exit 1;;
    timeout) sleep 3;;
  esac
fi
echo '1 passed, 0 failed -- SUITE COMPLETE, exit=0'
`, {mode:0o755});
  for (const fault of ['none', 'incomplete', 'partial', 'nonzero', 'timeout']) {
    const result = spawnSync('bash', ['tools/run-membership-gate.sh', join(dir, fault)], {
      cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 15000,
      env: {...process.env, PATH: dir + ':' + process.env.PATH, GATE_FAULT: fault, SUITE_TIMEOUT:'1'},
    });
    assert.equal(result.status, fault === 'none' ? 0 : 1, fault + ': ' + result.stderr);
  }
  // The shared assertion harness must reject an early successful exit.
  const harnessUrl = new URL('../tests/_assert.mjs', import.meta.url).href;
  const early = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {harness} from ${JSON.stringify(harnessUrl)}; harness('early'); process.exit(0);`], {encoding:'utf8'});
  assert.equal(early.status, 1);
  console.log('6 passed, 0 failed -- SUITE COMPLETE, exit=0');
} finally { rmSync(dir, {recursive:true, force:true}); }
