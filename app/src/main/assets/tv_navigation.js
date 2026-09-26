(function () {
  var firstInstall = !window.__duloTvNavInstalled;
  if (firstInstall) window.__duloTvNavInstalled = true;

  // MainActivity re-injects this asset on every real navigation (Home,
  // Search's retry-after-goHome, etc.), but on an SPA the document itself
  // often never actually reloads between those navigations - so a second
  // injection ran this whole IIFE again in the *same* still-alive DOM.
  // Each run has its own closure-scoped state (currentFocus, focusRingEl,
  // ...) and ensureFocusRingEl() only checked its own local variable before
  // creating a new ring element - never document.getElementById - so every
  // extra injection left its own permanent, independently-positioned
  // #dulo-tv-focus-ring div behind (confirmed live: three simultaneous ring
  // rectangles on screen from three stacked injections), plus a whole
  // second/third set of keydown listeners still processing every press.
  // Skip re-running entirely on any injection after the first; the already-
  // exposed window.__duloTvNavRefresh from that first run is enough to
  // re-sync focus for the new page state.
  if (!firstInstall) {
    if (window.__duloTvNavRefresh) window.__duloTvNavRefresh(true);
    return;
  }

  var SEE_ALL = /see\s*all|view\s*all|show\s*all|\bmore\b/i;
  var SKIP_LINK = /^skip\s*(to\s*)?(the\s*)?(main\s*)?(content|navigation|nav)\b/i;
  var TRUSTED_HOSTS = ['dulo.mov'];
  var currentFocus = null;
  var currentVisualFocusEl = null;
  var focusRingEl = null;

  // A body-level, position:fixed overlay for the focus ring, positioned via
  // getBoundingClientRect() to match the real focused element - NOT styled
  // in-place on the element itself. Found live: a card's own z-index (even
  // set to the max possible value) stayed invisible behind the site's fixed
  // bottom nav dock, because an intermediate ancestor (<main>, here) creates
  // its own stacking context (position:relative + z-index:10) that traps
  // every descendant z-index inside it - no value escapes to compete with a
  // sibling fixed element outside that stacking context. A fixed overlay
  // appended directly to <html> has no such ancestor, so it always wins.
  function ensureFocusRingEl() {
    if (focusRingEl && document.documentElement.contains(focusRingEl)) return focusRingEl;
    focusRingEl = document.createElement('div');
    focusRingEl.id = 'dulo-tv-focus-ring';
    focusRingEl.style.cssText =
      'position: fixed;' +
      'pointer-events: none;' +
      'z-index: 2147483647;' +
      // Embossed/beveled highlight instead of a flat outline ring: a light
      // inset edge on the top-left (simulated light source) and a dark inset
      // edge on the bottom-right give a raised, pressed-metal look; a hairline
      // outer edge keeps it visible against any background, and a soft drop
      // shadow lifts it off the page slightly.
      'box-shadow:' +
      'inset 2px 2px 2px rgba(255,255,255,0.5),' +
      'inset -2px -2px 2px rgba(0,0,0,0.6),' +
      '0 0 0 1px rgba(255,255,255,0.25),' +
      '0 6px 18px rgba(0,0,0,0.4);' +
      'border-radius: 8px;' +
      'transition: top 0.15s ease-out, left 0.15s ease-out, width 0.15s ease-out,' +
      'height 0.15s ease-out, opacity 0.15s ease-out;' +
      'opacity: 0;';
    document.documentElement.appendChild(focusRingEl);
    return focusRingEl;
  }

  function syncFocusRing() {
    var ring = ensureFocusRingEl();
    if (!currentVisualFocusEl || !document.body.contains(currentVisualFocusEl)) {
      ring.style.opacity = '0';
      return;
    }
    var r = currentVisualFocusEl.getBoundingClientRect();
    ring.style.opacity = '1';
    ring.style.top = r.top + 'px';
    ring.style.left = r.left + 'px';
    ring.style.width = r.width + 'px';
    ring.style.height = r.height + 'px';
  }

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

  var NATURALLY_INTERACTIVE_TAGS = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/;

  function collectFocusables() {
    var sel =
      'a[href], button, [role="button"], [role="link"], input, select, textarea, [tabindex]';
    var nodes = Array.prototype.slice.call(document.querySelectorAll(sel));
    var out = [];
    nodes.forEach(function (el) {
      if (el.disabled) return;
      if (el.closest('[inert], [aria-hidden="true"]')) return;
      if (!isVisible(el)) return;
      // tabIndex=-1 normally means "skip in spatial nav too" (e.g. our own
      // prepareTabOrder() stashes every other item's tabindex as -1 while one
      // is focused) - but real form controls are routinely given tabIndex=-1
      // by sites that manage focus programmatically (found live: dulo.mov's
      // search <input> does this) while still being the exact thing the user
      // needs to reach. Excluding it made moveFocus() unable to find the
      // input in its own freshly-collected candidate list on the very next
      // press, falling back to initialFocus() instead of moving - so Up/Down
      // from the search bar looked like it did nothing at all.
      if (el.tabIndex === -1 && !NATURALLY_INTERACTIVE_TAGS.test(el.tagName)) return;
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

  // Some real, clickable buttons report a 0x0 getBoundingClientRect (found
  // live: dulo.mov's header search icon does this) while their visible icon
  // is actually a differently-sized descendant. Putting the focus ring
  // (box-shadow + scale) on a 0x0 box renders it as a small square detached
  // from the icon instead of around it - use the first adequately-sized
  // descendant for the visual ring in that case, while DOM focus/click
  // handling still target the real element.
  function visualTargetFor(el) {
    var r = el.getBoundingClientRect();
    if (r.width >= 4 && r.height >= 4) return el;
    var descendants = el.querySelectorAll('*');
    for (var i = 0; i < descendants.length; i++) {
      var dr = descendants[i].getBoundingClientRect();
      if (dr.width >= 4 && dr.height >= 4) return descendants[i];
    }
    return el;
  }

  function setFocus(el, reason) {
    if (!el) return;
    var items = collectFocusables();
    prepareTabOrder(items);
    el.tabIndex = 0;
    currentVisualFocusEl = visualTargetFor(el);
    try {
      el.focus({ preventScroll: false });
    } catch (e) {
      try {
        el.focus();
      } catch (e2) { /* ignore */ }
    }
    currentFocus = el;
    scrollFocusedIntoView(el);
    // Sync after scrollIntoView so the ring reflects the post-scroll
    // position, plus once more next frame in case the scroll (or the site's
    // own layout reaction to a focus/click event) settles a frame later.
    syncFocusRing();
    requestAnimationFrame(syncFocusRing);
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
  // Require some alignment on the perpendicular axis, not just "anywhere in
  // that general direction" - confirmed live: with no such check, pressing
  // Right from the last button of a search-result card (top ~504) could jump
  // clean across the page to the header's "Clear search" button (top ~97),
  // since it's technically "to the right" with nothing better competing, and
  // isCandidate() alone had no vertical constraint to rule it out. Allow
  // direct overlap, or otherwise cap the perpendicular gap to a small
  // multiple of the elements' own size (a "close enough to the same row/
  // column" band) so a stray element far off in the other axis is rejected
  // as a candidate entirely instead of merely being scored lower.
  function perpendicularAligned(r0, r, axis) {
    var start0 = axis === 'y' ? r0.top : r0.left;
    var end0 = axis === 'y' ? r0.bottom : r0.right;
    var start1 = axis === 'y' ? r.top : r.left;
    var end1 = axis === 'y' ? r.bottom : r.right;
    if (Math.min(end0, end1) - Math.max(start0, start1) > 0) return true; // overlap
    var gap = start1 > end0 ? start1 - end0 : start0 - end1;
    var size = axis === 'y' ? Math.max(r0.height, r.height) : Math.max(r0.width, r.width);
    return gap < size * 2;
  }

  function isCandidate(r0, r, direction) {
    switch (direction) {
      case 'left': return r.right <= r0.left + 1 && perpendicularAligned(r0, r, 'y');
      case 'right': return r.left >= r0.right - 1 && perpendicularAligned(r0, r, 'y');
      case 'up': return r.bottom <= r0.top + 1 && perpendicularAligned(r0, r, 'x');
      case 'down': return r.top >= r0.bottom - 1 && perpendicularAligned(r0, r, 'x');
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

    if (best) {
      setFocus(best, 'move-' + direction);
      return true;
    }
    // No candidate currently rendered in that direction - the real content
    // (e.g. a "Channels & Apps" row) may simply be further down the page
    // than what's laid out in the viewport right now, especially behind a
    // fixed/sticky bottom bar that has nothing "below" it geometrically even
    // once new content scrolls into view above it. Scroll and retry instead
    // of just refusing to move - a TV remote has no scrollbar to fall back on.
    return scrollAndRetryFocus(direction, active);
  }

  function isDocumentScroller(node) {
    return node === document.scrollingElement || node === document.documentElement || node === document.body;
  }

  function findScrollParent(el, axis) {
    var node = el ? el.parentElement : null;
    while (node && node !== document.documentElement) {
      var style = window.getComputedStyle(node);
      if (axis === 'y') {
        var oy = style.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
      } else {
        var ox = style.overflowX;
        if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 1) return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function getScrollPos(container, axis) {
    if (isDocumentScroller(container)) return axis === 'y' ? window.scrollY : window.scrollX;
    return axis === 'y' ? container.scrollTop : container.scrollLeft;
  }

  function scrollContainerBy(container, axis, delta) {
    if (isDocumentScroller(container)) {
      window.scrollBy({ top: axis === 'y' ? delta : 0, left: axis === 'x' ? delta : 0, behavior: 'auto' });
    } else if (axis === 'y') {
      container.scrollTop += delta;
    } else {
      container.scrollLeft += delta;
    }
  }

  function scrollAndRetryFocus(direction, active) {
    var axis = direction === 'up' || direction === 'down' ? 'y' : 'x';
    var sign = direction === 'down' || direction === 'right' ? 1 : -1;
    var container = findScrollParent(active, axis);
    var before = getScrollPos(container, axis);
    var step = Math.round((axis === 'y' ? window.innerHeight : window.innerWidth) * 0.6) * sign;
    scrollContainerBy(container, axis, step);

    setTimeout(function () {
      var after = getScrollPos(container, axis);
      if (Math.abs(after - before) < 1) {
        log('scroll-' + direction + ' had no effect; nothing further that way');
        return;
      }

      var items = collectFocusables();
      if (!items.length) return;

      // Pick whichever now-visible focusable sits nearest the edge we
      // scrolled toward, rather than insisting on a strict spatial
      // relationship to the old focus: a fixed/sticky bar (e.g. a bottom tab
      // dock) has nothing "below" it geometrically even once new content is
      // revealed above it, so the direction-relative candidate search above
      // would still find nothing.
      var edge = direction === 'down' || direction === 'right' ? 0 : (axis === 'y' ? window.innerHeight : window.innerWidth);
      var best = null;
      var bestDist = Infinity;
      items.forEach(function (el) {
        if (el === active) return;
        var r = rect(el);
        var pos = axis === 'y' ? r.top : r.left;
        var dist = Math.abs(pos - edge);
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      });
      if (best) setFocus(best, 'scroll-' + direction);
    }, 220);

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

  var SEARCH_LABEL = /search/i;
  var SEARCH_INPUT_SEL =
    'input[type="search"], input[aria-label*="search" i], input[placeholder*="search" i], [role="searchbox"]';

  function focusSearchInput() {
    var input = document.querySelector(SEARCH_INPUT_SEL);
    if (!input || !isClickable(input)) return false;
    setFocus(input, 'search-input');
    try {
      input.focus();
    } catch (e) { /* ignore */ }
    return true;
  }

  // Not hidden/inert, but deliberately does NOT require real width/height
  // like isVisible() does (that's meant for spatial-nav focus candidates).
  // dulo.mov's own header Search button was found live to report a 0x0
  // bounding rect (likely a WebView-specific icon-sizing quirk) despite
  // being a real, clickable, on-screen button - confirmed by clicking it
  // directly and seeing it correctly reveal the search input.
  function isClickable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[inert], [aria-hidden="true"]')) return false;
    var st = window.getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  }

  // No fixed selector for dulo.mov's search trigger is known ahead of time,
  // so this looks generically for an input already on the page, then for an
  // icon/button labeled "search" to reveal one.
  window.__duloTvOpenSearch = function () {
    log('open search requested');
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch (e) { /* ignore */ }

    if (focusSearchInput()) return true;

    var candidates = document.querySelectorAll('button, [role="button"], a, [role="link"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var label = el.getAttribute('aria-label') || el.getAttribute('title') || labelOf(el) || '';
      if (SEARCH_LABEL.test(label) && isClickable(el)) {
        try {
          el.click();
        } catch (e) {
          continue;
        }
        log('clicked search trigger "' + label + '"');
        setTimeout(focusSearchInput, 300);
        return true;
      }
    }
    log('no search control found on page');
    return false;
  };

  // The visual ring itself is drawn by the fixed, body-level overlay
  // (syncFocusRing/ensureFocusRingEl) instead of an in-place style, since an
  // in-place z-index can be trapped by an ancestor's own stacking context
  // (found live: a card inside dulo.mov's <main>, which sets its own
  // position:relative + z-index:10, stayed behind the site's fixed bottom
  // nav dock no matter how high its own z-index went). Just suppress the
  // native focus outline here, so it doesn't show in addition to our ring.
  function injectStyles() {
    if (document.getElementById('dulo-tv-nav-style')) return;
    var s = document.createElement('style');
    s.id = 'dulo-tv-nav-style';
    s.textContent =
      'a:focus, button:focus, [role="button"]:focus, [tabindex]:focus {' +
      'outline: none !important;' +
      '}';
    document.head.appendChild(s);
  }

  // Dulo.mov's own player exposes browser-native concepts (Fullscreen,
  // Picture-in-picture) that don't make sense inside an already-fullscreen TV
  // app with no windowing - hide them. Verified via live DOM inspection
  // (chrome://inspect) that these are the player's actual aria-labels, not a
  // guess.
  function injectDuloPlayerStyles() {
    if (document.getElementById('dulo-tv-player-style')) return;
    var s = document.createElement('style');
    s.id = 'dulo-tv-player-style';
    s.textContent =
      'button[aria-label="Fullscreen"], button[aria-label="Picture in picture"] {' +
      'display: none !important;' +
      '}' +
      // The player's own class sets object-fit: fill, which stretches the
      // frame non-uniformly to fill a 16:9 box regardless of the source's
      // real aspect ratio - confirmed live: a 3840x1588 (~2.42:1 cinemascope)
      // source squeezed into a 960x540 (16:9) box, visibly distorting the
      // picture. "contain" scales it uniformly and letterboxes instead,
      // which is the correct behavior for wider-than-16:9 sources.
      'video.object-fill, video[class*="object-fill"] {' +
      'object-fit: contain !important;' +
      '}';
    document.head.appendChild(s);
  }

  function isVideoPlayingNow() {
    var v = document.querySelector('video');
    return !!(v && !v.paused && !v.ended);
  }

  // Deliberately broader than isVideoPlayingNow(): Kodi-style seek/play-pause
  // should engage whenever there's a video to control, paused or not (e.g.
  // scrubbing while paused, or resuming with Enter) - only the auto-hide
  // timer specifically cares about "is it actively playing right now".
  function hasVideo() {
    return !!document.querySelector('video');
  }

  // The player's own controls overlay never auto-hides while playing (tested
  // live: neither synthetic pointer activity nor releasing DOM focus made it
  // hide, even after several seconds of true idle - it appears to have no
  // built-in idle-hide at all). Drive it ourselves instead of guessing at
  // whatever internal trigger it might be missing.
  var OVERLAY_HIDE_DELAY = 4000;
  var overlayHideTimer = null;

  function findPlayerControlsOverlay() {
    var anchor = document.querySelector('button[aria-label="Pause"], button[aria-label="Play"]');
    return anchor ? anchor.closest('[class*="transition-opacity"]') : null;
  }

  function showPlayerControlsOverlay() {
    var overlay = findPlayerControlsOverlay();
    if (overlay) {
      overlay.style.opacity = '';
      overlay.style.pointerEvents = '';
    }
    schedulePlayerControlsHide();
  }

  function hidePlayerControlsOverlay() {
    if (!isVideoPlayingNow()) return; // only auto-hide while actually playing
    var overlay = findPlayerControlsOverlay();
    if (!overlay) return;
    // NOTE: deliberately does NOT skip hiding when focus is inside the
    // overlay. Our own spatial nav always keeps *something* focused, and
    // that's very often a button inside this exact overlay - a "don't hide
    // while focus is inside" guard here would never let the hide fire at
    // all (confirmed live: it didn't), since focus never leaves on its own
    // during video playback. Blur first so a later Enter-on-stale-focus
    // doesn't silently activate a now-invisible button.
    if (overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    // Also drop our own focus tracking, not just DOM focus: otherwise
    // isBrowsingControls() below would keep reporting "browsing" (based on
    // currentFocus, not document.activeElement) even after the overlay is
    // hidden, wrongly keeping Left/Right/Enter in button-navigation mode
    // instead of falling back to direct seek/play-pause.
    if (overlay.contains(currentFocus)) currentFocus = null;
    // currentVisualFocusEl drives the fixed ring overlay independently of
    // currentFocus/DOM focus - clearing only currentFocus above left the
    // ring rendered at the last-focused button's on-screen position even
    // after that button went invisible (opacity: 0 doesn't remove it from
    // the DOM or collapse its rect), showing as a stray empty rectangle
    // that outlived the controls it was supposed to be highlighting.
    if (overlay.contains(currentVisualFocusEl)) {
      currentVisualFocusEl = null;
      syncFocusRing();
    }
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
  }

  function schedulePlayerControlsHide() {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = setTimeout(hidePlayerControlsOverlay, OVERLAY_HIDE_DELAY);
  }

  // True once the user has explicitly moved focus onto a button inside the
  // controls overlay (via Up/Down) - only then do Left/Right/Enter mean
  // "navigate/activate that button row" instead of "seek/toggle play".
  function isBrowsingControls() {
    var overlay = findPlayerControlsOverlay();
    return !!(overlay && currentFocus && document.body.contains(currentFocus) && overlay.contains(currentFocus));
  }

  function focusIsStale() {
    return !currentFocus || !document.body.contains(currentFocus) || !isVisible(currentFocus);
  }

  // Called from MainActivity's onKeyDown BEFORE any WebView-history/Home
  // navigation, so a "layer" the page itself opened (dulo.mov's own
  // Subtitles/Settings panel, e.g.) gets closed in place instead of Back
  // falling straight through to goBack()/goHome() and landing on an
  // unrelated screen while the video was still playing underneath.
  window.__duloTvHandleBack = function () {
    // dulo.mov's markup (aria-labels, focus-visible rings, Tailwind utility
    // classes) matches the conventions of modern accessible component
    // libraries (Radix UI / Headless UI / shadcn-style), which universally
    // close an open dialog/menu on Escape - dispatching one closes whatever
    // panel is open without us needing to know its specific markup or add a
    // new special case per panel.
    var hasDialog = document.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
    if (hasDialog) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      return true;
    }
    // Not a real "screen" to navigate away from either - just step back out
    // of button-browsing mode on the player controls (see
    // __duloTvHandleKey below) to plain seek mode.
    if (isTrustedHost() && isBrowsingControls()) {
      if (document.activeElement) document.activeElement.blur();
      currentFocus = null;
      return true;
    }
    return false;
  };

  // Kodi-style playback controls with two modes, distinguished by whether
  // focus is currently sitting on a button inside the controls overlay:
  //
  //  - Default ("seek mode"): Left/Right directly seek and Enter directly
  //    toggles play/pause (via tv_playback.js against video.currentTime/
  //    play()/pause(), not dulo.mov's own key handling - found live to be
  //    unreliable, e.g. a "Left" press was observed increasing currentTime
  //    instead of decreasing it, and letting these fall through to Android's
  //    default key handling let the OS intercept them as media-session keys).
  //  - "Browsing" (entered via Up/Down, which moves focus onto a button):
  //    Left/Right/Enter fall through to normal spatial nav instead, so the
  //    user can reach and activate Rewind/Forward/Mute/Subtitles/etc.
  //    buttons directly - this is what a global always-seek policy would
  //    otherwise make unreachable.
  //
  // Losing focus (idle-hide, or anything that clears currentFocus) drops
  // back to seek mode automatically.
  //
  // Deliberately does NOT skip handling when document.activeElement is
  // editable (an <input>, e.g.). That guard used to make sense: it let
  // Left/Right/Enter fall through to the WebView's native handling so a
  // focused text field's own cursor movement/typing worked normally.
  // MainActivity no longer has any such native fallback for D-pad keys at
  // all (see dispatchKeyEvent), so with the guard in place, D-pad became a
  // complete dead end the instant a text field gained focus: Up/Down/Enter
  // all silently no-op'd here with no way to navigate off the field or
  // confirm anything (found live: this is exactly what made dulo.mov's
  // search box impossible to escape or use with its own on-screen
  // keyboard). Real typing still works fine via a real keyboard/IME, since
  // plain character keys were never part of DPAD_KEYS in Kotlin to begin
  // with and always reach the page directly.
  window.__duloTvHandleKey = function (direction) {
    var dir = String(direction || '').toLowerCase();

    if (isTrustedHost() && hasVideo()) {
      var overlay = findPlayerControlsOverlay();
      if (overlay && overlay.style.opacity === '0') {
        // Controls are currently auto-hidden: this press just reveals them
        // (matching normal player behavior) rather than also acting on
        // elements that were invisible a moment ago.
        showPlayerControlsOverlay();
        return true;
      }
      showPlayerControlsOverlay(); // already visible: reset the idle-hide timer

      if (!isBrowsingControls()) {
        if ((dir === 'left' || dir === 'right') && window.__duloTvSeek) {
          return window.__duloTvSeek(dir);
        }
        if ((dir === 'enter' || dir === 'select') && window.__duloTvTogglePlayPause) {
          return window.__duloTvTogglePlayPause();
        }
        // up/down fall through to moveFocus below, which naturally enters
        // "browsing" mode by landing focus on a button in the row.
      }
      // else: browsing controls - fall through to normal handling below so
      // Left/Right/Enter move between/activate buttons instead.
    }

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

  // Keep the fixed focus-ring overlay tracking its target through any
  // scrolling (capture:true so this also fires for scrolls on an inner
  // scrollable container, not just the document) or layout/viewport change.
  window.addEventListener('scroll', syncFocusRing, true);
  window.addEventListener('resize', syncFocusRing);

  if (isTrustedHost()) {
    injectDuloPlayerStyles();
    // Capture-phase 'play' fires for any <video> as soon as playback starts
    // (including on resume after a pause) - (re)arm the idle-hide timer then.
    document.addEventListener(
      'play',
      function (e) {
        if (e.target && e.target.tagName === 'VIDEO') showPlayerControlsOverlay();
      },
      true
    );
  }

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
