(function () {
  // Dulo-style remote controls for video players embedded from other sites
  // (found live: dulo.site's vidstuck.cc frame). Registered by MainActivity via
  // addDocumentStartJavaScript, so it runs inside cross-origin frames the page
  // scripts can't reach. Only acts in sub-frames that have a <video>; it drives
  // that <video> directly (seek/play/pause) and never touches its source.
  if (window.top === window || window.__duloTvFramePlayer) return;
  window.__duloTvFramePlayer = true;

  var STEPS = [10, 10, 20, 30, 60];   // seconds per press; grows on quick repeats
  var STREAK_MS = 1500, OSD_MS = 3000;
  var streak = 0, lastDir = 0, lastAt = 0, osd = null, osdTimer = null;

  function video() {
    var vs = document.querySelectorAll('video'), best = null, area = 0;
    for (var i = 0; i < vs.length; i++) {
      var r = vs[i].getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = vs[i]; }
    }
    return best;
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function showOsd(v, note) {
    if (!osd) {
      osd = document.createElement('div');
      osd.style.cssText =
        'position:fixed;left:4%;right:4%;bottom:6%;z-index:2147483647;pointer-events:none;' +
        'font:600 18px/1.4 sans-serif;color:#fff;text-shadow:0 1px 3px #000;transition:opacity .2s;';
      osd.innerHTML =
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
        '<span data-k="note"></span><span data-k="time"></span></div>' +
        '<div style="height:6px;border-radius:3px;background:rgba(255,255,255,.3)">' +
        '<div data-k="bar" style="height:100%;border-radius:3px;background:#f5a623;width:0"></div></div>';
      (document.body || document.documentElement).appendChild(osd);
    }
    var d = v.duration || 0;
    osd.querySelector('[data-k="note"]').textContent = note || (v.paused ? 'Paused' : '');
    osd.querySelector('[data-k="time"]').textContent = fmt(v.currentTime) + (d ? ' / ' + fmt(d) : '');
    osd.querySelector('[data-k="bar"]').style.width = (d ? (v.currentTime / d) * 100 : 0) + '%';
    osd.style.opacity = '1';
    clearTimeout(osdTimer);
    if (!v.paused) osdTimer = setTimeout(function () { osd.style.opacity = '0'; }, OSD_MS);
  }

  function seek(v, dir) {
    var now = Date.now();
    streak = dir === lastDir && now - lastAt < STREAK_MS ? Math.min(streak + 1, STEPS.length - 1) : 0;
    lastDir = dir; lastAt = now;
    var step = STEPS[streak] * dir;
    var d = v.duration || Infinity;
    v.currentTime = Math.min(Math.max(0, v.currentTime + step), d - 1);
    showOsd(v, (dir > 0 ? '+' : '−') + Math.abs(step) + 's');
  }

  function toggle(v) {
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
    setTimeout(function () { showOsd(v); }, 50);
  }

  // Capture phase on window, so the player's own key handling (dulo.site's
  // fixed 15 s jump) doesn't also act on the same press.
  window.addEventListener('keydown', function (e) {
    var v = video();
    if (!v) return;
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') seek(v, k === 'ArrowRight' ? 1 : -1);
    else if (k === 'Enter' || k === ' ' || k === 'MediaPlayPause') toggle(v);
    else return;   // Up/Down etc. stay with the player
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // Remote keys relayed by the app's page script (tv_navigation.js) - only
  // from our direct parent page, never from other frames.
  window.addEventListener('message', function (e) {
    var k = e.data && e.data.duloTvKey;
    if (!k || e.source !== window.parent) return;
    var v = video();
    if (!v) return;
    if (k === 'left' || k === 'right') seek(v, k === 'right' ? 1 : -1);
    else if (k === 'enter') toggle(v);
  });

  document.addEventListener('pause', function (e) { if (e.target.tagName === 'VIDEO') showOsd(e.target); }, true);
  document.addEventListener('play', function (e) { if (e.target.tagName === 'VIDEO') showOsd(e.target); }, true);
})();
