/* Private AI grade reports. Explicit saves, honest success/failure, no credit
   charge, no public share creation, no uploaded photo storage. */
(() => {
  'use strict';
  const pending = new WeakMap();
  const owner = () => String(window.googleUser?.sub || '');
  const token = () => window._googleIdToken || '';
  let dialog, dialogOwner = '', requestGeneration = 0;
  const el = (tag, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; return n; };
  const button = (label, action) => { const n = el('button', label); n.type = 'button'; n.className = 'fl-sub-btn'; n.addEventListener('click', action); return n; };
  async function request(method, id, body, expectedOwner) {
    if (!expectedOwner || owner() !== expectedOwner || !token()) throw new Error('Sign in to your grading account first.');
    const response = await fetch('/api/grade-history' + (id ? '?id=' + encodeURIComponent(id) : ''), {
      method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const value = await response.json();
    if (owner() !== expectedOwner) throw new Error('Account changed. Reopen grade history.');
    if (!response.ok) throw new Error(value.error || 'Could not access grade history. Please retry.');
    return value;
  }
  window.saveAiGradeReport = async (data, id, expectedOwner) => {
    // Recovered responses identify the same analysis across sessions. Saving
    // them again must not fill history with copies of one paid result.
    if (typeof data?.analysis_id === 'string' && data.analysis_id) {
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([expectedOwner,data.analysis_id]))));
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const h = Array.from(bytes.slice(0,16), b => b.toString(16).padStart(2,'0')).join('');
      id = h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
    }
    return request('POST', '', { id, data }, expectedOwner);
  };
  function download(report) {
    const a = el('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type:'application/json'}));
    a.href = url; a.download = 'cardresell-ai-grade-' + report.id + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function content() { return dialog.querySelector('[data-grade-content]'); }
  function message(text) { content().replaceChildren(el('p', text)); }
  function showDetail(report) {
    const root = content(); root.replaceChildren();
    root.append(button('← All saved grades', load), el('h3', report.card),
      el('p', [report.set, report.number].filter(Boolean).join(' · ')),
      el('p', 'AI estimate: ' + report.grade + '/10 · ' + report.mode),
      el('p', 'Saved ' + new Date(report.savedAt).toLocaleString()),
      el('p', 'Photo-based estimate, not a certified grade. Photos are not stored in this history.'));
    const labels = { centering:'Centering',centering_lr:'Centering left/right',centering_tb:'Centering top/bottom',
      corners_desc:'Corners',edges_desc:'Edges',surface_desc:'Surface',corners:'Corners',edges:'Edges',surface:'Surface',
      eye_appeal:'Eye appeal',eye_appeal_notes:'Eye appeal notes',centering_back:'Back centering',confidence:'Confidence',limiting_factor:'Limiting factor',grade_notes:'Notes',grading_standard:'Grading standard' };
    const details = el('dl');
    for (const [key,label] of Object.entries(labels)) if (report.data[key] != null) {
      details.append(el('dt', label), el('dd', String(report.data[key])));
    }
    for (const [key,value] of Object.entries(report.data.grades || {})) details.append(el('dt', key + ' score'), el('dd', String(value)));
    root.append(details, button('Download report', () => download(report)));
    const status = el('p'); status.setAttribute('role','status');
    root.append(button('Delete saved grade', async () => {
      if (!confirm('Delete this saved AI grade report? This cannot be undone.')) return;
      const account = dialogOwner;
      try { await request('DELETE', report.id, null, account); if (dialog.open && account === dialogOwner) await load(); }
      catch(e) { status.textContent = e.message; }
    }), status);
  }
  async function load() {
    const generation = ++requestGeneration, account = dialogOwner;
    if (!account) { message('Sign in to save grades and reopen them on another device.'); return; }
    message('Loading saved grades…');
    try {
      const value = await request('GET', '', null, account);
      if (generation !== requestGeneration || !dialog.open) return;
      const root = content(); root.replaceChildren(el('p', value.reports.length + ' of ' + value.limit + ' saved grades. Included on every plan.'));
      if (!value.reports.length) root.append(el('p', 'No saved grades yet. After a Quick or Deep Grade, choose “Save grade”.'));
      for (const report of value.reports) {
        const row = el('div'); row.style.cssText = 'padding:.7rem 0;border-bottom:1px solid var(--border);display:flex;gap:.6rem;align-items:center;justify-content:space-between';
        row.append(el('span', report.card + ' · AI ' + report.grade + '/10 · ' + new Date(report.savedAt).toLocaleDateString()),
          button('Open report', async () => {
            const requestId = ++requestGeneration;
            try { const value = await request('GET', report.id, null, account); if (requestId === requestGeneration && dialog.open) showDetail(value.report); }
            catch(e) { if (requestId === requestGeneration) message(e.message); }
          }));
        root.append(row);
      }
    } catch(e) { if (generation === requestGeneration) { message(e.message); content().append(button('Retry', load)); } }
  }
  window.openAiGradeHistory = function() {
    if (!dialog) {
      dialog = el('dialog'); dialog.id = 'aiGradeHistoryDialog';
      dialog.setAttribute('aria-labelledby','aiGradeHistoryTitle');
      dialog.style.cssText = 'background:var(--bg,#171717);color:var(--text,#fff);border:1px solid var(--border,#555);border-radius:16px;width:min(600px,calc(100% - 2rem));max-height:85vh;padding:1.2rem;overflow:auto;overflow-wrap:anywhere';
      const title = el('h2','Saved AI grades'); title.id = 'aiGradeHistoryTitle';
      const body = el('div'); body.dataset.gradeContent = '';
      dialog.append(button('Close', () => dialog.close()), title, body); document.body.append(dialog);
      dialog.addEventListener('close', () => { ++requestGeneration; body.replaceChildren(); });
    }
    dialogOwner = owner(); if (!dialog.open) dialog.showModal(); load();
  };
  // Remove private content promptly on logout/account changes, including while
  // a request from the previous account is in flight.
  setInterval(() => {
    if (dialog?.open && owner() !== dialogOwner) { ++requestGeneration; dialog.close(); }
    const batch = document.getElementById('bulkGradeOverlay');
    if (batch?.style.display === 'flex' && window._bulkGradeOwner && owner() !== window._bulkGradeOwner) {
      window._bulkGradeStopRequested = true;
      if (typeof window._bulkGradeRevokeAllUrls === 'function') window._bulkGradeRevokeAllUrls();
      window._bulkGradeResults = []; window._bulkGradeQueue = [];
      document.getElementById('bulkGradeResultsList')?.replaceChildren();
      document.getElementById('bulkGradeDetail')?.replaceChildren();
      batch.style.display = 'none';
      if (typeof window._dialogClosed === 'function') window._dialogClosed('bulkGradeOverlay');
    }
  }, 250);
  function attach() {
    const share = document.getElementById('shareGradeBtn');
    if (!share || document.getElementById('saveAiGradeBtn')) return;
    const stash = window._lastGradeShareData;
    if (!stash?.data) return;
    if (!pending.has(stash)) pending.set(stash, { id: crypto.randomUUID(), owner: owner() });
    const entry = pending.get(stash);
    const status = el('p'); status.setAttribute('role','status'); status.style.fontSize = '.8rem';
    const save = button('Save grade', async () => {
      save.disabled = true; status.textContent = 'Saving…';
      try {
        await window.saveAiGradeReport(stash.data, entry.id, entry.owner);
        save.textContent = 'Grade saved'; status.textContent = 'Saved privately to your account. Find it in Collection → Saved AI grades.';
      } catch(e) { status.textContent = e.message; save.disabled = false; }
    });
    save.id = 'saveAiGradeBtn'; save.style.cssText = 'width:100%;margin-top:.6rem;padding:.7rem';
    const history = button('View saved grades', window.openAiGradeHistory);
    share.after(save, history, status);
  }
  const result = document.getElementById('scanResult');
  if (result) { new MutationObserver(attach).observe(result, {childList:true,subtree:true}); attach(); }
})();
