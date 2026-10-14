/* Guided binder-page crops. No network or credit consumption before bulk confirmation. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  let source = null, generation = 0, busy = false;
  let cameraStream = null, cameraEpoch = 0, cameraActive = false;
  let anchor = null, drag = null, adjusting = false, touchMove = false;
  const moves = {left:[-.01,0],right:[.01,0],up:[0,-.01],down:[0,.01]};
  const edges = ['Left','Right','Top','Bottom'];
  const readMargins = () => edges.map(edge => Math.max(0,Math.min(40,Number(el('binder'+edge).value)||0))/100);
  function rectangle() { const [l,r,t,b] = readMargins(); return {x:l,y:t,w:1-l-r,h:1-t-b}; }
  function boundedRectangle(rect) {
    // Keep every crop inside original pixels; blank canvas never becomes a card.
    rect.w = Math.max(.2,Math.min(1,rect.w)); rect.h = Math.max(.2,Math.min(1,rect.h));
    rect.x = Math.max(Math.max(0,.6-rect.w),Math.min(Math.min(.4,1-rect.w),rect.x));
    rect.y = Math.max(Math.max(0,.6-rect.h),Math.min(Math.min(.4,1-rect.h),rect.y));
    return rect;
  }
  function saveRectangle(rect) {
    rect = boundedRectangle(rect);
    const next = [rect.x,1-rect.x-rect.w,rect.y,1-rect.y-rect.h].map(n=>Math.round(n*10000)/100);
    const before = readMargins();
    if (!next.some((n,i)=>Math.abs(n/100-before[i])>.00005)) return false;
    setMargins(next);
    marginsAuto = false;
    return true;
  }
  function releaseDrag() {
    const previous = drag; drag = null;
    const preview = el('binderPreview');
    if (previous && preview.hasPointerCapture?.(previous.id)) {
      try { preview.releasePointerCapture(previous.id); } catch (_) {}
    }
  }
  function setTouchMove(value) {
    touchMove = !!value && !!source && !cameraActive;
    el('binderPreview').classList.toggle('binder-move-active',touchMove);
    el('binderMovePhoto').setAttribute('aria-pressed',String(touchMove));
    el('binderMovePhoto').textContent = touchMove ? 'Cancel photo move' : 'Move photo';
  }
  function syncAlignment() {
    const unavailable = !source || cameraActive;
    const r = rectangle(), zoom = anchor ? anchor.w/r.w : 1;
    let movable = false;
    for (const button of el('binderAlignment').querySelectorAll('[data-binder-move]')) {
      const [dx,dy] = moves[button.dataset.binderMove];
      const next = boundedRectangle({...r,x:r.x-dx/zoom,y:r.y-dy/zoom});
      const blocked = Math.abs(next.x-r.x)<.00005 && Math.abs(next.y-r.y)<.00005;
      button.disabled = unavailable || blocked;
      button.title = blocked ? 'Photo edge reached. Zoom in to make room to move.' : button.getAttribute('aria-label');
      movable ||= !blocked;
    }
    // Crop encoding is cancellable. Do not disable the focused slider or
    // movement buttons while an earlier crop render is finishing.
    el('binderZoom').disabled = unavailable;
    el('binderResetFit').disabled = unavailable;
    el('binderMovePhoto').disabled = unavailable || (!movable && !touchMove);
    el('binderMoveHint').textContent = touchMove
      ? 'Drag the photo once. Lift your finger to return to scrolling.'
      : !movable && !unavailable
        ? 'Zoom in to make room to move the photo. Swiping on the photo scrolls the page.'
        : 'Swipe on the photo to scroll. Tap Move photo to drag once, or use the arrows.';
    for (const id of ['binderSelectAll','binderSelectNone']) el(id).disabled = busy || adjusting || unavailable;
    el('binderRotate').disabled = busy || unavailable;
  }
  function resetAlignment() {
    releaseDrag(); setTouchMove(false);
    anchor = null; adjusting = false;
    el('binderZoom').value = 100; el('binderZoomValue').textContent = '100%';
  }
  function paintPreview() {
    if (!source) return;
    const current = rectangle(); if (!anchor) anchor = {...current};
    el('binderZoom').max = Math.max(100,Math.min(250,Math.floor(Math.min(anchor.w,anchor.h)/.2*100)));
    const [cols,rows] = el('binderLayout').value.split(',').map(Number);
    const preview = el('binderPreview'); preview.hidden = false;
    const width=Math.min(900,source.width),height=Math.round(width*source.height/source.width);
    if(preview.width!==width || preview.height!==height) {preview.width=width;preview.height=height;}
    const ctx = preview.getContext('2d'), zoom = anchor.w/current.w;
    ctx.fillStyle='#111';ctx.fillRect(0,0,preview.width,preview.height);
    ctx.drawImage(source,(anchor.x-current.x*zoom)*preview.width,(anchor.y-current.y*zoom)*preview.height,preview.width*zoom,preview.height*zoom);
    ctx.strokeStyle='#f5ad27';ctx.lineWidth=2;
    for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) ctx.strokeRect((anchor.x+col*anchor.w/cols)*preview.width,(anchor.y+row*anchor.h/rows)*preview.height,anchor.w/cols*preview.width,anchor.h/rows*preview.height);
    el('binderAlignment').hidden=false;
    syncAlignment();
  }
  function invalidateAdjustment() {
    adjusting=true; ++generation; releaseCrops(true); updateCount(); paintPreview();
    message('Check the grid after moving the photo. Crop previews update when you release it.');
  }
  function finishAdjustment() {
    releaseDrag(); setTouchMove(false);
    const changed = adjusting; adjusting=false;
    if(changed && source) render(); else updateCount();
  }
  function movePhoto(dx,dy) {
    if(!source || cameraActive) return;
    const r=rectangle(), zoom=anchor ? anchor.w/r.w : 1;
    if(saveRectangle({...r,x:r.x-dx/zoom,y:r.y-dy/zoom})) {
      invalidateAdjustment(); finishAdjustment();
    }
  }
  function cameraGuide() {
    const video=el('binderCameraVideo'), grid=el('binderCameraGrid');
    if(!video.videoWidth || !video.videoHeight) return null;
    const [cols,rows]=el('binderLayout').value.split(',').map(Number);
    const width=Math.min(video.videoWidth*.8,video.videoHeight*.8*cols*.72/rows);
    const height=width*rows/(cols*.72), w=width/video.videoWidth,h=height/video.videoHeight;
    grid.style.cssText=`left:${(1-w)*50}%;top:${(1-h)*50}%;width:${w*100}%;height:${h*100}%;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)`;
    grid.replaceChildren(...Array.from({length:cols*rows},()=>document.createElement('span')));
    el('binderCapture').disabled=false;
    return [(1-w)*50,(1-w)*50,(1-h)*50,(1-h)*50];
  }
  function stopCamera() {
    ++cameraEpoch; cameraActive=false;
    cameraStream?.getTracks().forEach(track=>track.stop()); cameraStream=null;
    const video=el('binderCameraVideo'); video.pause(); video.srcObject=null;
    el('binderCamera').hidden=true; el('binderCapture').disabled=true;
    el('binderOpenCamera').disabled=false; updateCount();
  }
  async function startCamera() {
    if(busy || adjusting) return;
    stopCamera(); setTouchMove(false); const version=cameraEpoch; cameraActive=true; updateCount();
    el('binderOpenCamera').disabled=true; el('binderCamera').hidden=false;
    message('Opening camera. Match the page to the pocket guide.');
    try {
      if(!navigator.mediaDevices?.getUserMedia) throw Error('unsupported');
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:3024},height:{ideal:4032}}});
      if(version!==cameraEpoch) {stream.getTracks().forEach(t=>t.stop());return;}
      cameraStream=stream;const video=el('binderCameraVideo');video.srcObject=stream;
      await video.play(); if(version!==cameraEpoch) return;
      cameraGuide(); el('binderCamera').scrollIntoView({block:'nearest'});
    } catch (_) {
      if(version!==cameraEpoch) return;
      stopCamera();message('Camera unavailable or permission not granted. Choose the original binder photo from your camera roll instead.');
    }
  }
  async function capturePhoto() {
    const video=el('binderCameraVideo');
    if(!cameraStream || !video.videoWidth || !video.videoHeight || el('binderCapture').disabled) return;
    el('binderCapture').disabled=true; const version=cameraEpoch, margins=cameraGuide();
    el('binderCapture').disabled=true;
    const canvas=document.createElement('canvas'), scale=sourceScale(video.videoWidth,video.videoHeight);
    canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    try {
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const jpeg=await blob(canvas); if(version!==cameraEpoch) return;
      const captured=new File([jpeg],'binder-camera.jpg',{type:'image/jpeg'});
      // A retake replaces this page, keeping the rest of the reviewed batch.
      stopCamera();
      if(!pageQueue.length) {pageQueue=[captured];pageIdx=0;}
      else pageQueue[pageIdx]=captured;
      pageStates[pageIdx]=null;
      openPage(pageIdx,margins);
    } catch (_) { if(version===cameraEpoch) {el('binderCapture').disabled=false;message('Could not capture this frame. Try again or choose a camera-roll photo.');} }
    finally {canvas.width=canvas.height=1;}
  }
  let pockets = [], urls = [];
  // 2026-10-10: several pages per batch. The owner picked two binder photos and
  // only the first opened (the input took one file). Pages are reviewed one at
  // a time — each keeps its own grid fit and ticks — and every ticked pocket
  // goes to ONE bulk confirmation, so the credit quote still comes once.
  const MAX_PAGES = 10;
  let pageQueue = [], pageIdx = 0, pageStates = [], pageNote = '';
  let rotation = 0, pageError = false;
  const multiPage = () => pageQueue.length > 1;
  const otherPageFiles = () => pageStates.flatMap((state,index)=>index===pageIdx ? [] : state?.files || []);
  function rememberPage() {
    // Keep only selected JPEGs and small review settings. The full-resolution
    // canvas belongs to the current page and is released when navigating.
    pageStates[pageIdx]={
      files:pockets.filter(p=>p.selected).map(p=>p.file),
      selection:pockets.map(p=>p.selected),
      layout:el('binderLayout').value,rotation,margins:edges.map(edge=>el('binder'+edge).value),
      auto:marginsAuto,anchor:anchor ? {...anchor} : null,zoom:el('binderZoom').value,
    };
  }
  function hidePhoto() {
    el('binderAlignment').hidden=true;
    const preview=el('binderPreview');preview.width=preview.height=1;preview.hidden=true;
  }
  const message = text => { el('binderStatus').textContent = (multiPage() ? `Page ${pageIdx + 1} of ${pageQueue.length}. ` : '') + text + pageNote; };
  // 2026-10-10: local, free pocket analysis. A pocket holding a card has
  // printed edges, text and art; an empty sleeve over a page backing is
  // smooth even under glare. Only used to PRE-select pockets; the user still
  // reviews every tick and confirms the credit count.
  // Calibrated 2026-10-10 on 9 synthetic iPhone-size pages (dark, white and
  // gray backings, glare, blur, plain Energy cards): cards scored 21-54,
  // empty pockets 0.6-5, and untrimmed corner pockets ~10.
  const EMPTY_ENERGY = 12;
  const LAYOUT_KEY = 'cr_binder_layout';
  // iPhone Safari refuses canvases above ~16.7 MP (they draw blank), so the
  // working copy is capped by area as well as by its longest side.
  const MAX_SOURCE_SIDE = 6000, MAX_SOURCE_AREA = 12000000;
  const POCKET_PAD = .04;
  // 2026-10-10: the bulk queue's photo check rejects images under 400 px on
  // the short edge. Check the final padded, rounded JPEG dimensions so
  // review and the bulk queue enforce the same threshold before billing.
  const MIN_POCKET_EDGE = () => (window.CardResellPhotoQC && window.CardResellPhotoQC.MIN_SHORT_EDGE) || 400;
  // Real photos shared through Messages arrive around 1500 x 2000; at 3 x 3
  // that leaves ~500 px pockets, where the local matcher lost a card that the
  // full-size photo kept. Advise, never block.
  const SMALL_POCKET_EDGE = 700;
  function sourceScale(w, h) {
    return Math.min(1, MAX_SOURCE_SIDE / Math.max(w, h), Math.sqrt(MAX_SOURCE_AREA / (w * h)));
  }
  function cropGrid(cols, rows, margins) {
    const [left,right,top,bottom] = margins;
    const x = source.width * left, y = source.height * top;
    const width = source.width * (1-left-right), height = source.height * (1-top-bottom);
    const cellWidth = width / cols, cellHeight = height / rows, crops = [];
    for (let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
      const sx = Math.max(0, x+col*cellWidth-cellWidth*POCKET_PAD);
      const sy = Math.max(0, y+row*cellHeight-cellHeight*POCKET_PAD);
      const sw = Math.min(source.width, x+(col+1)*cellWidth+cellWidth*POCKET_PAD)-sx;
      const sh = Math.min(source.height, y+(row+1)*cellHeight+cellHeight*POCKET_PAD)-sy;
      const ratio = Math.min(1,1400/Math.max(sw,sh));
      crops.push({row,col,sx,sy,sw,sh,w:Math.round(sw*ratio),h:Math.round(sh*ratio)});
    }
    return {x,y,cellWidth,cellHeight,crops};
  }
  const readableGrid = grid => grid.crops.every(c => Math.min(c.w,c.h) >= MIN_POCKET_EDGE());
  function pocketStats(canvas) {
    const W = 48, H = 64, probe = document.createElement('canvas');
    probe.width = W; probe.height = H;
    const cx = canvas.width * .1, cy = canvas.height * .1;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, cx, cy, canvas.width * .8, canvas.height * .8, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    let sum = 0;
    for (let i = 0; i < W * H; i++) { g[i] = d[i*4] * .299 + d[i*4+1] * .587 + d[i*4+2] * .114; sum += g[i]; }
    const mean = sum / (W * H);
    let energy = 0, n = 0, varSum = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; varSum += (g[i] - mean) ** 2;
      if (x + 1 < W && y + 1 < H) { energy += Math.abs(g[i] - g[i+1]) + Math.abs(g[i] - g[i+W]); n++; }
    }
    probe.width = probe.height = 1;
    const result = { energy: energy / n, std: Math.sqrt(varSum / (W * H)), mean };
    result.looksEmpty = result.energy < EMPTY_ENERGY;
    return result;
  }
  window.CardResellBinder = { pocketStats, sourceScale, EMPTY_ENERGY, MAX_SOURCE_AREA, POCKET_PAD, SMALL_POCKET_EDGE, minPocketEdge: MIN_POCKET_EDGE };
  // 2026-10-10: auto-fit the grid to the cards. A real page photographed on
  // a couch (IMG_4652) did not fill the frame, so the default full-photo grid
  // cut across 2-4 cards per pocket. Find the band of columns and rows dense
  // with printed detail, and accept it only when it divides into portrait
  // pocket shapes. Otherwise (sparse outer column, all empty, odd photo)
  // leave the grid alone rather than guess.
  const FIT = { side: 360, block: 3, detail: 16, density: .45, mergeGap: .08, minCellAR: .66, maxCellAR: .86 };
  let marginsAuto = true;
  function fitGrid(canvas, cols, rows) {
    const k = FIT.side / Math.max(canvas.width, canvas.height);
    const w = Math.max(1, Math.round(canvas.width * k)), h = Math.max(1, Math.round(canvas.height * k));
    const probe = document.createElement('canvas'); probe.width = w; probe.height = h;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data; probe.width = probe.height = 1;
    const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = d[i*4] * .299 + d[i*4+1] * .587 + d[i*4+2] * .114;
    const B = FIT.block, bw = Math.floor(w / B), bh = Math.floor(h / B);
    if (bw < 10 || bh < 10) return null;
    const colp = new Float32Array(bw), rowp = new Float32Array(bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let e = 0;
      for (let y = by*B; y < by*B+B; y++) for (let x = bx*B; x < bx*B+B; x++) {
        const i = y*w + x;
        if (x + 1 < w && y + 1 < h) e += Math.abs(g[i] - g[i+1]) + Math.abs(g[i] - g[i+w]);
      }
      if (e / (B*B) > FIT.detail) { colp[bx]++; rowp[by]++; }
    }
    for (let i = 0; i < bw; i++) colp[i] /= bh;
    for (let i = 0; i < bh; i++) rowp[i] /= bw;
    const span = p => {
      const runs = []; let start = -1, prev = -1;
      const gap = Math.max(3, p.length * FIT.mergeGap);
      for (let i = 0; i < p.length; i++) if (p[i] > FIT.density) {
        if (start < 0) start = i; else if (i - prev > gap) { runs.push([start, prev]); start = i; }
        prev = i;
      }
      if (start < 0) return null;
      runs.push([start, prev]);
      const [a, b] = runs.reduce((m, r) => (r[1] - r[0] > m[1] - m[0] ? r : m));
      return [a, b + 1];
    };
    const sx = span(colp), sy = span(rowp);
    if (!sx || !sy) return null;
    const fw = (sx[1] - sx[0]) / bw, fh = (sy[1] - sy[0]) / bh;
    if (fw < .5 || fh < .5) return null;
    const cellAR = (fw * canvas.width / cols) / (fh * canvas.height / rows);
    if (cellAR < FIT.minCellAR || cellAR > FIT.maxCellAR) return null;
    // Whole percentages, rounded down, so the grid errs toward keeping edges.
    return [sx[0] / bw, (bw - sx[1]) / bw, sy[0] / bh, (bh - sy[1]) / bh].map(v => Math.max(0, Math.min(40, Math.floor(v * 100))));
  }
  function setMargins(values) {
    ['Left','Right','Top','Bottom'].forEach((edge, i) => { el('binder' + edge).value = values[i]; });
  }
  window.CardResellBinder.fitGrid = fitGrid;
  function setAll(value) {
    for (const p of pockets) { p.selected = value; if (p.checkbox) p.checkbox.checked = value; }
    updateCount();
  }
  function releaseCrops(preserveSpace = false) {
    const container=el('binderPockets');
    container.style.minHeight=preserveSpace ? `${container.getBoundingClientRect().height}px` : '';
    if (!preserveSpace) container.removeAttribute('aria-busy');
    urls.forEach(url => URL.revokeObjectURL(url)); urls = []; pockets = [];
    container.replaceChildren();
    const pick = el('binderBulkPick'); if (pick && !preserveSpace) pick.hidden = true;
    updateCount();
  }
  function updateCount() {
    syncAlignment();
    const count = otherPageFiles().length + pockets.filter(p => p.selected).length;
    const plural = n => n === 1 ? '' : 's';
    const previous=el('binderPrevious');
    previous.hidden=!multiPage() || pageIdx===0;
    previous.disabled=busy || adjusting || cameraActive;
    const progress=el('binderPageProgress');
    progress.hidden=!multiPage();
    progress.textContent=multiPage() ? `Page ${pageIdx+1} of ${pageQueue.length} · ${count} card${plural(count)} selected across this batch` : '';
    el('binderOpenCamera').textContent=pageQueue.length ? 'Retake this page' : 'Take a guided binder photo';
    if (multiPage() && pageIdx < pageQueue.length - 1) {
      // A page may legitimately contribute nothing (all empty), so Next is
      // available when ready, including a failed page the user can skip.
      el('binderContinue').disabled = busy || adjusting || cameraActive || (!source && !pageError);
      el('binderContinue').textContent = `${pageError ? 'Skip this page; next' : 'Next page'} (${pageIdx + 2} of ${pageQueue.length}) · ${count} card${plural(count)} so far`;
      return;
    }
    el('binderContinue').disabled = busy || adjusting || cameraActive || count === 0;
    el('binderContinue').textContent = count ? `Review ${count} card${plural(count)} · ${count} ID credit${plural(count)}` : 'Select the cards to scan';
  }
  function lock(value) {
    busy = value;
    el('binderControls').disabled = value;
    updateCount();
  }
  window.clearBinderScan = () => {
    stopCamera(); resetAlignment(); hidePhoto();
    generation++;
    pageQueue = []; pageIdx = 0; pageStates = []; pageNote = ''; rotation=0;pageError=false;
    releaseCrops();
    if (source) { source.width = source.height = 1; source = null; }
    el('binderInput').value = '';
    lock(false);
  };
  window.startBinderScan = () => {
    window.clearBinderScan();
    el('bulkBinderReview').scrollTop = 0;
    el('bulkBinderReview').querySelector('details').open = false;
    let saved = '';
    try { saved = localStorage.getItem(LAYOUT_KEY) || ''; } catch (_) {}
    el('binderLayout').value = [...el('binderLayout').options].some(o => o.value === saved) ? saved : '3,3';
    for (const edge of ['Left','Right','Top','Bottom']) el('binder' + edge).value = 0;
    marginsAuto = true;
    message('Choose straight-on photos of your binder pages, up to 10 at once. You review each page in turn. Nothing is charged until you confirm the scan.');
    _bulkShowSection('binder');
    el('binderInput').focus();
  };
  function blob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not prepare this photo.')), 'image/jpeg', .95));
  }
  async function render(restored = null) {
    if (!source) return;
    const version = ++generation;
    pageError=false;
    releaseCrops(true); lock(true);
    el('binderPockets').setAttribute('aria-busy','true');
    message('Preparing pocket previews…');
    try {
      const [cols, rows] = el('binderLayout').value.split(',').map(Number);
      let fitted = false;
      if (marginsAuto && !restored) {
        let fit = null;
        try { fit = fitGrid(source, cols, rows); } catch (_) {}
        setMargins(fit || [0, 0, 0, 0]); fitted = !!fit;
      }
      const margins = ['Left','Right','Top','Bottom'].map(edge => Math.max(0, Math.min(40, Number(el('binder'+edge).value) || 0)) / 100);
      let grid = cropGrid(cols, rows, margins), fitFallback = false;
      // Auto-fit is a suggestion. Do not let it reject an otherwise usable
      // original; manual grid edits remain authoritative and are never reset.
      if (marginsAuto && fitted && !readableGrid(grid)) {
        const fullPhoto = cropGrid(cols, rows, [0,0,0,0]);
        if (readableGrid(fullPhoto)) {
          grid = fullPhoto; setMargins([0,0,0,0]); fitted = false; fitFallback = true;
        }
      }
      const {x,y,cellWidth,cellHeight} = grid;
      paintPreview();
      const pocketEdge = Math.min(cellWidth,cellHeight);
      for (const {row,col,sx,sy,sw,sh,w,h} of grid.crops) {
        // Preserve the same 4% overlap and native-resolution pixels.
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        // Grid spacing is not the submitted image: padding can bring a
        // 393px cell above 400px. Conversely, clipping or the 1400px cap
        // can shrink a crop. Never upscale or lower the shared QC limit.
        if (Math.min(canvas.width, canvas.height) < MIN_POCKET_EDGE()) {
          canvas.width = canvas.height = 1;
          throw new Error('The pockets are too small in this photo to identify. Use a higher-resolution photo (the original from your camera roll), move closer, or pick a layout with fewer pockets.');
        }
        canvas.getContext('2d').drawImage(source,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
        let stats = { looksEmpty: false };
        try { stats = pocketStats(canvas); } catch (_) {}
        const jpeg = await blob(canvas); canvas.width = canvas.height = 1;
        if(version !== generation) return;
        const file = new File([jpeg],`binder-${multiPage() ? `page-${pageIdx+1}-` : ''}row-${row+1}-col-${col+1}.jpg`,{type:'image/jpeg'});
        const url = URL.createObjectURL(file); urls.push(url);
        const selected=restored?.selection.length===grid.crops.length ? restored.selection[pockets.length] : !stats.looksEmpty;
        const pocket = {file, selected, looksEmpty:!!stats.looksEmpty, stats}; pockets.push(pocket);
        const label = document.createElement('label'); label.className = 'binder-pocket';
        const img = document.createElement('img'); img.src = url; img.alt = `Row ${row+1}, column ${col+1}`;
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
        checkbox.checked = pocket.selected; pocket.checkbox = checkbox;
        checkbox.setAttribute('aria-label',`Scan row ${row+1}, column ${col+1}`);
        checkbox.addEventListener('change',()=>{ pocket.selected=checkbox.checked; updateCount(); });
        const caption = document.createElement('span'); caption.textContent = `Row ${row+1} · Col ${col+1}`;
        label.append(img,checkbox,caption);
        if (Number.isFinite(stats.energy)) label.dataset.detail = stats.energy.toFixed(1);
        if (pocket.looksEmpty) { const tag = document.createElement('span'); tag.className = 'binder-empty-tag'; tag.textContent = 'Looks empty'; label.append(tag); }
        el('binderPockets').append(label); updateCount();
      }
      const picked = pockets.filter(p => p.selected).length, empty = pockets.length - picked;
      const pick = el('binderBulkPick'); if (pick) pick.hidden = false;
      const fitNote = restored ? 'Your saved alignment and selections are restored. ' : fitFallback ? 'Automatic trimming made the crops too small, so the full photo is shown. Check that each grid box contains one whole card before continuing. ' : fitted ? 'Grid fitted to your cards automatically. Use the zoom and movement controls if a card is cut off. ' : '';
      const smallNote = pocketEdge < SMALL_POCKET_EDGE ? ' This photo is fairly small, so fine print may be hard to read. For best accuracy, use the original photo from your camera roll.' : '';
      const selectionNote = restored
        ? `${picked} pocket${picked===1?'':'s'} selected on this page. Review your choices before continuing. Changing the grid resets the selection.`
        : picked
        ? `Selected ${picked} pocket${picked === 1 ? '' : 's'} that appear to hold a card${empty ? ` and skipped ${empty} that look${empty === 1 ? 's' : ''} empty` : ''}. Untick any pocket that is empty, cut off, covered or unreadable. Changing the grid resets the selection.`
        : 'Every pocket looks empty. If that is wrong, check the grid, or tap Select all.';
      message(fitNote + selectionNote + smallNote);
    } catch(error) {
      if(version === generation) { pageError=true;releaseCrops(); message(error.message || 'Unable to prepare this page. Try individual photos.'); }
    } finally { if(version === generation) {
      el('binderPockets').style.minHeight='';
      el('binderPockets').setAttribute('aria-busy','false');
      lock(false);
    } }
  }
  el('binderInput').addEventListener('change', event => {
    const picked = [...(event.target.files || [])]; if(!picked.length) return;
    window.clearBinderScan();
    pageQueue = picked.slice(0, MAX_PAGES);
    pageNote = picked.length > MAX_PAGES ? ` Only the first ${MAX_PAGES} pages were added.` : '';
    openPage(0);
  });
  async function openPage(index, cameraMargins = null) {
    resetAlignment();
    const file = pageQueue[index]; if(!file) return;
    pageIdx = index;
    pageError=false;rotation=0;
    releaseCrops();
    if (source) { source.width = source.height = 1; source = null; }
    hidePhoto();
    for (const edge of ['Left','Right','Top','Bottom']) el('binder' + edge).value = 0;
    el('bulkBinderReview')?.scrollTo?.(0, 0);
    marginsAuto = true;
    const version = ++generation;
    lock(true); message('Opening photo…');
    let url, image;
    try {
      const supported=/^image\/(jpeg|png|webp)$/i.test(file.type)||(!file.type&&/\.(jpe?g|png|webp)$/i.test(file.name));
      if(!supported || file.size > 25*1024*1024) throw new Error('Choose a JPEG, PNG or WebP photo under 25 MB. Export HEIC photos as JPEG first.');
      url = URL.createObjectURL(file);
      image = new Image(); image.src = url; await image.decode();
      if(version !== generation) return;
      if(image.naturalWidth*image.naturalHeight > 50000000) throw new Error('This photo is too large. Export it at 50 megapixels or less.');
      const ratio = sourceScale(image.naturalWidth, image.naturalHeight);
      source = document.createElement('canvas');
      source.width = Math.round(image.naturalWidth*ratio); source.height = Math.round(image.naturalHeight*ratio);
      source.getContext('2d').drawImage(image,0,0,source.width,source.height);
      const saved=pageStates[index];
      if(saved) {
        for(let turn=0;turn<saved.rotation;turn++) rotateSource();
        rotation=saved.rotation;
        el('binderLayout').value=saved.layout;setMargins(saved.margins);marginsAuto=saved.auto;
        anchor=saved.anchor ? {...saved.anchor} : null;
        el('binderZoom').max=250;el('binderZoom').value=saved.zoom;el('binderZoomValue').textContent=saved.zoom+'%';
      }
      if(cameraMargins) {setMargins(cameraMargins);marginsAuto=false;}
      await render(saved);
    } catch(error) {
      if(version === generation) {
        pageError=true;
        const recovery=!multiPage() ? '' : pageIdx<pageQueue.length-1
          ? ' Use Skip this page to continue with the remaining photos.'
          : otherPageFiles().length ? ' You can review the cards selected on earlier pages.' : ' Retake this page or go back to an earlier photo.';
        message('Could not open this photo. '+(error.name==='EncodingError' ? 'Try a fresh JPEG from your camera roll.' : error.message || 'Try a JPEG photo.')+recovery);
        lock(false);
      }
    } finally { if(url) URL.revokeObjectURL(url); if(image) image.src = ''; }
  }
  el('binderLayout').addEventListener('change',()=>{ try { localStorage.setItem(LAYOUT_KEY, el('binderLayout').value); } catch (_) {} resetAlignment(); cameraGuide(); render(); });
  el('binderSelectAll')?.addEventListener('click',()=>{ if(!busy&&!adjusting&&!cameraActive) setAll(true); });
  el('binderSelectNone')?.addEventListener('click',()=>{ if(!busy&&!adjusting&&!cameraActive) setAll(false); });
  for(const edge of ['Left','Right','Top','Bottom']) el('binder'+edge).addEventListener('change',()=>{ marginsAuto = false; resetAlignment(); render(); });
  function rotateSource() {
    const rotated = document.createElement('canvas'); rotated.width=source.height; rotated.height=source.width;
    const ctx=rotated.getContext('2d'); ctx.translate(rotated.width,0); ctx.rotate(Math.PI/2); ctx.drawImage(source,0,0);
    source.width=source.height=1; source=rotated;
  }
  el('binderRotate').addEventListener('click',()=>{
    if(!source || busy || cameraActive) return;
    rotateSource();rotation=(rotation+1)%4;
    for(const edge of ['Left','Right','Top','Bottom']) el('binder'+edge).value=0;
    marginsAuto = true; resetAlignment();
    render();
  });

  el('binderOpenCamera').addEventListener('click',startCamera);
  el('binderCapture').addEventListener('click',capturePhoto);
  el('binderStopCamera').addEventListener('click',()=>{stopCamera();message('Camera closed. Choose a photo or reopen the camera.');});
  el('binderCameraVideo').addEventListener('loadedmetadata',()=>{if(cameraActive) cameraGuide();});
  el('binderCameraVideo').addEventListener('resize',()=>{if(cameraActive) cameraGuide();});
  window.addEventListener('pagehide',()=>{finishAdjustment();stopCamera();});
  window.addEventListener('blur',finishAdjustment);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){finishAdjustment();if(cameraActive)stopCamera();}});
  // Stop tracks even when another scan mode hides this section without cancel.
  new MutationObserver(()=>{if(el('bulkBinderReview').style.display==='none'){finishAdjustment();if(cameraActive)stopCamera();}}).observe(el('bulkBinderReview'),{attributes:true,attributeFilter:['style']});
  el('binderResetFit').addEventListener('click',()=>{if(!source||cameraActive)return;resetAlignment();marginsAuto=true;render();});
  el('binderZoom').addEventListener('input',()=>{
    if(!source||cameraActive)return;
    const r=rectangle();if(!anchor)anchor={...r};const factor=Number(el('binderZoom').value)/100;
    const w=anchor.w/factor,h=anchor.h/factor;
    const changed=saveRectangle({x:r.x+(r.w-w)/2,y:r.y+(r.h-h)/2,w,h});
    el('binderZoomValue').textContent=el('binderZoom').value+'%';
    if(changed) invalidateAdjustment();
  });
  for(const type of ['change','pointerup','pointercancel','lostpointercapture','keyup','blur'])
    el('binderZoom').addEventListener(type,()=>{if(adjusting)finishAdjustment();});
  el('binderMovePhoto').addEventListener('click',()=>{
    if(touchMove) finishAdjustment(); else {setTouchMove(true);syncAlignment();}
  });
  document.querySelectorAll('[data-binder-move]').forEach(button=>button.addEventListener('click',()=>{
    movePhoto(...moves[button.dataset.binderMove]);
  }));
  const preview=el('binderPreview');
  // The shared dialog Escape handler runs at document capture. Cancel an
  // active photo adjustment first, without closing its enclosing scanner.
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&(touchMove||drag||adjusting)&&el('bulkBinderReview').contains(event.target)) {
      event.preventDefault();event.stopPropagation();finishAdjustment();
    }
  },true);
  preview.addEventListener('keydown',event=>{
    const delta={ArrowLeft:moves.left,ArrowRight:moves.right,ArrowUp:moves.up,ArrowDown:moves.down}[event.key];
    if(delta){event.preventDefault();movePhoto(...delta);}
  });
  preview.addEventListener('pointerdown',event=>{
    if(drag&&event.pointerId!==drag.id){finishAdjustment();return;}
    if(!source||cameraActive||event.button>0||event.isPrimary===false)return;
    if(event.pointerType!=='mouse'&&!touchMove)return;
    const r=rectangle();if(!anchor)anchor={...r};
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,rect:r,bounds:preview.getBoundingClientRect(),zoom:anchor.w/r.w};
    try {preview.setPointerCapture(event.pointerId);}catch(_){releaseDrag();setTouchMove(false);syncAlignment();}
  });
  preview.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4&&!adjusting)return;
    if(saveRectangle({...drag.rect,x:drag.rect.x-(event.clientX-drag.x)/drag.bounds.width/drag.zoom,y:drag.rect.y-(event.clientY-drag.y)/drag.bounds.height/drag.zoom})) {
      if(!adjusting) invalidateAdjustment(); else paintPreview();
    }
  });
  const endDrag=event=>{if(drag&&event.pointerId===drag.id)finishAdjustment();};
  preview.addEventListener('pointerup',endDrag);preview.addEventListener('pointercancel',endDrag);preview.addEventListener('lostpointercapture',endDrag);
  el('binderPrevious').addEventListener('click',()=>{
    if(busy||adjusting||cameraActive||pageIdx===0)return;
    rememberPage();openPage(pageIdx-1);
  });
  el('binderCancel').addEventListener('click',()=>{window.clearBinderScan();_bulkShowSection('modePicker');});
  el('binderContinue').addEventListener('click',()=>{
    if(busy || adjusting || cameraActive) return;
    if (multiPage() && pageIdx < pageQueue.length - 1) {
      rememberPage();
      pageNote = '';
      openPage(pageIdx + 1);
      return;
    }
    // Use page order even after revisiting earlier pages; replace saved choices
    // rather than appending duplicates each time Next is pressed.
    rememberPage();
    const files=pageStates.flatMap(state=>state?.files || []); if(!files.length) return;
    lock(true);
    try {
      window._bulkMode='upload';
      processBulkUploadFiles({files,value:''});
      window.clearBinderScan();
    } catch (_) { lock(false); message('Could not prepare the queue. Please try again.'); }
  });
})();
