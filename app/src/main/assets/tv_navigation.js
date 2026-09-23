(function () {
  var firstInstall = !window.__duloTvNavInstalled;
  if (firstInstall) window.__duloTvNavInstalled = true;

  var SEE_ALL = /see\s*all|view\s*all|show\s*all|\bmore\b/i;
  var SKIP_LINK = /^skip\s*(to\s*)?(the\s*)?(main\s*)?(content|navigation|nav)\b/i;
  var TRUSTED_HOSTS = ['dulo.mov'];
  var currentFocus = null;

  function log(msg) {
    try {
      if (window.DuloTvBridge && window.DuloTvBridge.log) {
        window.DuloTvBridge.log(String(msg));
      }
    } catch (e) { /* ignore */ }
    if (window.console && console.log) console.log('[DuloTvNav] ' + msg);
  }

  // Auto-clicking ("See all", prepare-to-play buttons, etc.) is scoped to
  // dulo.mov regardless of which hosts get this script injected, so basic
  // D-pad movement still works on whatever site a link leads to without
  // also carrying the click-simulation side effects there.
  function isTrustedHost() {
    var h = (location.hostname || '').toLowerCase();
    for (var i = 0; i < TRUSTED_HOSTS.length; i++) {
      var host = TRUSTED_HOSTS[i];
      if (h === host || h.slice(-(host.length + 1)) === '.' + host) return true;
    }
    return false;
  }

  function labelOf(el) {
    if (!el) return '?';
    return (el.getAttribute('aria-label') || el.textContent || el.tagName || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 56);
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    var st = window.getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false;
    return true;
  }

  function isEditable(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function isChrome(el) {
    return !!el.closest(
      'nav, header, aside, [role="navigation"], [role="banner"], [role="complementary"]'
    );
  }

  function isSkipLink(el) {
    return SKIP_LINK.test(labelOf(el));
  }

  function rect(el) {
    var r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      cx: (r.left + r.right) / 2,
      cy: (r.top + r.bottom) / 2,
      w: r.width,
      h: r.height,
    };
  }

  function collectFocusables() {
    var sel =
      'a[href], button, [role="button"], [role="link"], input, select, textarea, [tabindex]';
    var nodes = Array.prototype.slice.call(document.querySelectorAll(sel));
    var out = [];
    nodes.forEach(function (el) {
      if (el.disabled) return;
      if (el.closest('[inert], [aria-hidden="true"]')) return;
      if (!isVisible(el)) return;
      if (el.tabIndex === -1 && el.tagName !== 'A' && el.tagName !== 'BUTTON') return;
      out.push(el);
    });
    return out;
  }

  function prepareTabOrder(items) {
    items.forEach(function (el) {
      if (el.dataset.duloOrigTab === undefined) {
        el.dataset.duloOrigTab = el.getAttribute('tabindex') != null ? el.getAttribute('tabindex') : '';
      }
      el.tabIndex = -1;
    });
  }

  function setFocus(el, reason) {
    if (!el) return;
    var items = collectFocusables();
    prepareTabOrder(items);
    el.tabIndex = 0;
    el.setAttribute('data-dulo-tv-focus', '1');
    items.forEach(function (n) {
      if (n !== el) n.removeAttribute('data-dulo-tv-focus');
    });
    try {
      el.focus({ preventScroll: false });
    } catch (e) {
      try {
        el.focus();
      } catch (e2) { /* ignore */ }
    }
    currentFocus = el;
    scrollFocusedIntoView(el);
    log('focus [' + reason + '] "' + labelOf(el) + '"');
    maybeExpandRow(el);
  }

  function findSeeAll(scope) {
    if (!scope) return null;
    var links = scope.querySelectorAll('a, button, [role="button"]');
    for (var i = 0; i < links.length; i++) {
      var t = labelOf(links[i]);
      if (SEE_ALL.test(t)) return links[i];
    }
    return null;
  }

  function rowContainer(el) {
    if (!el) return null;
    // Deliberately excludes generic <section>/<article>: those wrap huge
    // chunks of an ordinary content page (a whole wiki article is often one
    // <article>), which previously made findSeeAll() match some unrelated
    // "Learn more"-style link anywhere on the page instead of a real
    // carousel row's "See all".
    return el.closest(
      '[class*="row"], [class*="Row"], [class*="carousel"], [class*="Carousel"], [class*="slider"], [class*="Shelf"], [class*="rail"], [class*="list"]'
    );
  }

  function maybeExpandRow(focused) {
    if (!isTrustedHost()) return;
    var row = rowContainer(focused);
    if (!row) return;
    if (row.dataset.duloSeeAllDone === '1') return;
    // A real carousel row of poster cards is short; anything this tall is
    // very unlikely to be a single row and is more likely a big content
    // wrapper - skip it rather than risk auto-clicking something unrelated.
    if (rect(row).h > 360) return;
    var seeAll = findSeeAll(row);
    if (!seeAll && row.parentElement) seeAll = findSeeAll(row.parentElement);
    if (seeAll && !seeAll.disabled) {
      row.dataset.duloSeeAllDone = '1';
      log('auto See all "' + labelOf(seeAll) + '"');
      seeAll.click();
    }
  }

  function scrollFocusedIntoView(el) {
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    } catch (e) {
      try {
        el.scrollIntoView(false);
      } catch (e2) { /* ignore */ }
    }
  }

  // Land on real page content first, not the persistent header/sidebar chrome
  // (and never on an off-screen accessibility skip-link, which only becomes
  // visible once focused and would otherwise look like the "first" item).
  function initialFocus() {
    var items = collectFocusables();
    if (!items.length) return;
    var contentItems = items.filter(function (el) {
      return !isChrome(el) && !isSkipLink(el);
    });
    var target = (contentItems.length ? contentItems : items)[0];
    setFocus(target, 'init');
  }

  // Geometric ("spatial") nearest-neighbor navigation: for a given direction,
  // only elements genuinely positioned that way are candidates, scored by
  // distance along that axis plus a heavier penalty for misalignment on the
  // other axis. This works across arbitrary layouts (sidebar + topbar +
  // multi-column article) without needing a page-wide "row" model, which
  // breaks down as soon as a sidebar column and the main content share
  // similar Y positions (it was clustering them into the same "row" and
  // trapping focus in the header/sidebar).
  function isCandidate(r0, r, direction) {
    switch (direction) {
      case 'left': return r.right <= r0.left + 1;
      case 'right': return r.left >= r0.right - 1;
      case 'up': return r.bottom <= r0.top + 1;
      case 'down': return r.top >= r0.bottom - 1;
      default: return false;
    }
  }

  function candidateScore(r0, r, direction) {
    var primary, secondary;
    if (direction === 'left' || direction === 'right') {
      primary = direction === 'left' ? (r0.left - r.right) : (r.left - r0.right);
      secondary = Math.abs(r0.cy - r.cy);
    } else {
      primary = direction === 'up' ? (r0.top - r.bottom) : (r.top - r0.bottom);
      secondary = Math.abs(r0.cx - r.cx);
    }
    return Math.max(primary, 0) + secondary * 2;
  }

  function moveFocus(direction) {
    var items = collectFocusables();
    if (!items.length) return false;

    var active = currentFocus && document.body.contains(currentFocus) ? currentFocus : document.activeElement;
    if (!active || active === document.body || items.indexOf(active) < 0) {
      initialFocus();
      return true;
    }

    var r0 = rect(active);
    var best = null;
    var bestScore = Infinity;
    items.forEach(function (el) {
      if (el === active) return;
      var r = rect(el);
      if (!isCandidate(r0, r, direction)) return;
      var score = candidateScore(r0, r, direction);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    });

    if (!best) return true; // nothing further that way; hold position
    setFocus(best, 'move-' + direction);
    return true;
  }

  function handleEnter() {
    var active = currentFocus || document.activeElement;
    if (!active) return false;
    if (isEditable(active)) return false;
    log('enter activate "' + labelOf(active) + '"');
    active.click();
    return true;
  }

  function injectStyles() {
    if (document.getElementById('dulo-tv-nav-style')) return;
    var s = document.createElement('style');
    s.id = 'dulo-tv-nav-style';
    s.textContent =
      '[data-dulo-tv-focus="1"] {' +
      'outline: none !important;' +
      'transform: scale(1.1) !important;' +
      'transform-origin: center center !important;' +
      'z-index: 50 !important;' +
      'position: relative !important;' +
      'box-shadow: 0 0 0 4px #fff, 0 8px 28px rgba(0,0,0,0.55) !important;' +
      'transition: transform 0.15s ease-out, box-shadow 0.15s ease-out !important;' +
      '}' +
      'a, button, [role="button"], [tabindex] {' +
      'transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;' +
      '}';
    document.head.appendChild(s);
  }

  function focusIsStale() {
    return !currentFocus || !document.body.contains(currentFocus) || !isVisible(currentFocus);
  }

  window.__duloTvHandleKey = function (direction) {
    if (isEditable(document.activeElement)) return false;
    var dir = String(direction || '').toLowerCase();
    if (dir === 'enter' || dir === 'select') return handleEnter();
    if (dir === 'left' || dir === 'right' || dir === 'up' || dir === 'down') {
      return moveFocus(dir);
    }
    return false;
  };

  // force=true re-picks initial focus even if the current focus is still
  // valid - used after a same-page section change (e.g. jumping to Stream
  // Aggregators) so focus actually follows the content into view instead of
  // staying wherever it happened to be before the jump.
  window.__duloTvNavRefresh = function (force) {
    log('refresh href=' + location.href + ' force=' + !!force);
    setTimeout(function () {
      if (force || focusIsStale()) initialFocus();
    }, 300);
  };

  function onKeyDown(e) {
    if (isEditable(e.target)) return;
    var key = e.key || '';
    var map = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      Enter: 'enter',
    };
    var dir = map[key];
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    if (dir === 'enter') handleEnter();
    else moveFocus(dir);
  }

  if (!firstInstall) {
    window.__duloTvNavRefresh();
    return;
  }

  document.addEventListener('keydown', onKeyDown, true);
  injectStyles();

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initialFocus, 400);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(initialFocus, 400);
    });
  }

  window.addEventListener('load', function () {
    setTimeout(initialFocus, 600);
  });

  // Re-focus automatically if an SPA route change removes/hides whatever was
  // focused - a plain validity check, not a forced jump, so ordinary content
  // updates elsewhere on the page don't yank focus around.
  var debounce;
  new MutationObserver(function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      if (focusIsStale()) initialFocus();
    }, 500);
  }).observe(document.documentElement, { childList: true, subtree: true });

  log('spatial tv_navigation ready');
})();
