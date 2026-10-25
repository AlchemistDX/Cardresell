// Photo-focused browser suites assume a separately verified, clear scan copy.
// Real Redis, owner boundaries and races are covered by listing-availability.
export function clearListingAvailability(body) {
 if(!Array.isArray(body.drafts)||body.drafts.some(d=>!d.draftId||!Number.isInteger(d.rev)))throw Error('Photo fixture requires a saved draft revision');
 return {version:1,environment:'production',checkedAt:Date.now(),records:body.drafts.map(d=>({...d,copyId:null,instanceId:'scan_'+d.draftId,state:'untracked',canExport:true,label:'No saved eBay hold · copy not linked to Collection'}))};
}
