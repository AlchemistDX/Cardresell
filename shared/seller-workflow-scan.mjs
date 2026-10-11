/* Bridge to the existing scan vocabulary; still dormant in production.
 * Pass the real _bulkCopyUids and _bulkScanRowToCard helpers. They keep scan
 * draft IDs; this adapter allocates Collection IDs inside one storage commit.
 * This does NOT grant eligibility, review identity or save any inventory. */
import {createSession, serializeSession, restoreSession, MAX_SESSION_COPIES} from './seller-workflow.mjs';
const fail = code => { throw new Error(code); };
const text = value => value == null ? '' : String(value);

export function captureScanSelection({rows, copyUids, rowToCard, costsByCopy = {}}) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_SESSION_COPIES) fail('WORKFLOW_INVALID_SIZE');
  const quantities = rows.map(row => {
    if (!row || row.success !== true) fail('WORKFLOW_SCAN_UNRESOLVED');
    const qty = row.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_SESSION_COPIES) fail('WORKFLOW_INVALID_SIZE');
    return qty;
  });
  if (quantities.reduce((a,b)=>a+b,0) > MAX_SESSION_COPIES) fail('WORKFLOW_INVALID_SIZE');
  const units = rows.flatMap((row, i) => {
    const ids = copyUids(row).slice(0, quantities[i]);
    if (ids.length !== quantities[i]) fail('WORKFLOW_MISSING_COPY_ID');
    const card = rowToCard(row);
    const metadata = {name:text(card.card), game:text(card.game), setName:text(card.set),
      setCode:text(card.setCode), number:text(card.number), condition:text(card.condition),
      // Missing language/finish stays unknown; no English/nonfoil assumption.
      // row.variant is a PRICE source label (e.g. "usd"/"tcgplayer_live")
      // on today's scanner. It cannot be reinterpreted as a printing finish.
      language:text(card.language ?? row.language), variant:text(card.variant),
      grader:text(card.grader), grade:text(card.grade)};
    return ids.map(copyId => ({copyId, instanceId:'inst_scan_' + copyId, card:metadata,
      costCents:Object.hasOwn(costsByCopy, copyId) ? costsByCopy[copyId] : null}));
  });
  // Reuse the canonical whitelist, identity, byte and cost validation now,
  // before any storage or Collection-ID allocation. Placeholder IDs are not
  // returned or stored. Unknown/zero costs retain their separate meanings.
  const checked = createSession({id:'validate',ownerId:'validate',now:0,
    units:units.map((u,i)=>({...u,collectionId:'validate_'+i}))});
  if (Object.keys(costsByCopy).some(id => !units.some(u => u.copyId === id))) fail('WORKFLOW_COST_COPY_MISMATCH');
  return checked.units.map(({copyId,instanceId,card,costCents}) => ({copyId,instanceId,card,costCents}));
}

export async function prepareScanSession({store, sessionId, selection, newCollectionId, now}) {
  // Snapshot before the first await. A UI edit during persistence cannot alter
  // either the request or the recovered payload.
  const incoming = createSession({id:sessionId, ownerId:store.ownerId, now,
    units:selection.map((u,i)=>({...u,collectionId:'validate_'+i}))});
  const comparable = s => JSON.stringify(s.units.map(({copyId,instanceId,card,costCents}) =>
    ({copyId,instanceId,card,costCents})).sort((a,b)=>a.copyId.localeCompare(b.copyId)));
  return store.initialize(sessionId,
    () => createSession({id:sessionId,ownerId:store.ownerId,now,
      units:incoming.units.map(u=>({...u,collectionId:newCollectionId()}))}),
    existing => { if (comparable(existing) !== comparable(incoming)) fail('WORKFLOW_SELECTION_CHANGED'); });
}

export function plannedScanActions(session) {
  // A read-only view of journal state, not a server capacity/eligibility claim.
  const canonical = restoreSession(serializeSession(session), session.ownerId);
  return canonical.units.map(u => ({copyId:u.copyId,collectionId:u.collectionId,instanceId:u.instanceId,
    name:u.card.name,game:u.card.game,costCents:u.costCents,requiresReview:u.review !== 'confirmed',
    saveState:u.operations.save?.state ?? 'not_started',draftState:u.operations.draft?.state ?? 'not_started'}));
}
