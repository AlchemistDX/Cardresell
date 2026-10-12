/* Device-local metadata only. No provider, Collection, draft or billing writes.
 * Await transaction completion before dispatching a prepared operation. A tab
 * revision is NOT a server lock: reconciliation still uses server receipts.
 * getOwnerId must read the current verified auth identity, not a UI plan badge. */
import {restoreSession, serializeSession, sessionStorageKey,
  reviewUnit, beginOperation, settleOperation, resumeOperation} from './seller-workflow.mjs';

export const WORKFLOW_DB = 'cardresell-seller-workflow';
export const MAX_STORED_SESSIONS = 25;
const STORE = 'sessions';
const COPIES = 'copies';
const actions = {review:reviewUnit, begin:beginOperation, settle:settleOperation, resume:resumeOperation};
const fail = code => { throw new Error(code); };
function storageError(error) {
  if (error?.message?.startsWith('WORKFLOW_')) return error;
  return new Error(error?.name === 'QuotaExceededError' ? 'WORKFLOW_STORAGE_FULL' :
    error?.name === 'ConstraintError' ? 'WORKFLOW_IDENTITY_CONFLICT' :
    error?.name === 'VersionError' ? 'WORKFLOW_STORAGE_VERSION' : 'WORKFLOW_STORAGE_FAILED');
}
const sync = value => {
  if (value?.then) fail('WORKFLOW_ASYNC_TRANSACTION');
  return value;
};

export async function openWorkflowStore({ownerId, getOwnerId, indexedDB = globalThis.indexedDB,
  keyRange = globalThis.IDBKeyRange, databaseName = WORKFLOW_DB}) {
  const key = id => sessionStorageKey(ownerId, id);
  const prefix = key('_').slice(0, -1);
  const assertOwner = () => {
    if (typeof getOwnerId !== 'function' || getOwnerId() !== ownerId) fail('WORKFLOW_ACCOUNT_CHANGED');
  };
  assertOwner();
  if (!indexedDB || !keyRange) fail('WORKFLOW_STORAGE_UNAVAILABLE');
  const range = keyRange.bound(prefix, prefix + '\uffff');
  let closed = false;
  const db = await new Promise((resolve, reject) => {
    let request, finished = false;
    const stop = error => { finished = true; reject(storageError(error)); };
    try { request = indexedDB.open(databaseName, 1); } catch (error) { stop(error); return; }
    request.onblocked = () => stop(new Error('WORKFLOW_STORAGE_BLOCKED'));
    request.onerror = () => stop(request.error);
    request.onupgradeneeded = () => {
      if (finished) { request.transaction.abort(); return; }
      request.result.createObjectStore(STORE);
      const copies = request.result.createObjectStore(COPIES);
      copies.createIndex('collection', ['ownerId','collectionId'], {unique:true});
      copies.createIndex('instance', ['ownerId','instanceId'], {unique:true});
    };
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      try { assertOwner(); } catch (error) { request.result.close(); stop(error); return; }
      finished = true; resolve(request.result);
    };
  });
  db.onversionchange = () => { closed = true; db.close(); };
  db.onclose = () => { closed = true; };

  function decode(raw, sessionId) {
    const session = restoreSession(raw, ownerId);
    if (session.id !== sessionId) fail('WORKFLOW_STORAGE_KEY_MISMATCH');
    return session;
  }
  // Callbacks are synchronous and restricted to journal construction/validation.
  // No await (including fetch) belongs inside an IndexedDB transaction.
  function transaction(mode, work, withCopies = false) {
    return new Promise((resolve, reject) => {
      let tx, result, failure;
      try {
        assertOwner();
        if (closed) fail('WORKFLOW_STORAGE_CLOSED');
        tx = db.transaction(withCopies ? [STORE, COPIES] : STORE, mode, {durability:'strict'});
      } catch (error) { reject(storageError(error)); return; }
      const guard = fn => (...args) => {
        try { assertOwner(); sync(fn(...args)); }
        catch (error) { failure = storageError(error); tx.abort(); }
      };
      tx.onabort = () => reject(failure || storageError(tx.error));
      tx.onerror = event => { failure ||= storageError(event.target?.error || tx.error); };
      tx.oncomplete = () => {
        try { assertOwner(); resolve(result); } catch (error) { reject(error); }
      };
      guard(() => work(tx.objectStore(STORE), guard, value => { result = value; },
        withCopies ? tx.objectStore(COPIES) : null))();
    });
  }

  return Object.freeze({
    ownerId,
    read(sessionId) {
      const storageKey = key(sessionId);
      return transaction('readonly', (store, guard, done) => {
        const request = store.get(storageKey);
        request.onsuccess = guard(() => done(request.result === undefined ? null : decode(request.result, sessionId)));
      });
    },
    /* Competing tabs initialize the same session atomically. Only the winner
     * mints Collection IDs. Existing records are validated, never overwritten.
     * verifyExisting must reject a different selection/identity/cost snapshot. */
    initialize(sessionId, build, verifyExisting) {
      const storageKey = key(sessionId);
      return transaction('readwrite', (store, guard, done, copies) => {
        if (typeof build !== 'function' || typeof verifyExisting !== 'function') fail('WORKFLOW_INVALID_INITIALIZER');
        const request = store.get(storageKey);
        request.onsuccess = guard(() => {
          if (request.result !== undefined) {
            const session = decode(request.result, sessionId);
            sync(verifyExisting(structuredClone(session)));
            done(session); return;
          }
          const count = store.count(range);
          count.onsuccess = guard(() => {
            if (count.result >= MAX_STORED_SESSIONS) fail('WORKFLOW_SESSION_CAPACITY');
            const session = decode(serializeSession(sync(build())), sessionId);
            if (session.revision !== 0 || session.units.some(u => u.review !== 'pending' || u.operations.save || u.operations.draft))
              fail('WORKFLOW_INVALID_INITIALIZER');
            assertOwner();
            // A new session name cannot mint a second Collection identity for
            // an already assigned physical copy. Reservations and the session
            // commit together, or neither does. Resume the owning session.
            for (const unit of session.units) {
              const copyKey = key(unit.copyId);
              const lookup = copies.get(copyKey);
              lookup.onsuccess = guard(() => {
                if (lookup.result !== undefined) {
                  const error = new Error('WORKFLOW_COPY_ALREADY_ASSIGNED');
                  error.sessionId = lookup.result.sessionId;
                  throw error;
                }
                copies.add({ownerId,sessionId,collectionId:unit.collectionId,instanceId:unit.instanceId}, copyKey);
              });
            }
            store.add(serializeSession(session), storageKey);
            done(session);
          });
        });
      }, true);
    },
    transition(sessionId, {action, ...options}) {
      const storageKey = key(sessionId);
      // Freeze caller options before the asynchronous read; no mutable request.
      const captured = structuredClone(options);
      return transaction('readwrite', (store, guard, done) => {
        if (!Object.hasOwn(actions, action)) fail('WORKFLOW_INVALID_ACTION');
        if (Object.hasOwn(captured, 'ownerId') && captured.ownerId !== ownerId) fail('WORKFLOW_ACCOUNT_CHANGED');
        const request = store.get(storageKey);
        request.onsuccess = guard(() => {
          if (request.result === undefined) fail('WORKFLOW_SESSION_NOT_FOUND');
          const previous = decode(request.result, sessionId);
          const next = actions[action](previous, {...captured, ownerId});
          store.put(serializeSession(next), storageKey);
          done(next);
        });
      });
    },
    list() {
      return transaction('readonly', (store, guard, done) => {
        const sessions = [], damaged = [];
        const request = store.openCursor(range);
        request.onsuccess = guard(() => {
          const cursor = request.result;
          if (!cursor) { done({sessions, damaged}); return; }
          const sessionId = cursor.key.slice(prefix.length);
          try { sessions.push(decode(cursor.value, sessionId)); }
          catch (error) { damaged.push({id:sessionId, code:storageError(error).message}); }
          cursor.continue();
        });
      });
    },
    close() { closed = true; db.close(); }
  });
}
