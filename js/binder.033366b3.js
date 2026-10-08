/* Guided binder-page crops. No network or credit consumption before bulk confirmation. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  let source = null, generation = 0, busy = false;
  let pockets = [], urls = [];
  const message = text => { el('binderStatus').textContent = text; };
  function releaseCrops() {
    urls.forEach(url => URL.revokeObjectURL(url)); urls = []; pockets = [];
    el('binderPockets').replaceChildren();
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
    el('binderLayout').value = '3,3';
    for (const edge of ['Left','Right','Top','Bottom']) el('binder' + edge).value = 0;
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
      if (Math.min(cellWidth,cellHeight) < 200) throw new Error('The pockets are too small in this photo. Use a higher-resolution photo or upload individual cards.');
      for (let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1,1400/Math.max(cellWidth,cellHeight));
        canvas.width = Math.round(cellWidth*ratio); canvas.height = Math.round(cellHeight*ratio);
        canvas.getContext('2d').drawImage(source,x+col*cellWidth,y+row*cellHeight,cellWidth,cellHeight,0,0,canvas.width,canvas.height);
        const jpeg = await blob(canvas); canvas.width = canvas.height = 1;
        if(version !== generation) return;
        const file = new File([jpeg],`binder-row-${row+1}-col-${col+1}.jpg`,{type:'image/jpeg'});
        const url = URL.createObjectURL(file); urls.push(url);
        const pocket = {file, selected:false}; pockets.push(pocket);
        const label = document.createElement('label'); label.className = 'binder-pocket';
        const img = document.createElement('img'); img.src = url; img.alt = `Row ${row+1}, column ${col+1}`;
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label',`Scan row ${row+1}, column ${col+1}`);
        checkbox.addEventListener('change',()=>{ pocket.selected=checkbox.checked; updateCount(); });
        const caption = document.createElement('span'); caption.textContent = `Row ${row+1} · Col ${col+1}`;
        label.append(img,checkbox,caption); el('binderPockets').append(label);
      }
      message('Select only pockets showing one complete, readable card. Leave empty, obscured or cut-off pockets unchecked. Changing the grid clears your selection.');
    } catch(error) {
      if(version === generation) { releaseCrops(); message(error.message || 'Unable to prepare this page. Try individual photos.'); }
    } finally { if(version === generation) lock(false); }
  }
  el('binderInput').addEventListener('change', async event => {
    const file = event.target.files[0]; if(!file) return;
    window.clearBinderScan();
    const version = ++generation;
    lock(true); message('Opening photo…');
    let url, image;
    try {
      if(!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 25*1024*1024) throw new Error('Choose a JPEG, PNG or WebP photo under 25 MB. Export HEIC photos as JPEG first.');
      url = URL.createObjectURL(file);
      image = new Image(); image.src = url; await image.decode();
      if(version !== generation) return;
      if(image.naturalWidth*image.naturalHeight > 50000000) throw new Error('This photo is too large. Export it at 50 megapixels or less.');
      const ratio = Math.min(1,6000/Math.max(image.naturalWidth,image.naturalHeight));
      source = document.createElement('canvas');
      source.width = Math.round(image.naturalWidth*ratio); source.height = Math.round(image.naturalHeight*ratio);
      source.getContext('2d').drawImage(image,0,0,source.width,source.height);
      await render();
    } catch(error) {
      if(version === generation) { message(error.message || 'Could not open this image. Try a JPEG photo.'); lock(false); }
    } finally { if(url) URL.revokeObjectURL(url); if(image) image.src = ''; }
  });
  el('binderLayout').addEventListener('change',render);
  for(const edge of ['Left','Right','Top','Bottom']) el('binder'+edge).addEventListener('change',render);
  el('binderRotate').addEventListener('click',()=>{
    if(!source || busy) return;
    const rotated = document.createElement('canvas'); rotated.width=source.height; rotated.height=source.width;
    const ctx=rotated.getContext('2d'); ctx.translate(rotated.width,0); ctx.rotate(Math.PI/2); ctx.drawImage(source,0,0);
    source.width=source.height=1; source=rotated;
    for(const edge of ['Left','Right','Top','Bottom']) el('binder'+edge).value=0;
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
