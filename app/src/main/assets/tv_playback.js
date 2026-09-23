(function () {
  if (window.__duloTvPlaybackInstalled) return;
  window.__duloTvPlaybackInstalled = true;

  var state = {
    playing: false,
    title: '',
    year: '',
    languages: [],
    textTracks: [],
    audioTracks: [],
    pageButtons: [],
    playbackRate: 1,
  };

  function log(msg) {
    try {
      if (window.DuloTvBridge && window.DuloTvBridge.log) {
        window.DuloTvBridge.log('[playback] ' + msg);
      }
    } catch (e) { /* ignore */ }
  }

  function activeVideo() {
    var videos = document.querySelectorAll('video');
    for (var i = videos.length - 1; i >= 0; i--) {
      var v = videos[i];
      if (!v.paused || v.readyState > 2 || v.currentTime > 0) return v;
    }
    return videos.length ? videos[videos.length - 1] : null;
  }

  function scrapeTitle() {
    var t =
      document.querySelector('meta[property="og:title"]') ||
      document.querySelector('meta[name="title"]');
    if (t && t.content) return t.content.trim();
    var h1 = document.querySelector('h1');
    if (h1) return h1.textContent.trim();
    return document.title.replace(/\s*[-|].*$/, '').trim();
  }

  function scrapeYear(title) {
    var m = (title || '').match(/\((19|20)\d{2}\)/);
    if (m) return m[0].replace(/[()]/g, '');
    var y = document.querySelector('[class*="year"], time[datetime]');
    if (y) {
      var dt = y.getAttribute('datetime') || y.textContent || '';
      m = dt.match(/(19|20)\d{2}/);
      if (m) return m[0];
    }
    return '';
  }

  function scrapeLanguageButtons() {
    var out = [];
    var sel = document.querySelectorAll(
      'select[name*="lang" i], select[id*="lang" i], [data-lang], [class*="audio" i] button, [class*="language" i] button, [class*="lang" i] a'
    );
    sel.forEach(function (el, idx) {
      var label = (el.textContent || el.getAttribute('aria-label') || el.value || 'Option ' + idx)
        .replace(/\s+/g, ' ')
        .trim();
      if (label.length > 0 && label.length < 48) {
        out.push({ label: label, index: idx, tag: el.tagName });
      }
    });
    return out.slice(0, 12);
  }

  function readTextTracks(v) {
    var tracks = [];
    if (!v) return tracks;
    var list = v.textTracks;
    if (!list) return tracks;
    for (var i = 0; i < list.length; i++) {
      var tr = list[i];
      tracks.push({
        index: i,
        label: tr.label || tr.language || 'Track ' + (i + 1),
        language: tr.language || '',
        mode: tr.mode,
      });
    }
    return tracks;
  }

  function readAudioTracks(v) {
    var tracks = [];
    if (!v || !v.audioTracks) return tracks;
    for (var i = 0; i < v.audioTracks.length; i++) {
      var tr = v.audioTracks[i];
      tracks.push({
        index: i,
        label: tr.label || tr.language || 'Audio ' + (i + 1),
        language: tr.language || '',
        enabled: tr.enabled,
      });
    }
    return tracks;
  }

  function syncState() {
    var v = activeVideo();
    state.playing = !!(v && !v.paused && !v.ended);
    state.title = scrapeTitle();
    state.year = scrapeYear(state.title);
    state.pageButtons = scrapeLanguageButtons();
    state.textTracks = readTextTracks(v);
    state.audioTracks = readAudioTracks(v);
    state.playbackRate = v ? v.playbackRate : 1;
    try {
      if (window.DuloTvBridge && window.DuloTvBridge.onPlaybackMeta) {
        window.DuloTvBridge.onPlaybackMeta(JSON.stringify(state));
      }
    } catch (e) { /* ignore */ }
  }

  function clickPreparePlay() {
    var nodes = document.querySelectorAll('button, [role="button"], a');
    nodes.forEach(function (el) {
      var t = (el.textContent || '').toLowerCase();
      if (/prepar|loading|click to play|tap to play|play now/.test(t)) {
        try {
          el.click();
        } catch (e) { /* ignore */ }
      }
    });
  }

  function enhanceVideo(v) {
    if (!v || v.dataset.duloPlayback === '1') return;
    v.dataset.duloPlayback = '1';
    v.setAttribute('playsinline', 'true');
    v.setAttribute('webkit-playsinline', 'true');
    v.preload = 'auto';
    v.addEventListener(
      'loadeddata',
      function () {
        v.play().catch(function () { /* needs gesture on some builds */ });
      },
      { once: true }
    );
    v.addEventListener('waiting', function () {
      log('buffering');
      clickPreparePlay();
    });
    v.addEventListener('playing', function () {
      log('playing');
      syncState();
    });
    // Event-driven pause sync matters: MainActivity's dispatchKeyEvent uses
    // state.playing to decide whether to hand D-pad to the WebView natively
    // (for the player's own seek/volume shortcuts) or to our spatial-nav
    // bridge - without this, that decision could lag up to one poll interval
    // (2.5s) behind an actual pause.
    v.addEventListener('pause', function () {
      log('paused');
      syncState();
    });
    v.addEventListener('loadedmetadata', syncState);
  }

  function scanVideos() {
    document.querySelectorAll('video').forEach(enhanceVideo);
    clickPreparePlay();
    syncState();
  }

  window.__duloTvIsPlaying = function () {
    var v = activeVideo();
    return !!(v && (state.playing || v.readyState >= 2));
  };

  window.__duloTvGetPlaybackState = function () {
    syncState();
    return JSON.stringify(state);
  };

  window.__duloTvSelectTextTrack = function (index) {
    var v = activeVideo();
    if (!v || !v.textTracks) return false;
    for (var i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === index ? 'showing' : 'disabled';
    }
    syncState();
    return true;
  };

  window.__duloTvSelectAudioTrack = function (index) {
    var v = activeVideo();
    if (!v || !v.audioTracks) return false;
    for (var i = 0; i < v.audioTracks.length; i++) {
      v.audioTracks[i].enabled = i === index;
    }
    syncState();
    return true;
  };

  // playbackRate is a standard HTML5 <video> property, universally
  // available regardless of the site's own player UI/streaming setup -
  // unlike quality (which depends on dulo.mov's specific HLS.js instance,
  // not reachable from an injected script that runs after page load).
  window.__duloTvSetPlaybackRate = function (rate) {
    var v = activeVideo();
    if (!v) return false;
    var r = parseFloat(rate);
    if (!isFinite(r) || r <= 0) return false;
    v.playbackRate = r;
    syncState();
    return true;
  };

  window.__duloTvClickLanguageOption = function (index) {
    var sel = document.querySelectorAll(
      'select[name*="lang" i], select[id*="lang" i], [data-lang], [class*="audio" i] button, [class*="language" i] button, [class*="lang" i] a'
    );
    var el = sel[index];
    if (!el) return false;
    try {
      el.click();
      if (el.tagName === 'SELECT') {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  function decodeBase64Utf8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (window.TextDecoder) return new TextDecoder('utf-8').decode(bytes);
    return binary; // last-resort fallback: ASCII-only browsers
  }

  window.__duloTvApplySubtitle = function (vttContentBase64, label) {
    var v = activeVideo();
    if (!v || !vttContentBase64) return false;
    var vttContent;
    try {
      vttContent = decodeBase64Utf8(vttContentBase64);
    } catch (e) {
      log('subtitle decode failed: ' + e);
      return false;
    }
    var old = document.getElementById('dulo-external-subtitle-track');
    if (old) old.remove();
    var blob = new Blob([vttContent], { type: 'text/vtt' });
    var url = URL.createObjectURL(blob);
    var track = document.createElement('track');
    track.id = 'dulo-external-subtitle-track';
    track.kind = 'subtitles';
    track.label = label || 'External';
    track.srclang = (label || 'en').trim().slice(0, 2).toLowerCase() || 'en';
    track.src = url;
    v.appendChild(track);
    track.track.mode = 'showing';
    syncState();
    log('external subtitle applied ' + (label || ''));
    return true;
  };

  setInterval(scanVideos, 2500);
  document.addEventListener('click', function () {
    setTimeout(scanVideos, 500);
  });
  log('tv_playback.js ready');
})();
