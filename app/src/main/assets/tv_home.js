(function () {
  if (window.__duloTvHomeInstalled) return;
  window.__duloTvHomeInstalled = true;

  var HOME_HASH = 'stream-aggregators';
  var HOME_PATH = '/video';

  function log(msg) {
    try {
      if (window.DuloTvBridge && window.DuloTvBridge.log) {
        window.DuloTvBridge.log('[home] ' + msg);
      }
    } catch (e) { /* ignore */ }
  }

  function isFmhyVideo() {
    return /fmhy\.net/i.test(location.hostname) && location.pathname.indexOf(HOME_PATH) >= 0;
  }

  function isOnStreamAggregators() {
    return location.hash.indexOf(HOME_HASH) >= 0;
  }

  function clickStreamAggregatorsNav() {
    var links = document.querySelectorAll('a[href*="' + HOME_HASH + '"], a[href*="stream-aggregators"]');
    for (var i = 0; i < links.length; i++) {
      try {
        links[i].click();
        return true;
      } catch (e) { /* ignore */ }
    }
    var all = document.querySelectorAll('a, button, [role="button"], [role="tab"]');
    for (var j = 0; j < all.length; j++) {
      var t = (all[j].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t === 'stream aggregators' || t.indexOf('stream aggregators') === 0) {
        try {
          all[j].click();
          return true;
        } catch (e2) { /* ignore */ }
      }
    }
    return false;
  }

  window.__duloTvGoStreamAggregators = function (forceReload) {
    var target = 'https://fmhy.net/video#' + HOME_HASH;
    log('go home force=' + forceReload + ' href=' + location.href);
    if (isFmhyVideo()) {
      if (clickStreamAggregatorsNav()) return true;
      location.hash = HOME_HASH;
      try {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (e) {
        window.dispatchEvent(new Event('hashchange'));
      }
      if (forceReload) location.reload();
      return true;
    }
    location.href = target;
    return true;
  };

  window.__duloTvEnsureDefaultSection = function () {
    if (!isFmhyVideo()) return;
    if (isOnStreamAggregators()) return;
    log('ensure default section');
    window.__duloTvGoStreamAggregators(false);
  };

  log('tv_home.js ready');
})();
