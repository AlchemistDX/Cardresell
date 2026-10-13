// Selected deletion against the real handler; synthetic auth and in-memory Upstash substitute.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'playwright';
const PORT = Number(process.env.CR_CARD_ACTIONS_PORT || 8336);
const B = `http://127.0.0.1:${PORT}`;
const SLOT = 'ebay:fixed-price';
const SHOTS = process.env.CR_SHOT_DIR || '/home/user/workspace/shots';

const T = harness('draft-selected-delete-browser');

/* Two spellings over the harness's `check`, so an equality failure prints both
   sides instead of the word "false". Neither adds a code path: both end in
   T.check, which is what counts the run. */
const eq = (name, actual, expected) =>
  T.check(name, Object.is(actual, expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const ok = (name, cond, hint) => T.check(name, !!cond, hint);

const srv = spawn('node', ['tools/dev-draft-server.mjs'], {
  cwd: ROOT, env: { ...process.env, DEV_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => { srvLog += d; });
srv.stderr.on('data', (d) => { srvLog += d; });
await new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (/dev-draft-server on /.test(srvLog)) { clearInterval(tick); resolve(); }
    else if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('dev server did not start: ' + srvLog)); }
  }, 100);
});
const shutdown = () => { try { srv.kill('SIGKILL'); } catch (_) {} };
process.on('exit', shutdown);

const tokenFor = async (sub) =>
  (await (await fetch(`${B}/__devtoken?sub=${encodeURIComponent(sub)}`)).json()).token;

const CARD = { name: 'Charizard VMAX', set: 'Champions Path', number: '074/073', game: 'pokemon' };

async function apiCreate(sub, instanceId, key, over = {}) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'Idempotency-Key': key },
    body: JSON.stringify({ card: CARD, instanceId, slot: SLOT, price: 32.84, priceSource: 'comp', ...over }),
  });
  const j = await r.json().catch(() => ({}));
  const id = (j.draft && j.draft.draftId) || j.draftId || null;
  if (!id) throw new Error(`seed create failed: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return { status: r.status, id };
}

async function apiRead(sub, id) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts?id=${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  const d = j.draft || {};
  return { status: r.status, code: j.code, rev: d.rev, price: d.price, title: d.title,
           priceSource: d.priceSource, packet: j.packet || null };
}

async function apiPatch(sub, id, rev, body) {
  const tok = await tokenFor(sub);
  const r = await fetch(`${B}/api/drafts?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, 'Idempotency-Key': `seed-${id}-r${rev}` },
    body: JSON.stringify({ expectedRev: rev, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, rev: j.draft && j.draft.rev };
}

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch({ executablePath: process.env.CR_CHROMIUM, args: ['--no-sandbox'] });

async function boot({ sub, collection = [], viewport = { width: 1280, height: 900 } } = {}) {
  const tok = await tokenFor(sub);
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((rows) => {
    try { localStorage.setItem('cardsell_portfolio', JSON.stringify(rows)); } catch (_) {}
  }, collection);

  const wire = [];
  let plan = null;
  await page.route('**/api/drafts*', async (route) => {
    const req = route.request();
    const rec = {
      method: req.method(),
      url: req.url(),
      key: (await req.allHeaders())['idempotency-key'] || null,
      body: req.postData() || null,
    };
    wire.push(rec);
    if (plan) {
      const verdict = await plan(rec, route, wire.length - 1);
      if (verdict === 'handled') return;
    }
    await route.continue();
  });

  await page.goto(`${B}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.renderDraftsView === 'function' && typeof window.switchView === 'function',
    { timeout: 20000 });
  await page.evaluate((t) => { window._crIdToken = async () => t; }, tok);
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.showToast;
    window.showToast = (m) => { window.__toasts.push(String(m)); try { if (orig) orig(m); } catch (_) {} };
  });
  return { ctx, page, wire, errors, setPlan: (fn) => { plan = fn; } };
}

/** Open the drafts list and wait for the rows to be painted. */
async function openList(page) {
  // switchView is the real entry point -- renderDraftsView alone paints rows
  // into a container the seller cannot see, and a click on an invisible button
  // is not the thing being tested.
  await page.evaluate(() => window.switchView('drafts'));
  await page.waitForFunction(
    () => window._draftsState && window._draftsState.loading === false,
    { timeout: 20000 },
  );
  await page.waitForTimeout(250);
}

const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const cardSel = (id) => `.draft-card[data-draft-id="${id}"]`;
const bodyOf = (rec) => { try { return JSON.parse(rec.body || '{}'); } catch (_) { return {}; } };
const patches = (wire) => wire.filter((r) => r.method === 'PATCH');
const deletes = (wire) => wire.filter((r) => r.method === 'DELETE');

const select = (page, id) => page.locator(`[data-draft-select="${id}"]`).check();
const ask = page => page.locator('[data-draft-delete-selected]').click();
const confirm = page => page.locator('[data-draft-delete-selected-go]').click();
const finished = page => page.waitForFunction(() => window._draftsState.bulk?.phase === 'done');
async function seed(sub, count) {
  const ids = [];
  for (let i=0;i<count;i++) ids.push((await apiCreate(sub, `inst-${i}`, `selected-${sub}-${i}-00000000`)).id);
  return ids;
}
try {
  await T.section('Cancel, exact selected IDs, revisions, duplicate confirmation and mobile layout', async () => {
    const sub = 'selected-success', ids = await seed(sub,3);
    const {ctx,page,wire,errors} = await boot({sub,viewport:{width:390,height:844}});
    await openList(page);
    await select(page,ids[0]); await select(page,ids[2]); await ask(page);
    ok('confirmation states exact count', await page.getByText('Delete 2 selected drafts permanently?', {exact:true}).isVisible());
    await page.locator('[data-draft-delete-selected-cancel]').click();
    eq('cancel sends no DELETE',deletes(wire).length,0);
    eq('cancel preserves selection',await page.evaluate(()=>window._draftsState.selected.size),2);
    await ask(page);
    await page.evaluate(()=>{ document.querySelector('[data-draft-delete-selected-go]').click(); window._draftDeleteSelectedGo(); });
    await finished(page);
    eq('exactly two DELETE requests',deletes(wire).length,2);
    ok('only selected IDs deleted',deletes(wire).every(r=>[ids[0],ids[2]].includes(new URL(r.url).searchParams.get('id'))));
    ok('revision and idempotency present',deletes(wire).every(r=>bodyOf(r).expectedRev===1 && !!r.key));
    eq('unselected survives server read',(await apiRead(sub,ids[1])).status,200);
    eq('selected gone on server',(await apiRead(sub,ids[0])).status,410);
    eq('server total refreshed',await page.evaluate(()=>window._draftsState.total),1);
    ok('mobile no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await select(page,ids[1]); await ask(page); await confirm(page); await finished(page);
    ok('success stays visible after final draft deleted',await page.getByText('1 of 1 selected drafts deleted.',{exact:true}).isVisible());
    eq('authoritative empty count',await page.evaluate(()=>window._draftsState.total),0);
    eq('no browser errors',errors.length,0);
    await ctx.close();
  });
  await T.section('Revision conflict stops batch and retains failed/unattempted selection', async () => {
    const sub='selected-conflict', ids=await seed(sub,3);
    const {ctx,page,wire}=await boot({sub}); await openList(page);
    for (const id of ids) await select(page,id);
    await apiPatch(sub,ids[1],1,{price:44});
    await ask(page); await confirm(page); await finished(page);
    eq('stops after conflicting second draft',deletes(wire).length,2);
    eq('first removed',(await apiRead(sub,ids[0])).status,410);
    eq('conflicting draft survives',(await apiRead(sub,ids[1])).status,200);
    eq('unattempted survives',(await apiRead(sub,ids[2])).status,200);
    eq('remaining selected',await page.evaluate(()=>window._draftsState.selected.size),2);
    ok('partial failure reported',await page.getByRole('status').filter({hasText:'1 of 3 selected drafts deleted. Stopped.'}).isVisible());
    await ctx.close();
  });
  await T.section('Lost response reconciles and a changed selection invalidates confirmation',async()=>{
    const sub='selected-lost',ids=await seed(sub,2);
    const {ctx,page,wire,setPlan}=await boot({sub});await openList(page);
    await select(page,ids[0]); await ask(page); await select(page,ids[1]);
    eq('selection change closes confirmation',await page.locator('[data-draft-delete-selected-go]').count(),0);
    let dropped=false;
    setPlan(async(rec,route)=>{if(rec.method==='DELETE'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');return 'handled';}});
    await ask(page);await confirm(page);await finished(page);
    eq('both deleted after reconciliation',await page.evaluate(()=>window._draftsState.bulk.done),2);
    eq('no duplicate DELETE after lost response',deletes(wire).length,2);
    await ctx.close();
  });
  await T.section('Missing revision is blocked and refresh failure preserves known outcome',async()=>{
    const sub='selected-refresh',ids=await seed(sub,2);
    const {ctx,page,wire,setPlan}=await boot({sub});await openList(page);await select(page,ids[0]);
    await page.evaluate(id=>{window._draftsState.rows.find(r=>r.draftId===id).summary.rev=null;},ids[0]);
    await ask(page);
    eq('missing revision cannot open confirmation',await page.locator('[data-draft-delete-selected-go]').count(),0);
    eq('missing revision sends no DELETE',deletes(wire).length,0);
    await page.evaluate(id=>{window._draftsState.rows.find(r=>r.draftId===id).summary.rev=1;},ids[0]);
    setPlan(async(rec,route)=>{if(rec.method==='GET'&&!new URL(rec.url).searchParams.has('id')){await route.fulfill({status:503,json:{error:'Synthetic failure'}});return 'handled';}});
    await ask(page);await confirm(page);await finished(page);
    eq('successful deletion retained',await page.evaluate(()=>window._draftsState.bulk.done),1);
    eq('stale total cleared',await page.evaluate(()=>window._draftsState.total),null);
    ok('asks for refresh after count read failure',await page.getByRole('status').filter({hasText:'Refresh drafts to update the list and count.'}).isVisible());
    eq('unselected draft still exists',(await apiRead(sub,ids[1])).status,200);
    await ctx.close();
  });
  await T.section('Account change during token acquisition cannot issue delete',async()=>{
    const sub='selected-owner',ids=await seed(sub,1);
    const {ctx,page,wire}=await boot({sub});await openList(page);await select(page,ids[0]);await ask(page);
    await page.evaluate(()=>{window._crIdToken=async()=>{window.googleUser={sub:'different-owner'};return 'synthetic-other-token';};});
    await confirm(page);
    await page.waitForFunction(()=>window._draftsState.bulk===null);
    eq('no DELETE under changed owner',deletes(wire).length,0);
    eq('draft intact',(await apiRead(sub,ids[0])).status,200);
    await ctx.close();
  });
} finally { await browser.close(); shutdown(); }
T.done();
