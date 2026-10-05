const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const authPath = html.match(/src="\/(js\/auth\.[a-f0-9]+\.js)"/)[1];
const authSource = fs.readFileSync(path.join(root, authPath), 'utf8');
const helper = authSource.slice(authSource.indexOf('window._fbSendVerification ='), authSource.indexOf('window._fbReloadUser ='));
const uiPath = html.match(/src="\/(js\/ui\.[a-f0-9]+\.js)"/)[1];
const ui = fs.readFileSync(path.join(root, uiPath), 'utf8');
const resend = ui.slice(ui.indexOf('async function doAuthResendVerification()'), ui.indexOf('async function doAuthCheckVerified()'));
const corePath = html.match(/src="\/(js\/core\.[a-f0-9]+\.js)"/)[1];
const core = fs.readFileSync(path.join(root, corePath), 'utf8');
const legacy = core.slice(core.indexOf('async function _verifySendCode()'), core.indexOf('async function _verifyConfirmCode()'));
function setup(codes = [], user = {}) {
  const elements = new Map();
  const calls = [];
  const context = {
    window: { _googleIdToken: 'synthetic-token' }, auth: { currentUser: user },
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', value: 'test@example.invalid' });
      return elements.get(id);
    } },
    console: { warn() {}, error() {} }, setTimeout() {},
    _fbErrMsg: e => e.code,
    sendEmailVerification: async (...args) => {
      calls.push(args);
      const code = codes.shift();
      if (code) throw Object.assign(new Error(code), { code });
    },
    fetch: async () => ({ json: async () => ({ fallback: 'firebase_link' }) }),
  };
  vm.createContext(context);
  vm.runInContext(helper + resend + legacy, context);
  return { context, elements, calls };
}
(async () => {
  let s = setup();
  assert.equal((await s.context.window._fbSendVerification()).ok, true);
  assert.equal(s.calls.length, 1);
  s = setup(['auth/unauthorized-continue-uri']);
  assert.equal((await s.context.window._fbSendVerification()).withReturn, false);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].length, 1);
  for (const code of ['auth/too-many-requests', 'auth/network-request-failed', 'auth/internal-error']) {
    s = setup([code]);
    await assert.rejects(s.context.window._fbSendVerification(), e => e.code === code);
    assert.equal(s.calls.length, 1);
    assert.equal(s.elements.get('authVerifyError').style.display, '');
    assert.equal(s.elements.get('authVerifySuccess').style.display, 'none');
    s = setup([code]);
    await s.context.doAuthResendVerification();
    assert.equal(s.elements.get('authVerifySuccess').textContent, '');
    assert.equal(s.elements.get('authVerifyError').textContent, code);
    assert.equal(s.elements.get('authVerifyResendBtn').disabled, false);
    s = setup([code]);
    await s.context._verifySendCode();
    assert.equal(s.elements.has('verifyModalSubtitle'), false, 'legacy flow must not render sent state after failure');
    assert.equal(s.elements.get('verifyEmailErr').style.display, '');
    assert.equal(s.elements.get('verifySendBtn').disabled, false);
  }
  s = setup(['auth/unauthorized-continue-uri', 'auth/too-many-requests']);
  await assert.rejects(s.context.window._fbSendVerification(), e => e.code === 'auth/too-many-requests');
  s = setup([], null);
  await assert.rejects(s.context.window._fbSendVerification(), e => e.code === 'auth/user-not-found');
  assert.equal(s.calls.length, 0);
  assert.ok(!html.includes('We sent a verification link to <strong id="authVerifyEmail"'));
  console.log('PASS: verification send acceptance, rejection, bounded fallback, and both resend callers');
})().catch(e => { console.error(e); process.exitCode = 1; });
