/* Guided binder-page crops. No network or credit consumption before bulk confirmation. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  let source = null, generation = 0, busy = false;
  let pockets = [], urls = [];
  const message = text => { el('binderStatus').textContent = text; };
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
  // the short edge, so a smaller pocket would pass review and then fail as
  // "Photo too small". Refuse it here, before the credit quote.
  const MIN_POCKET_EDGE = () => (window.CardResellPhotoQC && window.CardResellPhotoQC.MIN_SHORT_EDGE) || 400;
  // Real photos shared through Messages arrive around 1500 x 2000; at 3 x 3
  // that leaves ~500 px pockets, where the local matcher lost a card that the
  // full-size photo kept. Advise, never block.
  const SMALL_POCKET_EDGE = 700;
  function sourceScale(w, h) {
    return Math.min(1, MAX_SOURCE_SIDE / Math.max(w, h), Math.sqrt(MAX_SOURCE_AREA / (w * h)));
  }
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
  function releaseCrops() {
    urls.forEach(url => URL.revokeObjectURL(url)); urls = []; pockets = [];
    el('binderPockets').replaceChildren();
    const pick = el('binderBulkPick'); if (pick) pick.hidden = true;
    updateCount();
  }
  function updateCount() {
    const count = pockets.filter(p => p.selected).length;
    el('binderContinue').disabled = busy || count === 0;
    el('binderContinue').textContent = count ? `Review ${count} card${count === 1 ? '' : 's'} · ${count} ID credit${count === 1 ? '' : 's'}` : 'Select the cards to scan';
  }
  function lock(value) {
    busy = value;
    el('binderControls').disabled = value;
    updateCount();
  }
  window.clearBinderScan = () => {
    generation++;
    releaseCrops();
    if (source) { source.width = source.height = 1; source = null; }
    const preview = el('binderPreview'); preview.width = preview.height = 1; preview.hidden = true;
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
    message('Choose a straight-on photo of one binder page. Nothing is charged until you confirm the scan.');
    _bulkShowSection('binder');
    el('binderInput').focus();
  };
  function blob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not prepare this photo.')), 'image/jpeg', .95));
  }
  async function render() {
    if (!source) return;
    const version = ++generation;
    releaseCrops(); lock(true);
    message('Preparing pocket previews…');
    try {
      const [cols, rows] = el('binderLayout').value.split(',').map(Number);
      let fitted = false;
      if (marginsAuto) {
        let fit = null;
        try { fit = fitGrid(source, cols, rows); } catch (_) {}
        setMargins(fit || [0, 0, 0, 0]); fitted = !!fit;
      }
      const margins = ['Left','Right','Top','Bottom'].map(edge => Math.max(0, Math.min(40, Number(el('binder'+edge).value) || 0)) / 100);
      const [left,right,top,bottom] = margins;
      const x = source.width * left, y = source.height * top;
      const width = source.width * (1-left-right), height = source.height * (1-top-bottom);
      const cellWidth = width / cols, cellHeight = height / rows;
      const preview = el('binderPreview');
      preview.hidden = false;
      preview.width = Math.min(900, source.width); preview.height = Math.round(preview.width * source.height / source.width);
      const ctx = preview.getContext('2d'), scale = preview.width / source.width;
      ctx.drawImage(source,0,0,preview.width,preview.height);
      ctx.strokeStyle = '#f5ad27'; ctx.lineWidth = 2;
      for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
        ctx.strokeRect((x+col*cellWidth)*scale,(y+row*cellHeight)*scale,cellWidth*scale,cellHeight*scale);
      }
      const pocketEdge = Math.min(cellWidth,cellHeight);
      if (pocketEdge < MIN_POCKET_EDGE()) throw new Error('The pockets are too small in this photo to identify. Use a higher-resolution photo (the original from your camera roll), move closer, or pick a layout with fewer pockets.');
      for (let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
        // A small margin around each pocket keeps card corners when the grid
        // is slightly off; the identifier picks the dominant card.
        const sx = Math.max(0, x+col*cellWidth - cellWidth*POCKET_PAD), sy = Math.max(0, y+row*cellHeight - cellHeight*POCKET_PAD);
        const sw = Math.min(source.width, x+(col+1)*cellWidth + cellWidth*POCKET_PAD) - sx;
        const sh = Math.min(source.height, y+(row+1)*cellHeight + cellHeight*POCKET_PAD) - sy;
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1,1400/Math.max(sw,sh));
        canvas.width = Math.round(sw*ratio); canvas.height = Math.round(sh*ratio);
        canvas.getContext('2d').drawImage(source,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
        let stats = { looksEmpty: false };
        try { stats = pocketStats(canvas); } catch (_) {}
        const jpeg = await blob(canvas); canvas.width = canvas.height = 1;
        if(version !== generation) return;
        const file = new File([jpeg],`binder-row-${row+1}-col-${col+1}.jpg`,{type:'image/jpeg'});
        const url = URL.createObjectURL(file); urls.push(url);
        const pocket = {file, selected:!stats.looksEmpty, looksEmpty:!!stats.looksEmpty, stats}; pockets.push(pocket);
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
      const fitNote = fitted ? 'Grid fitted to your cards automatically. If a card is cut off, use Adjust the grid edges. ' : '';
      const smallNote = pocketEdge < SMALL_POCKET_EDGE ? ' This photo is fairly small, so fine print may be hard to read. For best accuracy, use the original photo from your camera roll.' : '';
      message(fitNote + (picked
        ? `Selected ${picked} pocket${picked === 1 ? '' : 's'} that appear to hold a card${empty ? ` and skipped ${empty} that look${empty === 1 ? 's' : ''} empty` : ''}. Untick any pocket that is empty, cut off, covered or unreadable. Changing the grid resets the selection.`
        : 'Every pocket looks empty. If that is wrong, check the grid, or tap Select all.') + smallNote);
    } catch(error) {
      if(version === generation) { releaseCrops(); message(error.message || 'Unable to prepare this page. Try individual photos.'); }
    } finally { if(version === generation) lock(false); }
  }
  el('binderInput').addEventListener('change', async event => {
    const file = event.target.files[0]; if(!file) return;
    window.clearBinderScan();
    marginsAuto = true;
    const version = ++generation;
    lock(true); message('Opening photo…');
    let url, image;
    try {
      if(!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 25*1024*1024) throw new Error('Choose a JPEG, PNG or WebP photo under 25 MB. Export HEIC photos as JPEG first.');
      url = URL.createObjectURL(file);
      image = new Image(); image.src = url; await image.decode();
      if(version !== generation) return;
      if(image.naturalWidth*image.naturalHeight > 50000000) throw new Error('This photo is too large. Export it at 50 megapixels or less.');
      const ratio = sourceScale(image.naturalWidth, image.naturalHeight);
      source = document.createElement('canvas');
      source.width = Math.round(image.naturalWidth*ratio); source.height = Math.round(image.naturalHeight*ratio);
      source.getContext('2d').drawImage(image,0,0,source.width,source.height);
      await render();
    } catch(error) {
      if(version === generation) { message(error.message || 'Could not open this image. Try a JPEG photo.'); lock(false); }
    } finally { if(url) URL.revokeObjectURL(url); if(image) image.src = ''; }
  });
  el('binderLayout').addEventListener('change',()=>{ try { localStorage.setItem(LAYOUT_KEY, el('binderLayout').value); } catch (_) {} render(); });
  el('binderSelectAll')?.addEventListener('click',()=>{ if(!busy) setAll(true); });
  el('binderSelectNone')?.addEventListener('click',()=>{ if(!busy) setAll(false); });
  for(const edge of ['Left','Right','Top','Bottom']) el('binder'+edge).addEventListener('change',()=>{ marginsAuto = false; render(); });
  el('binderRotate').addEventListener('click',()=>{
    if(!source || busy) return;
    const rotated = document.createElement('canvas'); rotated.width=source.height; rotated.height=source.width;
    const ctx=rotated.getContext('2d'); ctx.translate(rotated.width,0); ctx.rotate(Math.PI/2); ctx.drawImage(source,0,0);
    source.width=source.height=1; source=rotated;
    for(const edge of ['Left','Right','Top','Bottom']) el('binder'+edge).value=0;
    marginsAuto = true;
    render();
  });
  el('binderCancel').addEventListener('click',()=>{window.clearBinderScan();_bulkShowSection('modePicker');});
  el('binderContinue').addEventListener('click',()=>{
    if(busy) return;
    const files=pockets.filter(p=>p.selected).map(p=>p.file); if(!files.length) return;
    lock(true);
    try {
      window._bulkMode='upload';
      processBulkUploadFiles({files,value:''});
      window.clearBinderScan();
    } catch (_) { lock(false); message('Could not prepare the queue. Please try again.'); }
  });
})();
