/* Instructions only: no seller connection, network requests, or listing writes. */
(() => {
  'use strict';
  const key = 'cr_draft_export_help_hidden_v1';
  const panel = document.getElementById('draftExportHelp');
  const toggle = document.getElementById('draftExportHelpBtn');
  if (!panel || !toggle) return;
  const checkbox = panel.querySelector('[data-draft-help-hide-auto]');
  const status = panel.querySelector('[role="status"]');
  let sessionPreference = null;
  const suppressed = () => {
    if (sessionPreference !== null) return sessionPreference;
    try { return localStorage.getItem(key) === '1'; }
    catch (_) { return false; }
  };
  function open({ automatic = false } = {}) {
    if (automatic && suppressed()) return;
    checkbox.checked = suppressed();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (!automatic) {
      panel.querySelector('h2').focus();
      panel.scrollIntoView({ block: 'nearest' });
    }
  }
  function close() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }
  checkbox.addEventListener('change', () => {
    sessionPreference = checkbox.checked;
    try {
      if (checkbox.checked) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
      status.textContent = checkbox.checked ? 'Automatic guide hidden in this browser. You can reopen it with How to use drafts.' : 'The guide will appear after your next CSV download.';
    } catch (_) {
      status.textContent = 'This browser could not save the preference. It will apply until you reload; How to use drafts stays available.';
    }
  });
  document.addEventListener('click', event => {
    if (event.target.closest?.('[data-draft-help-open]')) open();
    if (event.target.closest?.('[data-draft-help-close]')) close();
  });
  window.CardResellDraftExportHelp = { open };
})();
