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
        if (data[start*4+3]<250 || (gray[start] >= cut) !== light) continue;
        let head = 0, tail = 1, x0 = w, y0 = h, x1 = 0, y1 = 0;
        queue[0] = start;
        while (head < tail) {
          const i = queue[head++], x = i % w, y = (i / w) | 0;
          x0 = Math.min(x0,x); x1 = Math.max(x1,x); y0 = Math.min(y0,y); y1 = Math.max(y1,y);
          const visit = j => { if (!seen[j]) { seen[j] = 1; if (data[j*4+3]>=250 && (gray[j] >= cut) === light) queue[tail++] = j; } };
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
              if(data[(i-2*step)*4+3]<250 || data[(i+2*step)*4+3]<250)continue;
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
  // A localized bright hotspot is an advisory even when foil, glare or hands
  // defeat the outline check. Color alone is never called glare.
  function reflection(data,w,h) {
    if(!data || data.length!==w*h*4 || w<32 || h<32)return false;
    const n=w*h,g=new Float32Array(n),seen=new Uint8Array(n),q=new Int32Array(n);
    for(let i=0;i<n;i++)g[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];
    for(let start=0;start<n;start++) {
      if(seen[start] || g[start]<228)continue;
      let head=0,tail=1,x0=w,y0=h,x1=0,y1=0,sum=0,peak=0;
      q[0]=start;seen[start]=1;
      while(head<tail) {
        const i=q[head++],x=i%w,y=(i/w)|0;
        x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        sum+=g[i];peak=Math.max(peak,g[i]);
        const visit=j=>{if(!seen[j] && g[j]>=228){seen[j]=1;q[tail++]=j;}};
        if(x)visit(i-1);if(x+1<w)visit(i+1);if(y)visit(i-w);if(y+1<h)visit(i+w);
      }
      if(tail<Math.max(12,n*.0015) || tail>n*.20 || peak<238)continue;
      const pad=Math.max(4,Math.round(Math.min(w,h)*.06));let ring=0,count=0;
      for(let y=Math.max(0,y0-pad);y<=Math.min(h-1,y1+pad);y++)
        for(let x=Math.max(0,x0-pad);x<=Math.min(w-1,x1+pad);x++)
          if(x<x0 || x>x1 || y<y0 || y>y1){ring+=g[y*w+x];count++;}
      if(count && sum/tail-ring/count>35)return true;
    }
    return false;
  }
  // Scope quality analysis to an outline only when it substantially overlaps
  // the guide. This is a geometric candidate, not confirmed card identity.
  function qualityRegion(box, guide) {
    if(!guide)return null;
    if(box && [box.x,box.y,box.w,box.h].every(Number.isFinite) && box.w>0 && box.h>0) {
      const iw=Math.max(0,Math.min(box.x+box.w,guide.x+guide.w)-Math.max(box.x,guide.x));
      const ih=Math.max(0,Math.min(box.y+box.h,guide.y+guide.h)-Math.max(box.y,guide.y));
      if(iw*ih/(box.w*box.h)>=.8 && box.w>=guide.w*.5 && box.h>=guide.h*.5) {
        // Stay inside the border so slight skew / antialiasing do not pull
        // bright background pixels into the reflection measurement.
        if(Array.isArray(box.corners) && box.corners.length===4 && box.corners.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))) {
          const cx=box.corners.reduce((v,p)=>v+p.x,0)/4,cy=box.corners.reduce((v,p)=>v+p.y,0)/4;
          const q=box.corners.map(p=>({x:cx+(p.x-cx)*.92,y:cy+(p.y-cy)*.92}));
          const x=Math.min(...q.map(p=>p.x)),y=Math.min(...q.map(p=>p.y));
          const w=Math.max(...q.map(p=>p.x))-x,h=Math.max(...q.map(p=>p.y))-y;
          return {x,y,w,h,located:true,corners:q.map(p=>({x:(p.x-x)/w,y:(p.y-y)/h}))};
        }
        return {x:box.x+box.w*.04,y:box.y+box.h*.04,w:box.w*.92,h:box.h*.92,located:true};
      }
    }
    return {...guide,located:false};
  }
  // Resample only the inside of a convex four-corner candidate. Used for
  // advisory lighting/focus, never to alter uploaded photos or grade centering.
  function rectify(data,w,h,corners,outW,outH) {
    if(!data || data.length!==w*h*4 || !Array.isArray(corners) || corners.length!==4)return null;
    if(!corners.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return null;
    const out=new Uint8ClampedArray(outW*outH*4);
    for(let y=0;y<outH;y++)for(let x=0;x<outW;x++) {
      const u=(x+.5)/outW,v=(y+.5)/outH;
      const px=(1-v)*((1-u)*corners[0].x+u*corners[1].x)+v*((1-u)*corners[3].x+u*corners[2].x);
      const py=(1-v)*((1-u)*corners[0].y+u*corners[1].y)+v*((1-u)*corners[3].y+u*corners[2].y);
      const i=(Math.max(0,Math.min(h-1,Math.floor(py*h)))*w+Math.max(0,Math.min(w-1,Math.floor(px*w))))*4;
      const o=(y*outW+x)*4;out[o]=data[i];out[o+1]=data[i+1];out[o+2]=data[i+2];out[o+3]=data[i+3];
    }
    return out;
  }
  function reflectionHint(located=true) {
    return located
      ? {id:'reflection',kind:'warning',text:'Possible reflection on the card — adjust the light until details are clear.'}
      : {id:'lighting',kind:'warning',text:'Bright light in view — check whether it hides card details. Use even lighting.'};
  }
  // When geometry is uncertain, describe the view rather than claiming a
  // card was identified. Loss of an outline must not suppress darkness/blur.
  function qualityHint(sharp, q, located) {
    if (!q || !Number.isFinite(q.mean)) return {id:'analysis',kind:'warning',text:'Live checks unavailable — check focus and lighting yourself, or reopen the camera.'};
    if (q.mean < 42) return {id:'dark',kind:'warning',text:located
      ? 'Add even light so the card details are visible.'
      : 'View is too dark — uncover the lens or add even light.'};
    if (q.mean > 220) return {id:'bright',kind:'warning',text:'View is too bright — use softer, indirect light.'};
    if (q.glare > .020) return reflectionHint(located);
    if (sharp == null) return {id:'unknown',kind:'warning',text:located
      ? 'Cannot assess focus. Check small text and card edges yourself.'
      : 'Not enough detail to check focus — show the whole card and keep the lens clear.'};
    if (sharp < 14) return {id:'soft',kind:'warning',text:located
      ? 'Details look soft — hold steady and adjust distance until text is clear.'
      : 'View looks soft — hold steady and adjust distance. Keep all four corners visible.'};
    return null;
  }
  function advice(box, guide, quality, role) {
    if (role === 'edge') return {id:'edge',text:'Show this edge and both corners close up. Check focus before capturing.',kind:'neutral'};
    if (quality && (quality.id === 'reflection' || quality.id === 'lighting')) return quality;
    if (quality && ['dark','bright','analysis'].includes(quality.id)) return quality;
    if ((!box || !guide) && quality) return quality;
    if (!box || !guide) return {id:'frame',text:'Keep all four edges visible. Check text and reflections before capturing.',kind:'neutral'};
    if (box.x<guide.x-.025 || box.y<guide.y-.025 || box.x+box.w>guide.x+guide.w+.025 || box.y+box.h>guide.y+guide.h+.025)
      return {id:'fit',text:'Check framing — keep all four corners inside the guide and the phone parallel to the card.',kind:'neutral'};
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
  const api={outline,reflection,qualityRegion,rectify,reflectionHint,qualityHint,advice,stable};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.CardResellPhotoGuide=api;
})(typeof window==='undefined'?this:window);
