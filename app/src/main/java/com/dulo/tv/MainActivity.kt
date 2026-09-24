package com.dulo.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import com.dulo.tv.databinding.ActivityMainBinding
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * WebView wrapper for https://dulo.mov with TV navigation, playback helpers,
 * OpenSubtitles-style external subtitles, and in-page language/track selection.
 */
class MainActivity : Activity(), DuloTvJsBridge.PlaybackListener {

    private lateinit var binding: ActivityMainBinding

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private var lastPlaybackMeta = JSONObject()
    private var jsBridgeAttached = false

    companion object {
        private const val TAG = "DuloTvNav"
        private const val HOME_URL = "https://dulo.mov"

        /**
         * tv_navigation.js (D-pad spatial focus) is injected on every host so the
         * remote stays usable even if the user follows a link off dulo.mov. Only
         * these hosts additionally get tv_playback.js: it auto-clicks anything
         * that looks like a "prepare/tap to play" button, which is exactly what
         * a third-party site's ad interstitials look like - so that side effect
         * must not follow the user onto whatever a link points to.
         * (tv_navigation.js's own auto-"See all" click is separately gated on
         * this same allowlist at runtime, via isTrustedHost() in the script.)
         */
        private val TRUSTED_HOST_ALLOWLIST = setOf("dulo.mov")

        private val SPEED_OPTIONS = listOf(0.5, 0.75, 1.0, 1.25, 1.5, 2.0)

        private const val TV_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 12; Android TV; Dulo TV) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 TV Safari/537.36"

        private val DPAD_KEYS = setOf(
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_BACK,
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        setupWebView()

        // Always start at the dulo.mov home screen (ignore any saved WebView URL).
        binding.webview.loadUrl(HOME_URL)
    }

    override fun onPlaybackMeta(json: String) {
        try {
            lastPlaybackMeta = JSONObject(json)
        } catch (e: Exception) {
            Log.w(TAG, "bad playback meta", e)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webView = binding.webview
        val settings = webView.settings

        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        @Suppress("DEPRECATION")
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.userAgentString = TV_USER_AGENT
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocus()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                Log.d(TAG, "navigate url=$url")
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "page finished url=$url")
                if (view != null) {
                    injectScripts(view, url?.let { Uri.parse(it).host })
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                binding.webview.visibility = View.GONE
                binding.fullscreenContainer.visibility = View.VISIBLE
                binding.fullscreenContainer.addView(
                    view,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                )
            }

            override fun onHideCustomView() {
                exitFullscreen()
            }
        }
    }

    /** Shared cleanup for leaving a WebChromeClient custom (fullscreen) view. */
    private fun exitFullscreen() {
        binding.fullscreenContainer.visibility = View.GONE
        binding.fullscreenContainer.removeAllViews()
        binding.webview.visibility = View.VISIBLE
        customViewCallback?.onCustomViewHidden()
        customView = null
        customViewCallback = null
    }

    /** True once the WebView is showing dulo.mov's own home page (root path). */
    private fun isOnHome(): Boolean {
        val url = binding.webview.url ?: return false
        val uri = Uri.parse(url)
        val samehost = uri.host?.equals(Uri.parse(HOME_URL).host, ignoreCase = true) == true
        val rootPath = uri.path?.trim('/').isNullOrEmpty()
        return samehost && rootPath
    }

    private fun isTrustedHost(host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        val h = host.lowercase()
        return TRUSTED_HOST_ALLOWLIST.any { h == it || h.endsWith(".$it") }
    }

    /**
     * DuloTvBridge exposes onPlaybackMeta/log to whatever page currently holds
     * the WebView. Attaching it once at setup meant any third-party site reached
     * via a link could call it too - narrow, since only those two methods exist
     * today, but a loaded gun for the next one added. Attach/detach it per page
     * load instead, gated on the same trusted-host allowlist as tv_playback.js.
     */
    private fun updateJsBridge(webView: WebView, host: String?) {
        val trusted = isTrustedHost(host)
        if (trusted && !jsBridgeAttached) {
            webView.addJavascriptInterface(DuloTvJsBridge(this), "DuloTvBridge")
            jsBridgeAttached = true
        } else if (!trusted && jsBridgeAttached) {
            webView.removeJavascriptInterface("DuloTvBridge")
            jsBridgeAttached = false
        }
    }

    private fun injectScripts(webView: WebView, host: String?) {
        // Spatial D-pad navigation is generic/non-destructive - safe on any site.
        injectAsset(webView, "tv_navigation.js")
        webView.evaluateJavascript(
            "if (window.__duloTvNavRefresh) window.__duloTvNavRefresh();",
            null
        )

        updateJsBridge(webView, host)

        if (!isTrustedHost(host)) {
            Log.d(TAG, "host=$host not trusted; skipping playback extras")
            return
        }

        injectAsset(webView, "tv_playback.js")
    }

    private fun goHome() {
        binding.webview.loadUrl(HOME_URL)
        Toast.makeText(this, "Home", Toast.LENGTH_SHORT).show()
    }

    private fun injectAsset(webView: WebView, assetName: String) {
        try {
            val script = assets.open(assetName).bufferedReader().use { it.readText() }
            webView.evaluateJavascript(script) { result ->
                Log.d(TAG, "injected $assetName result=$result")
            }
        } catch (e: Exception) {
            Log.e(TAG, "failed to inject $assetName", e)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_CAPTIONS, KeyEvent.KEYCODE_INFO -> {
                    showMainMenu()
                    return true
                }
                KeyEvent.KEYCODE_SEARCH -> {
                    openSearch()
                    return true
                }
            }
        }
        if (customView != null) {
            // True Fullscreen-API video: no overlay UI of ours applies here at
            // all, hand everything to the native page.
            return super.dispatchKeyEvent(event)
        }
        // D-pad always routes through our spatial-nav bridge below and we always
        // consume it (never fall through to super.dispatchKeyEvent for these
        // keys). An earlier version let Left/Right bypass to the page natively
        // for seeking; falling through to Android's default key handling that
        // way is what let the OS itself intercept them as media-session
        // transport keys during playback (observed as Left/Right toggling
        // play/pause instead of seeking) - a Kodi-style player needs full
        // control of D-pad, not a native pass-through. Seeking (with
        // acceleration on repeated presses) and direct play/pause toggling are
        // now both implemented ourselves in tv_playback.js instead.
        if (event.action == KeyEvent.ACTION_DOWN && event.keyCode in DPAD_KEYS) {
            Log.d(
                TAG,
                "key down code=${event.keyCode} (${KeyEvent.keyCodeToString(event.keyCode)}) " +
                    "repeat=${event.repeatCount}"
            )
            val direction = dpadDirection(event.keyCode)
            if (direction != null) {
                // repeatCount > 0 means this is the OS's own auto-repeat echo from
                // a held-down key, not a new press - Android fires these as
                // additional ACTION_DOWN events (not a separate key-up/down pair)
                // at whatever rate the platform's repeat timer uses. Forwarding
                // those too made holding a direction fire many rapid seek
                // presses, compounding our own streak-based acceleration
                // explosively (a single "hold" jumped over 600 seconds). Only
                // forward genuinely new presses; silently ignore repeat echoes.
                if (event.repeatCount == 0) {
                    forwardDpadToPage(direction)
                }
                return true
            }
            // BACK isn't mapped to a direction - fall through to
            // onKeyDown's dedicated back-stack handling, unchanged.
        }
        return super.dispatchKeyEvent(event)
    }

    private fun showMainMenu() {
        AlertDialog.Builder(this)
            .setTitle("Dulo TV")
            .setItems(
                arrayOf(
                    "Home",
                    "Search",
                    "Subtitles",
                    "Audio track",
                    "Speed",
                )
            ) { dialog, which ->
                when (which) {
                    0 -> goHome()
                    1 -> openSearch()
                    2 -> withPlaybackState(::openSubtitleDialog)
                    3 -> withPlaybackState(::openAudioDialog)
                    4 -> withPlaybackState(::openSpeedDialog)
                }
                dialog.dismiss()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    /** Finds and opens dulo.mov's own search UI (input or icon trigger). */
    private fun openSearch() {
        binding.webview.evaluateJavascript(
            "(window.__duloTvOpenSearch ? window.__duloTvOpenSearch() : false);"
        ) { result ->
            runOnUiThread {
                if (result != "true") {
                    // No search control on the current page (e.g. a watch/player
                    // page, which doesn't have one at all) - go home first, where
                    // dulo.mov's persistent header search always lives, then retry
                    // once it's loaded and scripts are re-injected.
                    goHome()
                    binding.webview.postDelayed({
                        binding.webview.evaluateJavascript(
                            "window.__duloTvOpenSearch && window.__duloTvOpenSearch();",
                            null
                        )
                    }, 1500)
                }
            }
        }
    }

    private fun withPlaybackState(action: (JSONObject) -> Unit) {
        binding.webview.evaluateJavascript(
            "(window.__duloTvGetPlaybackState ? window.__duloTvGetPlaybackState() : null);"
        ) { raw ->
            runOnUiThread {
                action(parseJsJson(raw))
            }
        }
    }

    private fun parseJsJson(raw: String?): JSONObject {
        if (raw.isNullOrBlank() || raw == "null") return lastPlaybackMeta
        return try {
            val parsed = JSONTokener(raw).nextValue()
            when (parsed) {
                is String -> JSONObject(parsed)
                is JSONObject -> parsed
                else -> lastPlaybackMeta
            }
        } catch (e: Exception) {
            Log.w(TAG, "parseJsJson failed: $raw", e)
            lastPlaybackMeta
        }
    }

    private fun openSubtitleDialog(state: JSONObject) {
        val items = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()

        items.add("Off — built-in subtitles")
        actions.add { selectTextTrack(-1) }

        val textTracks = state.optJSONArray("textTracks") ?: JSONArray()
        for (i in 0 until textTracks.length()) {
            val tr = textTracks.optJSONObject(i) ?: continue
            items.add(tr.optString("label", "Track ${i + 1}"))
            val idx = tr.optInt("index", i)
            actions.add { selectTextTrack(idx) }
        }

        items.add("Search OpenSubtitles (en, hi, ta, te…)")
        actions.add { searchOpenSubtitles(state) }

        items.add("Set OpenSubtitles API key…")
        actions.add { promptOpenSubtitlesApiKey() }

        showChoiceDialog("Subtitles", items, actions)
    }

    private fun openAudioDialog(state: JSONObject) {
        val audioTracks = state.optJSONArray("audioTracks") ?: JSONArray()
        if (audioTracks.length() == 0) {
            Toast.makeText(this, "No alternate audio tracks available for this video", Toast.LENGTH_SHORT).show()
            return
        }
        val items = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()
        for (i in 0 until audioTracks.length()) {
            val tr = audioTracks.optJSONObject(i) ?: continue
            items.add(tr.optString("label", "Audio ${i + 1}"))
            val idx = tr.optInt("index", i)
            actions.add { selectAudioTrack(idx) }
        }
        showChoiceDialog("Audio track", items, actions)
    }

    // playbackRate is a standard <video> property, always available regardless
    // of the site's own player - unlike quality, which would require reaching
    // into dulo.mov's specific hls.js instance (no reference to it is exposed
    // on window or the video element for script injected after page load to
    // find, so quality selection isn't offered here at all).
    private fun openSpeedDialog(state: JSONObject) {
        val currentRate = state.optDouble("playbackRate", 1.0)
        val items = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()
        for (rate in SPEED_OPTIONS) {
            val mark = if (Math.abs(rate - currentRate) < 0.01) " ✓" else ""
            items.add("${rate}x$mark")
            actions.add { setPlaybackRate(rate) }
        }
        showChoiceDialog("Playback speed", items, actions)
    }

    private fun showChoiceDialog(title: String, items: List<String>, actions: List<() -> Unit>) {
        AlertDialog.Builder(this)
            .setTitle(title)
            .setItems(items.toTypedArray()) { dialog, which ->
                if (which in actions.indices) actions[which].invoke()
                dialog.dismiss()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun selectTextTrack(index: Int) {
        if (index < 0) {
            binding.webview.evaluateJavascript(
                """
                (function(){
                  var v=document.querySelector('video');
                  if(!v||!v.textTracks)return;
                  for(var i=0;i<v.textTracks.length;i++) v.textTracks[i].mode='disabled';
                  var ext=document.getElementById('dulo-external-subtitle-track');
                  if(ext) ext.track.mode='disabled';
                })();
                """.trimIndent(),
                null
            )
            return
        }
        binding.webview.evaluateJavascript(
            "window.__duloTvSelectTextTrack($index);",
            null
        )
    }

    private fun selectAudioTrack(index: Int) {
        binding.webview.evaluateJavascript(
            "window.__duloTvSelectAudioTrack($index);",
            null
        )
    }

    private fun setPlaybackRate(rate: Double) {
        binding.webview.evaluateJavascript(
            "window.__duloTvSetPlaybackRate && window.__duloTvSetPlaybackRate($rate);",
            null
        )
    }

    private fun searchOpenSubtitles(state: JSONObject) {
        val apiKey = PlaybackPrefs.getOpenSubtitlesApiKey(this)
        if (apiKey.isBlank()) {
            Toast.makeText(
                this,
                "Add a free OpenSubtitles API key first (Menu → Set API key)",
                Toast.LENGTH_LONG
            ).show()
            promptOpenSubtitlesApiKey()
            return
        }
        var query = state.optString("title", "").trim()
        if (query.isBlank()) query = "movie"
        val langs = PlaybackPrefs.getSubtitleLanguages(this)
        Toast.makeText(this, "Searching subtitles…", Toast.LENGTH_SHORT).show()
        Thread {
            val client = OpenSubtitlesClient(apiKey)
            val results = client.search(query, langs)
            runOnUiThread {
                // The activity may have been backed out of / destroyed while this
                // background search was in flight - AlertDialog.Builder(this).show()
                // against a dead window throws WindowManager.BadTokenException.
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (results.isEmpty()) {
                    Toast.makeText(this, "No subtitles found for \"$query\"", Toast.LENGTH_LONG).show()
                    return@runOnUiThread
                }
                val labels = results.map { "${it.language.uppercase()} — ${it.release}" }.toTypedArray()
                AlertDialog.Builder(this)
                    .setTitle("OpenSubtitles")
                    .setItems(labels) { _, which ->
                        downloadAndApplySubtitle(client, results[which])
                    }
                    .show()
            }
        }.start()
    }

    private fun downloadAndApplySubtitle(client: OpenSubtitlesClient, result: OpenSubtitlesClient.SubtitleResult) {
        Toast.makeText(this, "Downloading…", Toast.LENGTH_SHORT).show()
        Thread {
            val srt = client.downloadSubtitle(result.downloadPath)
            if (isFinishing || isDestroyed) return@Thread
            if (srt.isNullOrBlank()) {
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        Toast.makeText(this, "Subtitle download failed", Toast.LENGTH_LONG).show()
                    }
                }
                return@Thread
            }
            val vtt = SubtitleFormat.srtToVtt(srt)
            // Pass base64 as-is and let JS decode it as UTF-8 (atob() alone mangles
            // anything outside ASCII, which breaks hi/ta/te/etc. subtitles).
            val b64 = Base64.encodeToString(vtt.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                binding.webview.evaluateJavascript(
                    "window.__duloTvApplySubtitle(${JSONObject.quote(b64)}, " +
                        "${JSONObject.quote(result.language)});",
                    null
                )
                Toast.makeText(this, "Subtitle loaded", Toast.LENGTH_SHORT).show()
            }
        }.start()
    }

    private fun promptOpenSubtitlesApiKey() {
        val input = EditText(this).apply {
            setText(PlaybackPrefs.getOpenSubtitlesApiKey(this@MainActivity))
            hint = "OpenSubtitles API key"
        }
        AlertDialog.Builder(this)
            .setTitle("OpenSubtitles API key")
            .setMessage("Free key: opensubtitles.com → Consumers. Same service family Kodi subtitle addons use.")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                PlaybackPrefs.setOpenSubtitlesApiKey(this, input.text.toString())
                Toast.makeText(this, "API key saved", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun dpadDirection(keyCode: Int): String? = when (keyCode) {
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "enter"
        else -> null
    }

    private fun forwardDpadToPage(direction: String) {
        binding.webview.evaluateJavascript(
            "window.__duloTvHandleKey && window.__duloTvHandleKey('$direction');",
            null
        )
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            when {
                // Leave fullscreen video first rather than navigating underneath it.
                customView != null -> exitFullscreen()
                binding.webview.canGoBack() -> {
                    Log.d(TAG, "back -> webView.goBack()")
                    binding.webview.goBack()
                }
                // Not on the home screen yet: one more Back takes the user there...
                !isOnHome() -> goHome()
                // ...and pressing Back again from home actually exits the app.
                else -> finish()
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.webview.saveState(outState)
    }

    override fun onPause() {
        binding.webview.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        binding.webview.onResume()
    }

    override fun onDestroy() {
        binding.webview.apply {
            clearHistory()
            clearCache(true)
            loadUrl("about:blank")
            onPause()
            removeAllViews()
            destroyDrawingCache()
            destroy()
        }
        super.onDestroy()
    }
}
