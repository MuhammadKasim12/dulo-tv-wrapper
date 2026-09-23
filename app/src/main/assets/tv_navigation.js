(function () {
  var firstInstall = !window.__duloTvNavInstalled;
  if (firstInstall) window.__duloTvNavInstalled = true;

  var NAV_LABELS = /^(home|movies|tv series|tv shows|series|settings|search)$/i;
  var SEE_ALL = /see\s*all|view\s*all|show\s*all|more/i;

  function log(msg) {
    try {
      if (window.DuloTvBridge && window.DuloTvBridge.log) {
        window.DuloTvBridge.log(String(msg));
      }
    } catch (e) { /* ignore */ }
    if (window.console && console.log) console.log('[DuloTvNav] ' + msg);
  }

  function isFocusable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return !el.disabled && el.tabIndex !== -1;
    }
    return el.tabIndex >= 0;
 }

  function navCandidates() {
    var nodes = document.querySelectorAll(
      'nav a, nav button, header a, header button, [role="navigation"] a, [role="navigation"] button'
    );
    var out = [];
    nodes.forEach(function (el) {
      var t = (el.textContent || el.getAttribute('aria-label') || '').trim();
      if (NAV_LABELS.test(t)) out.push(el);
    });
    if (out.length >= 3) return out;
    var all = document.querySelectorAll('a, button, [role="button"]');
    all.forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (t.length > 0 && t.length < 24 && NAV_LABELS.test(t)) out.push(el);
    });
    return out;
  }

  var navEls = [];
  var navLocked = false;

  function refreshNav() {
    navEls = navCandidates();
    log('nav links found: ' + navEls.length);
  }

  function navRoot() {
    var n = document.querySelector('nav, header, [role="navigation"], [role="banner"]');
    if (n) return n;
    refreshNav();
    if (navEls.length > 0) {
      var p = navEls[0].parentElement;
      for (var i = 0; i < 4 && p; i++) {
        if (p.querySelectorAll('a, button').length >= 3) return p;
        p = p.parentElement;
      }
    }
    return null;
  }

  function lockNav(reason) {
    if (navLocked) return;
    refreshNav();
    var root = navRoot();
    if (root) root.setAttribute('inert', '');
    navEls.forEach(function (el) {
      if (el.dataset.duloPrevTabindex === undefined) {
        el.dataset.duloPrevTabindex = el.getAttribute('tabindex') != null ? el.getAttribute('tabindex') : '';
      }
      el.tabIndex = -1;
    });
    navLocked = true;
    log('nav LOCK ' + (reason || '') + (root ? ' inert=1' : ''));
  }

  function unlockNav(reason) {
    if (!navLocked) return;
    var root = navRoot();
    if (root) root.removeAttribute('inert');
    navEls.forEach(function (el) {
      var prev = el.dataset.duloPrevTabindex;
      if (prev === '') el.removeAttribute('tabindex');
      else if (prev !== undefined) el.setAttribute('tabindex', prev);
    });
    navLocked = false;
    log('nav UNLOCK ' + (reason || ''));
  }

  function isInNav(el) {
    if (!el) return false;
    refreshNav();
    for (var i = 0; i < navEls.length; i++) {
      if (navEls[i] === el || navEls[i].contains(el)) return true;
    }
    var n = el.closest('nav, header, [role="navigation"]');
    return !!n;
  }

  function findSeeAll(scope) {
    if (!scope) return null;
    var links = scope.querySelectorAll('a, button, [role="button"]');
    for (var i = 0; i < links.length; i++) {
      var t = (links[i].textContent || links[i].getAttribute('aria-label') || '').trim();
      if (SEE_ALL.test(t)) return links[i];
    }
    return null;
  }

  function rowContainer(el) {
    if (!el) return null;
    return el.closest(
      'section, article, [class*="row"], [class*="Row"], [class*="carousel"], [class*="Carousel"], [class*="slider"], [class*="Shelf"], [class*="rail"], li'
    );
  }

  function maybeExpandRow(focused) {
    var row = rowContainer(focused);
    if (!row) return;
    var key = row.dataset.duloRowKey || (row.dataset.duloRowKey = 'r' + Math.random().toString(36).slice(2));
    if (row.dataset.duloSeeAllDone === '1') return;
    var seeAll = findSeeAll(row);
    if (!seeAll && row.parentElement) seeAll = findSeeAll(row.parentElement);
    if (seeAll && !seeAll.disabled) {
      row.dataset.duloSeeAllDone = '1';
      log('auto See all: "' + (seeAll.textContent || '').trim().slice(0, 40) + '"');
      seeAll.click();
    }
  }

  function scrollFocusedIntoView(el) {
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    } catch (e) {
      try { el.scrollIntoView(false); } catch (e2) { /* ignore */ }
    }
  }

  function injectStyles() {
    if (document.getElementById('dulo-tv-nav-style')) return;
    var s = document.createElement('style');
    s.id = 'dulo-tv-nav-style';
    s.textContent =
      '[data-dulo-tv-focus="1"], a:focus-visible, button:focus-visible, [tabindex]:focus-visible {' +
      'outline: 3px solid #ffb020 !important; outline-offset: 4px !important;' +
      'box-shadow: 0 0 0 4px rgba(255,176,32,0.35) !important;' +
      '}';
    document.head.appendChild(s);
  }

  window.__duloTvNavRefresh = function () {
    refreshNav();
    log('refresh href=' + location.href);
  };

  if (!firstInstall) {
    window.__duloTvNavRefresh();
    return;
  }

  document.addEventListener(
    'focusin',
    function (e) {
      var t = e.target;
      if (!t || t.nodeType !== 1) return;
      document.querySelectorAll('[data-dulo-tv-focus="1"]').forEach(function (n) {
        n.removeAttribute('data-dulo-tv-focus');
      });
      t.setAttribute('data-dulo-tv-focus', '1');
      scrollFocusedIntoView(t);

      var label = (t.textContent || t.getAttribute('aria-label') || t.tagName || '').trim().slice(0, 48);
      log('focus "' + label + '" nav=' + isInNav(t) + ' locked=' + navLocked);

      if (isInNav(t)) {
        unlockNav('focus-in-nav');
      } else {
        lockNav('focus-in-content');
        maybeExpandRow(t);
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    function (e) {
      var key = e.key || '';
      if (key.indexOf('Arrow') !== 0 && key !== 'Enter') return;
      log('key ' + key + ' on ' + ((e.target && e.target.tagName) || '?'));

      if (key === 'ArrowUp' && e.target && !isInNav(e.target)) {
        var row = rowContainer(e.target);
        var prev = row && row.previousElementSibling;
        if (!prev || (prev.tagName === 'HEADER' || prev.querySelector('nav'))) {
          unlockNav('arrow-up-top');
        }
      }
    },
    true
  );

  injectStyles();
  refreshNav();
  log('tv_navigation.js ready href=' + location.href);
})();
