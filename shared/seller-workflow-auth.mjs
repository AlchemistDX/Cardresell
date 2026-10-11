/* Adapter for the app's existing Firebase Auth instance. No second login,
 * stored token, plan badge or localStorage identity. This validates the SDK
 * session binding, not server authorization for Collection/draft mutations. */
export function workflowAuth({auth, onAuthStateChanged}) {
  let epoch = 0, closed = false;
  const listeners = new Set();
  const unsubscribe = onAuthStateChanged(auth, () => {
    epoch++;
    for (const listener of listeners) listener();
  });
  const current = () => auth.currentUser?.uid || null;
  return Object.freeze({
    current,
    subscribe(listener) {
      if (closed) throw new Error('WORKFLOW_ACCOUNT_CHANGED');
      listeners.add(listener); return () => listeners.delete(listener);
    },
    async verify() {
      if (closed) throw new Error('WORKFLOW_ACCOUNT_CHANGED');
      const user = auth.currentUser, generation = epoch;
      if (!user?.uid) throw new Error('WORKFLOW_SIGN_IN_REQUIRED');
      const result = await user.getIdTokenResult();
      if (closed || epoch !== generation || auth.currentUser !== user || current() !== user.uid)
        throw new Error('WORKFLOW_ACCOUNT_CHANGED');
      if (result?.claims?.sub !== user.uid) throw new Error('WORKFLOW_AUTH_UNCONFIRMED');
      // Never return/persist the token in the metadata journal or review UI.
      return {ownerId:user.uid, generation};
    },
    matches(principal) { return !closed && principal?.generation === epoch && principal?.ownerId === current(); },
    close() { if (closed) return; closed = true; epoch++; unsubscribe(); for (const listener of listeners) listener(); listeners.clear(); }
  });
}
