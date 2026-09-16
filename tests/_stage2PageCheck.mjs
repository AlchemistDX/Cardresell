import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { STAGE2_PATH } from '../api/_previewIdStage2.js';
import route from '../api/preview-id-authenticated-acceptance.js';
import debit from '../api/scan-debit-id.js';
import pro from '../api/pro-status.js';
// UI-only offline SDK fixture. The production auth.js runs unmodified and
// receives a synthetic SDK user; managed normal Firebase login is NOT proven.
export async function stage2PageCheck({ invoke, token, uid, email, check }) {
  const { chromium, devices } = (await import('/home/user/node_modules/playwright/index.js')).default;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const origin = 'https://' + process.env.VERCEL_URL;
  const root = resolve(new URL('..', import.meta.url).pathname);
  let apiWrites = [];
  await ctx.route('**/*', async intercepted => {
    const req = intercepted.request(), u = new URL(req.url());
    if (u.hostname === 'www.gstatic.com' && u.pathname.endsWith('firebase-app.js'))
      return intercepted.fulfill({ contentType: 'application/javascript', body: 'export const initializeApp=()=>({});' });
    if (u.hostname === 'www.gstatic.com' && u.pathname.endsWith('firebase-auth.js')) {
      const user = JSON.stringify({ uid, email, emailVerified: true, providerData: [{ providerId: 'password' }] });
      return intercepted.fulfill({ contentType: 'application/javascript', body: `
        const user={...${user},getIdToken:async()=>${JSON.stringify(token)},reload:async()=>{}};
        export const initializeAuth=()=>({currentUser:user});
        export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb(user),20);return ()=>{}};
        export const signOut=async()=>{},signInWithPopup=async()=>{},createUserWithEmailAndPassword=async()=>{},
        signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async()=>{},sendEmailVerification=async()=>{};
        export class GoogleAuthProvider{}
        export const indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},browserPopupRedirectResolver={};
      ` });
    }
    if (u.origin === origin && [STAGE2_PATH, '/api/scan-debit-id', '/api/pro-status'].includes(u.pathname)) {
      const body = req.method() === 'POST' ? req.postDataJSON() : null;
      if (req.method() === 'POST') apiWrites.push({ path: u.pathname, action: body?.action });
      const result = await invoke(u.pathname === STAGE2_PATH ? route : u.pathname.endsWith('pro-status') ? pro : debit,
        body, { method: req.method(), url: u.pathname, headers: { ...req.headers(), host: u.host } });
      return intercepted.fulfill({ status: result.statusCode, headers: result.headers,
        body: typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload) });
    }
    if (u.origin === origin && !u.pathname.startsWith('/api/')) {
      try {
        const file = resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
        if (!file.startsWith(root + '/')) throw Error();
        return intercepted.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : 'text/html',
          body: readFileSync(file) });
      } catch (_) { return intercepted.fulfill({ status: 404, body: '' }); }
    }
    return intercepted.abort('blockedbyclient');
  });
  try {
    const page = await ctx.newPage();
    await page.goto(origin + STAGE2_PATH);
    await page.waitForFunction(() => document.getElementById('app').contentWindow._fbAuth?.currentUser
      && typeof document.getElementById('app').contentWindow._renderIdentityConfirmation === 'function');
    check('protected page CSP allows unchanged picker and auth module in same-origin frame', true);
    check('loading protected UI creates no setup or acceptance POST', apiWrites.length === 0);
    await page.locator('#attest').check();
    await page.locator('#bind').click();
    await page.waitForFunction(() => document.getElementById('output').textContent.includes('"step": "idle"'));
    check('visible bind uses normal production auth module SDK session, not global injection', true);
    await page.locator('#next').click();
    const app = page.frameLocator('#app');
    await page.locator('#app').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/home/user/workspace/stage2-page-before-cancel.png', fullPage: true });
    await app.getByTestId('identity-cancel').click();
    check('real framed picker cancellation sends no debit POST', !apiWrites.some(x => x.path === '/api/scan-debit-id'));
    await page.locator('#next').click();
    await app.getByTestId('identity-more').click();
    await app.locator('[data-candidate-set="Synthetic Set 7"]').click();
    await page.waitForFunction(() => document.getElementById('app').contentWindow._scanCandidateDebitPending === false);
    await page.locator('#status').click();
    await page.waitForFunction(() => document.getElementById('output').textContent.includes('"canonicalSeventh": true'));
    check('actual framed shipped picker accepts seventh server-issued synthetic card', true);
    await page.locator('#duplicate').click();
    await page.waitForFunction(() => document.getElementById('output').textContent.includes('"duplicateResponses": 6'));
    check('visible duplicate control sends six same-selection handler requests', apiWrites.filter(x => x.path === '/api/scan-debit-id').length === 7);
    await page.locator('#status').click();
    await page.waitForFunction(() => document.getElementById('output').textContent.includes('"acceptedJournals": 1'));
    check('visible observation reports one journal after duplicate requests', true);
    const dir = '/home/user/workspace/stage2-protected-page-evidence';
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: dir + '/protected-page-seventh.png', fullPage: true });
    await page.locator('#cleanup').click();
    await page.waitForFunction(() => document.getElementById('output').textContent.includes('"financialKeysRemaining": 0'));
    check('visible cleanup removes credit fixtures and ends the embedded session UI', await page.locator('#output').textContent().then(t => t.includes('"controlRetained": true')));
  } finally { await browser.close(); }
}
