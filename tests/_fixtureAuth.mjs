// Draft/photo suites supply their own signed-in token and account fixtures.
// Loading real Firebase alongside those fixtures asynchronously signs the
// browser out, legitimately clears seller state, and makes assertions race
// the auth network. Auth behavior has dedicated integration suites; these
// tests must keep their fixture session for the workflow under examination.
export async function isolateFixtureAuth(context) {
  await context.route(/\/js\/auth\.[a-f0-9]+\.js(?:\?.*)?$/, route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: '// This test supplies authentication at the token/account boundary.',
  }));
}
