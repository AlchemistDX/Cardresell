/* Local, advisory capture checks. A rectangular outline is not semantic card
 * recognition. Never authorizes a charge or blocks capture. No network calls. */
(function (root) {
  'use strict';
  function outline(data, w, h) {
    if (!data || data.length !== w * h * 4 || w < 32 || h < 32) return null;
    const n = w * h, gray = new Uint8Array(n);
    for (let i = 0; i < n; i++) gray[i] = .299 * data[i*4] + .587 * data[i*4+1] + .114 * data[i*4+2];
    const queue = new Int32Array(n), seen = new Uint8Array(n);
    let best = null;
    // Multiple thresholds handle light cards on dark surfaces and vice versa.
    for (const cut of [48, 88, 128, 168, 208]) for (const light of [false, true]) {
      seen.fill(0);
      for (let start = 0; start < n; start++) {
        if (seen[start]) continue;
        seen[start] = 1;
        if ((gray[start] >= cut) !== light) continue;
        let head = 0, tail = 1, x0 = w, y0 = h, x1 = 0, y1 = 0;
        queue[0] = start;
        while (head < tail) {
          const i = queue[head++], x = i % w, y = (i / w) | 0;
          x0 = Math.min(x0,x); x1 = Math.max(x1,x); y0 = Math.min(y0,y); y1 = Math.max(y1,y);
          const visit = j => { if (!seen[j]) { seen[j] = 1; if ((gray[j] >= cut) === light) queue[tail++] = j; } };
          if (x) visit(i-1); if (x+1<w) visit(i+1); if (y) visit(i-w); if (y+1<h) visit(i+w);
        }
        const bw = x1-x0+1, bh = y1-y0+1, area = bw*bh, ratio = bw/bh;
        // Front/back only: encourage an upright, straight-on photo. A clipped
        // outline is uncertain; it is not enough evidence to direct a crop.
        if (tail < 60 || area < n*.055 || area > n*.90 || ratio < .55 || ratio > .88 ||
            x0 < w*.05 || y0 < h*.05 || x1 > w*.95 || y1 > h*.95) continue;
        // Require a connected perimeter on ALL four sides, not just a box
        // around scattered texture. Ignore rounded corners and allow mild tilt.
        const rowsL=new Uint8Array(bh), rowsR=new Uint8Array(bh), colsT=new Uint8Array(bw), colsB=new Uint8Array(bw);
        const dx=Math.max(2,Math.round(bw*.08)), dy=Math.max(2,Math.round(bh*.06));
        for(let j=0;j<tail;j++) {
          const x=queue[j]%w-x0, y=((queue[j]/w)|0)-y0;
          if(x<=dx)rowsL[y]=1;if(x>=bw-1-dx)rowsR[y]=1;
          if(y<=dy)colsT[x]=1;if(y>=bh-1-dy)colsB[x]=1;
        }
        const coverage = a => {const pad=Math.ceil(a.length*.12);let sum=0;for(let j=pad;j<a.length-pad;j++)sum+=a[j];return sum/Math.max(1,a.length-2*pad);};
        const support=Math.min(coverage(rowsL),coverage(rowsR),coverage(colsT),coverage(colsB));
        if (support < .82) continue;
        // A filled patch alone is insufficient: each side needs a sustained
        // boundary contrast. This rejects smooth skin, shadows and gradients.
        const edge = (vertical, pos, lo, hi) => {
          let hits=0,total=0; const pad=Math.ceil((hi-lo)*.12), spread=vertical?dx:dy;
          for(let a=lo+pad;a<=hi-pad;a+=2) {
            let strongest=0;
            for(let b=Math.max(2,pos-spread);b<=Math.min((vertical?w:h)-3,pos+spread);b++) {
              const i=vertical?a*w+b:b*w+a, step=vertical?1:w;
              strongest=Math.max(strongest,Math.abs(gray[i-2*step]-gray[i+2*step]));
            }
            if(strongest>=18)hits++;total++;
          }
          return hits/Math.max(1,total);
        };
        const edgeSupport=Math.min(edge(true,x0,y0,y1),edge(true,x1,y0,y1),edge(false,y0,x0,x1),edge(false,y1,x0,x1));
        if(edgeSupport<.62)continue;
        const score=area*support*edgeSupport;
        if(!best || score>best.score)best={x:x0/w,y:y0/h,w:bw/w,h:bh/h,score};
      }
    }
    return best;
  }
  function advice(box, guide, quality, role) {
    if (role === 'edge') return {id:'edge',text:'Show this edge and both corners close up. Check focus before capturing.',kind:'neutral'};
    if (!box || !guide) return {id:'frame',text:'Place one card inside the guide with all four edges visible.',kind:'neutral'};
    if (box.x<guide.x-.025 || box.y<guide.y-.025 || box.x+box.w>guide.x+guide.w+.025 || box.y+box.h>guide.y+guide.h+.025)
      return {id:'fit',text:'Move back slightly or recenter to fit all four corners inside the guide.',kind:'warning'};
    if (box.w<guide.w*.70 || box.h<guide.h*.70)
      return {id:'small',text:'Move closer so the card fills the guide. Keep all four corners visible.',kind:'warning'};
    if (Math.abs(box.x+box.w/2-guide.x-guide.w/2)>guide.w*.12 || Math.abs(box.y+box.h/2-guide.y-guide.h/2)>guide.h*.12)
      return {id:'center',text:'Center the card inside the guide.',kind:'warning'};
    if (quality) return quality;
    return {id:'review',text:'Check that small text and every edge are clear before capturing.',kind:'neutral'};
  }
  function stable(previous, candidate) {
    const count=previous && previous.id===candidate.id ? previous.count+1 : 1;
    return {id:candidate.id,count,show:count>=3};
  }
  const api={outline,advice,stable};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.CardResellPhotoGuide=api;
})(typeof window==='undefined'?this:window);
