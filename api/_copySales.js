// Seller-entered sale receipts are permanent for this account. Deleting a
// report row or expiring a sync tombstone does not make its physical copy stock.
const invalid = message => Object.assign(new Error(message), {status:409, code:'copy_sale_conflict'});
const id = value => (typeof value === 'string' && value.length > 0 && value.length <= 1024) || (typeof value === 'number' && Number.isFinite(value));
export function copySales(previous, rows = []) {
 if (previous !== undefined && (!previous || previous.version !== 1 || !Array.isArray(previous.entries))) throw invalid('The saved sold-copy history needs review. No records were changed.');
 const copies = new Map(), sales = new Map();
 function add(copyId, saleId, recordedAt) {
  if (!id(copyId) || !id(saleId) || !Number.isFinite(recordedAt) || recordedAt <= 0) throw invalid('A sold-copy record is incomplete. No records were changed.');
  copyId=String(copyId);saleId=String(saleId);
  if (copies.has(copyId) && copies.get(copyId).saleId !== saleId || sales.has(saleId) && sales.get(saleId) !== copyId) throw invalid('More than one sale refers to the same physical copy, or a sale changed copies. Export a backup and review those records before syncing.');
  if (!copies.has(copyId)) copies.set(copyId,{copyId,saleId,recordedAt});
  sales.set(saleId,copyId);
 }
 for (const receipt of previous?.entries || []) add(receipt?.copyId,receipt?.saleId,receipt?.recordedAt);
 for (const row of rows) if (row?.sourceCollectionId != null) add(row.sourceCollectionId,row.id,Date.now());
 if (copies.size > 10000) throw Object.assign(invalid('The sold-copy history limit was reached. Your existing records are preserved.'),{status:413});
 return {version:1,entries:[...copies.values()]};
}
export function validateSaleLinks(receipts, rows) {
 const sales=new Map(receipts.entries.map(r=>[r.saleId,r.copyId]));
 for (const row of rows) if (sales.has(String(row?.id)) && sales.get(String(row.id)) !== String(row.sourceCollectionId)) throw invalid('A recorded sale cannot be reassigned to a different physical copy. No records were changed.');
}
export function unsoldCopies(rows, receipts) {
 const sold=new Set(receipts.entries.map(r=>r.copyId));
 return rows.filter(row=>!sold.has(String(row?.id)));
}
export async function availableCopy(kv, uid, instanceId) {
 if (typeof instanceId !== 'string' || !instanceId.startsWith('inst_col_')) throw invalid('Save this physical card to Collection and sync it before creating an eBay listing plan.');
 const key='userdata:'+uid,raw=await kv('GET',key);let data;
 try { data=raw?JSON.parse(raw):null; } catch { throw invalid('Cloud inventory could not be read. Retry collection sync before planning this listing.'); }
 if (!data || !Array.isArray(data.portfolio) || !Array.isArray(data.flips)) throw invalid('Sync this card to your account before saving its eBay listing plan.');
 const receipts=copySales(data.copySales,data.flips),copyId=instanceId.slice(9),matches=data.portfolio.filter(r=>String(r?.id)===copyId);
 if (receipts.entries.some(r=>r.copyId===copyId)) throw invalid('This physical copy has a recorded sale. It cannot enter another listing plan.');
 const row=matches[0],deletedAt=Number(data.tombstones?.portfolio?.[copyId])||0;
 if (matches.length!==1 || row.id==null || deletedAt && !(Number(row.updatedAt)>deletedAt) || row.quantity!=null && Number(row.quantity)!==1) throw invalid('This copy is missing, duplicated or grouped in cloud inventory. Review Collection and sync it before listing.');
 return {copyKey:key,copyRaw:raw};
}
