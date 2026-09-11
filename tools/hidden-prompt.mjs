import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

// Readline handles editing, but its output is discarded before reaching a TTY.
// Only the static prompt and final newline are written to the real output.
export function promptHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error('Interactive terminal required; input/output redirection refused.'));
  }
  return new Promise((resolve, reject) => {
    const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
    let settled = false;
    const finish = (err, answer) => {
      if (settled) return;
      settled = true;
      rl.close();
      muted.end();
      process.stdout.write('\n');
      if (err) reject(err); else resolve(answer);
    };
    rl.on('SIGINT', () => finish(new Error('Cancelled; no check performed.')));
    rl.on('close', () => { if (!settled) finish(new Error('Input closed; no check performed.')); });
    process.stdout.write(question);
    rl.question('', answer => finish(null, answer));
  });
}
