// Local, isolated Lua runtime. No TCP listener, credentials, existing database,
// production endpoint, or live service. Each process owns one private socket.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from 'redis';

const dir = mkdtempSync(join(tmpdir(), 'cr-id-billing-'));
const socket = join(dir, 'redis.sock');
const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket,
  '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: 'ignore' });
process.on('exit', () => server.kill('SIGTERM'));
for (let i = 0; !existsSync(socket) && i < 100; i++) await new Promise(r => setTimeout(r, 20));
if (!existsSync(socket)) throw new Error('isolated redis-server failed to start');
const client = createClient({ socket: { path: socket, reconnectStrategy: false } });
client.on('error', () => {});
await client.connect();
export async function redisCommand(args) {
  return client.sendCommand(args.map(String));
}
const sync = (...args) => JSON.parse(execFileSync('redis-cli', ['-s', socket, '--json', ...args.map(String)], { encoding: 'utf8' }));
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
  if (faults.before && (!faults.action || faults.action === action)) {
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
