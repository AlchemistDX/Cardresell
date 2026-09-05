
(function() {
  var DISMISS_KEY = 'cr_pwa_dismissed_at';
  var DISMISS_DAYS = 30;

  function isStandalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches
          || window.navigator.standalone === true;
    } catch(e) { return false; }
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  function wasDismissedRecently() {
    try {
      var ts = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      if (!ts) return false;
      var age = (Date.now() - ts) / 86400000;
      return age < DISMISS_DAYS;
    } catch(e) { return false; }
  }
  function showBanner() {
    var b = document.getElementById('pwaInstallBanner');
    if (b) b.style.display = 'flex';
  }
  function hideBanner() {
    var b = document.getElementById('pwaInstallBanner');
    if (b) b.style.display = 'none';
  }

  window.pwaDismissBanner = function() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch(e) {}
    hideBanner();
  };

  // Chrome / Edge / Android path — native prompt.
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferred = e;
    if (isStandalone() || wasDismissedRecently()) return;
    // Only show once the user has actually loaded a card (proves value).
    var check = function() {
      if (window.selectedCard) showBanner();
      else setTimeout(check, 3000);
    };
    check();
  });

  window.pwaInstall = function() {
    if (deferred) {
      deferred.prompt();
      deferred.userChoice.then(function(choice) {
        if (choice && choice.outcome === 'accepted') {
          hideBanner();
        } else {
          window.pwaDismissBanner();
        }
        deferred = null;
      });
    } else if (isIOS()) {
      // No programmatic install — show manual instructions.
      alert('To install CardResell on iOS:\n\n1. Tap the Share button in Safari (⬆️)\n2. Scroll down and tap “Add to Home Screen”\n3. Tap Add');
    }
  };

  // iOS Safari path — no beforeinstallprompt event exists. If we detect
  // iOS + not already standalone + not dismissed, wait for a card load
  // and show the banner with manual-install instructions.
  if (isIOS() && !isStandalone() && !wasDismissedRecently()) {
    var iosCheck = function() {
      if (window.selectedCard) {
        var sub = document.getElementById('pwaBannerSub');
        if (sub) sub.textContent = 'Tap Install → follow the 3-step guide (uses Safari’s Share menu).';
        showBanner();
      } else {
        setTimeout(iosCheck, 3000);
      }
    };
    setTimeout(iosCheck, 2000);
  }

  window.addEventListener('appinstalled', function() {
    hideBanner();
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch(e) {}
  });
})();
