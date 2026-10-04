// Local, isolated Lua runtime. Each process owns a fresh store; no production
// endpoint or existing database. Unix socket by default; explicit loopback
// fallback uses a process-local random password, never service credentials.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';

const dir = mkdtempSync(join(tmpdir(), 'cr-id-billing-'));
const socket = join(dir, 'redis.sock');
// Explicit test-only fallback for hosts without Unix socket support. A random
// password prevents a port-allocation race from connecting to another store.
const tcp = process.env.CARDRESELL_TEST_REDIS_TCP === '1';
let port = 0;
const password = tcp ? randomBytes(32).toString('hex') : '';
if (tcp) {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
}
const server = spawn('redis-server', [...(tcp
  ? ['--bind', '127.0.0.1', '--port', String(port), '--requirepass', password]
  : ['--port', '0', '--unixsocket', socket]),
  '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: 'ignore' });
process.on('exit', () => server.kill('SIGTERM'));
for (let i = 0; i < 100; i++) {
  if (tcp) {
    try {
      if (execFileSync('redis-cli', ['-h', '127.0.0.1', '-p', String(port), 'PING'],
        { encoding: 'utf8', env: { ...process.env, REDISCLI_AUTH: password }, stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'PONG') break;
    } catch (_) {}
  } else if (existsSync(socket)) break;
  await new Promise(r => setTimeout(r, 20));
}
if (!tcp && !existsSync(socket)) throw new Error('isolated redis-server failed to start');
const client = createClient({ ...(tcp ? { password } : {}), socket: {
  ...(tcp ? { host: '127.0.0.1', port } : { path: socket }), reconnectStrategy: false,
} });
client.on('error', () => {});
await client.connect();
export async function redisCommand(args) {
  return client.sendCommand(args.map(String));
}
const sync = (...args) => JSON.parse(execFileSync('redis-cli', [
  ...(tcp ? ['-h', '127.0.0.1', '-p', String(port)] : ['-s', socket]), '--json', ...args.map(String)],
  { encoding: 'utf8', env: { ...process.env, ...(tcp ? { REDISCLI_AUTH: password } : {}) } }));
export function redisStore() {
  // Only this process's fresh database; used as a Map facade by old tests.
  sync('FLUSHDB');
  return {
    get: key => sync('GET', key),
    set: (key, val) => sync('SET', key, val),
    delete: key => sync('DEL', key),
    keys: () => sync('KEYS', '*'),
  };
}
export async function redisRest(input, init = {}, commands = [], faults = {}) {
  const u = new URL(String(input?.url || input));
  const args = init.body ? JSON.parse(init.body)
    : u.pathname.slice(1).split('/').map(decodeURIComponent);
  const cmd = args[0].toLowerCase();
  if (u.searchParams.get('EX')) args.push('EX', u.searchParams.get('EX'));
  const action = cmd === 'eval' ? args[6] : undefined;
  commands.push({ cmd, key: cmd === 'eval' ? args[3] : args[1], value: args[2], action, args, ex: u.searchParams.get('EX') });
  if (faults.before && (!faults.action || faults.action === action)
      && (!faults.commands || faults.commands.includes(cmd))) {
    if (faults.before === 'redis') return Response.json({ error: 'ERR injected Redis failure' });
    if (faults.before === 'malformed') return Response.json({ result: 'not-json' });
    if (faults.before === 'missing') return Response.json({});
    if (faults.before === 'false-success') return Response.json({ result: '{"ok":true}' });
    throw new Error('injected transport failure before command');
  }
  try {
    const result = await redisCommand(args);
    if (faults.after && (!faults.action || faults.action === action)) {
      faults.after = false;
      throw new Error('response lost after Redis commit');
    }
    return Response.json({ result });
  } catch (error) {
    if (error.message.includes('response lost')) throw error;
    return Response.json({ error: error.message });
  }
}
