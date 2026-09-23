(function () {
  var firstInstall = !window.__duloTvNavInstalled;
  if (firstInstall) window.__duloTvNavInstalled = true;

  var NAV_LABELS =
    /^(home|movies|tv series|tv shows|series|settings|search|apps|my list|profiles?|categories|live|sports|kids|news)$/i;
  var SEE_ALL = /see\s*all|view\s*all|show\s*all|\bmore\b/i;
  var ROW_Y_THRESHOLD = 56;
  var currentFocus = null;

  function log(msg) {
    try {
      if (window.DuloTvBridge && window.DuloTvBridge.log) {
        window.DuloTvBridge.log(String(msg));
      }
    } catch (e) { /* ignore */ }
    if (window.console && console.log) console.log('[DuloTvNav] ' + msg);
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

  function clusterRows(items) {
    if (!items.length) return [];
    var sorted = items.slice().sort(function (a, b) {
      return rect(a).cy - rect(b).cy || rect(a).cx - rect(b).cx;
    });
    var rows = [];
    sorted.forEach(function (el) {
      var cy = rect(el).cy;
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        var avg = rows[i].sumY / rows[i].items.length;
        if (Math.abs(cy - avg) <= ROW_Y_THRESHOLD) {
          row = rows[i];
          break;
        }
      }
      if (!row) {
        row = { items: [], sumY: 0, kind: 'content' };
        rows.push(row);
      }
      row.items.push(el);
      row.sumY += cy;
    });
    rows.forEach(function (row) {
      row.items.sort(function (a, b) {
        return rect(a).cx - rect(b).cx;
      });
      row.avgY = row.sumY / row.items.length;
      row.kind = classifyRow(row);
    });
    rows.sort(function (a, b) {
      return a.avgY - b.avgY;
    });
    return rows;
  }

  function classifyRow(row) {
    var navHits = 0;
    var appHits = 0;
    row.items.forEach(function (el) {
      var t = labelOf(el).toLowerCase();
      if (NAV_LABELS.test(t)) navHits++;
      if (/app|source|provider|stremio|addon|plugin/i.test(t)) appHits++;
      if (el.closest('nav, header, [role="navigation"], [role="banner"]')) navHits += 2;
    });
    if (navHits >= 2 || (navHits >= 1 && row.items.length <= 8)) return 'nav';
    if (appHits >= 2 && row.items.length >= 3) return 'apps';
    return 'content';
  }

  function buildGrid() {
    var items = collectFocusables();
    var rows = clusterRows(items);
    log('grid rows=' + rows.length + ' focusables=' + items.length);
    rows.forEach(function (row, idx) {
      log('  row' + idx + ' kind=' + row.kind + ' n=' + row.items.length);
    });
    return rows;
  }

  function findRowIndex(rows, el) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].items.indexOf(el) >= 0) return i;
    }
    return -1;
  }

  function indexInRow(row, el) {
    return row.items.indexOf(el);
  }

  function nearestInRow(row, cx) {
    var best = row.items[0];
    var bestD = 1e9;
    row.items.forEach(function (el) {
      var d = Math.abs(rect(el).cx - cx);
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    });
    return best;
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
    return el.closest(
      'section, article, [class*="row"], [class*="Row"], [class*="carousel"], [class*="Carousel"], [class*="slider"], [class*="Shelf"], [class*="rail"], [class*="list"]'
    );
  }

  function maybeExpandRow(focused) {
    var row = rowContainer(focused);
    if (!row) return;
    if (row.dataset.duloSeeAllDone === '1') return;
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

  function initialFocus() {
    var rows = buildGrid();
    if (!rows.length) return;
    var navRow = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].kind === 'nav') {
        navRow = rows[i];
        break;
      }
    }
    if (navRow && navRow.items.length) {
      setFocus(navRow.items[0], 'init-nav');
      return;
    }
    setFocus(rows[0].items[0], 'init-first');
  }

  function moveFocus(direction) {
    var rows = buildGrid();
    if (!rows.length) return false;

    var active = currentFocus || document.activeElement;
    if (!active || active === document.body) {
      initialFocus();
      return true;
    }

    var rowIdx = findRowIndex(rows, active);
    if (rowIdx < 0) {
      initialFocus();
      return true;
    }

    var row = rows[rowIdx];
    var idx = indexInRow(row, active);
    var r = rect(active);

    if (direction === 'left' || direction === 'right') {
      if (idx < 0) idx = 0;
      var nextIdx = direction === 'left' ? idx - 1 : idx + 1;
      if (nextIdx < 0) nextIdx = row.items.length - 1;
      if (nextIdx >= row.items.length) nextIdx = 0;
      setFocus(row.items[nextIdx], 'wrap-' + direction);
      return true;
    }

    if (direction === 'down') {
      if (rowIdx >= rows.length - 1) return true;
      var below = rows[rowIdx + 1];
      var target = nearestInRow(below, r.cx);
      setFocus(target, 'down row=' + (rowIdx + 1) + ' kind=' + below.kind);
      return true;
    }

    if (direction === 'up') {
      if (rowIdx <= 0) return true;
      var above = rows[rowIdx - 1];
      var targetUp = nearestInRow(above, r.cx);
      setFocus(targetUp, 'up row=' + (rowIdx - 1) + ' kind=' + above.kind);
      return true;
    }

    return false;
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

  window.__duloTvHandleKey = function (direction) {
    if (isEditable(document.activeElement)) return false;
    var dir = String(direction || '').toLowerCase();
    if (dir === 'enter' || dir === 'select') return handleEnter();
    if (dir === 'left' || dir === 'right' || dir === 'up' || dir === 'down') {
      return moveFocus(dir);
    }
    return false;
  };

  window.__duloTvNavRefresh = function () {
    log('refresh href=' + location.href);
    setTimeout(function () {
      buildGrid();
      if (!currentFocus || !document.body.contains(currentFocus)) initialFocus();
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

  var debounce;
  new MutationObserver(function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      buildGrid();
    }, 500);
  }).observe(document.documentElement, { childList: true, subtree: true });

  log('Netflix-style tv_navigation ready');
})();
