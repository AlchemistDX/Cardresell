/* Comparable price evidence. Asking prices, aggregate averages and guide
   values are different instruments; none is a promised sale or profit. */
(() => {
  'use strict';
  const conditions={nm:'near_mint',lp:'lightly_played',mp:'moderately_played',hp:'heavily_played',dmg:'damaged'};
  const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;
  const cents=value=>Math.round(value*100)/100;
  function assess({row={},key='',condition='nm',graded=false,sourceUpdatedAt=null,multiplier=1,now=Date.now()}={}) {
    row=row&&typeof row==='object'?row:{};
    const rawStamp=typeof sourceUpdatedAt==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(sourceUpdatedAt)?Date.parse(sourceUpdatedAt):NaN;
    const calendar=typeof sourceUpdatedAt==='string'?sourceUpdatedAt.slice(0,10):'';
    const validCalendar=/^\d{4}-\d{2}-\d{2}$/.test(calendar)&&Number.isFinite(Date.parse(calendar))&&new Date(calendar).toISOString().slice(0,10)===calendar;
    const dated=validCalendar&&Number.isFinite(rawStamp)&&rawStamp<=now;
    const ageDays=dated?(now-rawStamp)/86400000:null;
    const stale=ageDays!==null&&ageDays>7;
    const sourceDate=dated?new Date(rawStamp).toISOString().slice(0,10):null;
    const exactCondition=!graded&&key===conditions[condition]&&multiplier===1;
    const reference=positive(row.market);
    const average=row.ebaySalesAverage;
    const matches=graded?/^(psa|bgs|cgc|ace|tag|sgc)_\d+(?:_\d+)?$/.test(key):exactCondition;
    const salesAverage=matches&&positive(average?.value)&&[1,7,30].includes(average?.days)?{value:average.value,days:average.days}:null;
    const low=positive(row.low),high=positive(row.high);
    const comparable=exactCondition&&row.lowBasis==='tcgplayer'&&row.highBasis==='tcgplayer'&&!row.highClamped;
    const range=comparable&&low!==null&&high!==null&&cents(low)>0&&cents(low)<cents(high)?{low:cents(low),high:cents(high),kind:'ask',source:'TCGplayer'}:null;
    const usableRange=range&&dated&&!stale?range:null;
    let note=graded?'One reference for this grade is not a measured sale-price range.':
      !exactCondition?'No condition-specific range is available for this selection. Condition adjustments are estimates.':
      !range?'The provider did not supply a usable asking range for this condition.':
      stale?'This asking range is over 7 days old. Refresh price research before using it.':
      !dated?'The provider did not supply a usable update date. This range is for reference only.':
      'Asking prices for the selected condition, not completed sales. Shipping and sale timing are not established.';
    return {reference,range,usableRange,salesAverage,sourceDate,ageDays,stale,note};
  }
  function tiers(evidence) {
    const range=evidence?.usableRange;if(!range)return null;
    const choices=[{id:'ask-low',amt:cents(range.low),label:'Listed low',hint:'Reported TCGplayer low for this condition; not a fast-sale guarantee',observedAsk:true}];
    // Round before comparing so a near-endpoint reference cannot hide the
    // actual listed high when duplicate display amounts are removed.
    const reference=positive(evidence.reference)===null?null:cents(evidence.reference);
    if(reference>range.low&&reference<range.high)choices.push({id:'ask-reference',amt:cents(reference),label:'Reference',hint:'Selected provider reference; not the midpoint of the range',observedAsk:true});
    choices.push({id:'ask-high',amt:cents(range.high),label:'Listed high',hint:'Reported TCGplayer high for this condition; not an expected sale',observedAsk:true});
    const unique=choices.filter((row,i)=>choices.findIndex(other=>other.amt===row.amt)===i);
    return unique.length>=2?unique:null;
  }
  window.CardResellPriceEvidence={assess,tiers};
})();
