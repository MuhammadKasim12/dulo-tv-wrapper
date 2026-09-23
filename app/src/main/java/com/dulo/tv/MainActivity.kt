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
 * WebView wrapper for https://dulo.cx with TV navigation, playback helpers,
 * OpenSubtitles-style external subtitles, and in-page language/track selection.
 */
class MainActivity : Activity(), DuloTvJsBridge.PlaybackListener {

    private lateinit var binding: ActivityMainBinding

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private var lastPlaybackMeta = JSONObject()

    companion object {
        private const val TAG = "DuloTvNav"
        /** dulo.cx redirects to fmhy video wiki; hash opens Stream Aggregators by default. */
        private const val HOME_URL = "https://dulo.cx"
        private const val STREAM_AGGREGATORS_URL = "https://fmhy.net/video#stream-aggregators"

        /**
         * Only these hosts get tv_navigation.js/tv_playback.js/tv_home.js injected.
         * Those scripts auto-click "See all"/"more" and anything that looks like a
         * play button, which is exactly what a third-party streaming site's ad
         * interstitials look like - so injection (and its side effects) must not
         * follow the user off of dulo.cx/fmhy.net onto whatever a link points to.
         */
        private val INJECT_HOST_ALLOWLIST = setOf("dulo.cx", "fmhy.net")

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

        // Always land on Stream Aggregators (ignore saved WebView URL from software/other sections).
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

        webView.addJavascriptInterface(DuloTvJsBridge(this), "DuloTvBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                Log.d(TAG, "navigate url=$url")
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "page finished url=$url")
                val host = url?.let { Uri.parse(it).host }
                if (view != null && isInjectAllowedHost(host)) {
                    injectScripts(view)
                } else {
                    Log.d(TAG, "skip script injection for host=$host")
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

    /** True once the WebView has actually navigated to the Stream Aggregators section. */
    private fun isOnStreamAggregatorsHome(): Boolean =
        binding.webview.url?.contains("stream-aggregators", ignoreCase = true) == true

    private fun isInjectAllowedHost(host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        val h = host.lowercase()
        return INJECT_HOST_ALLOWLIST.any { h == it || h.endsWith(".$it") }
    }

    private fun injectScripts(webView: WebView) {
        injectAsset(webView, "tv_navigation.js")
        injectAsset(webView, "tv_playback.js")
        injectAsset(webView, "tv_home.js")
        webView.evaluateJavascript(
            "if (window.__duloTvNavRefresh) window.__duloTvNavRefresh();",
            null
        )
        webView.evaluateJavascript(
            "setTimeout(function(){ if (window.__duloTvEnsureDefaultSection) window.__duloTvEnsureDefaultSection(); }, 1200);",
            null
        )
    }

    private fun goStreamAggregatorsHome() {
        binding.webview.loadUrl(STREAM_AGGREGATORS_URL)
        binding.webview.evaluateJavascript(
            "window.__duloTvGoStreamAggregators && window.__duloTvGoStreamAggregators(true);",
            null
        )
        Toast.makeText(this, "Stream aggregators", Toast.LENGTH_SHORT).show()
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
            }
        }
        if (customView != null) {
            return super.dispatchKeyEvent(event)
        }
        if (event.action == KeyEvent.ACTION_DOWN && event.keyCode in DPAD_KEYS) {
            Log.d(
                TAG,
                "key down code=${event.keyCode} (${KeyEvent.keyCodeToString(event.keyCode)}) " +
                    "repeat=${event.repeatCount}"
            )
            dpadDirection(event.keyCode)?.let { direction ->
                forwardDpadToPage(direction)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun showMainMenu() {
        AlertDialog.Builder(this)
            .setTitle("Dulo TV")
            .setItems(
                arrayOf(
                    "Stream aggregators (home)",
                    "Playback: subtitles & audio…",
                )
            ) { dialog, which ->
                when (which) {
                    0 -> goStreamAggregatorsHome()
                    1 -> showPlaybackMenu()
                }
                dialog.dismiss()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun showPlaybackMenu() {
        binding.webview.evaluateJavascript("(window.__duloTvGetPlaybackState());") { raw ->
            runOnUiThread {
                openPlaybackDialog(parseJsJson(raw))
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

    private fun openPlaybackDialog(state: JSONObject) {
        val items = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()

        items.add("Off — built-in subtitles")
        actions.add { selectTextTrack(-1) }

        val textTracks = state.optJSONArray("textTracks") ?: JSONArray()
        for (i in 0 until textTracks.length()) {
            val tr = textTracks.optJSONObject(i) ?: continue
            val label = tr.optString("label", "Track ${i + 1}")
            items.add("Subtitle: $label")
            val idx = tr.optInt("index", i)
            actions.add { selectTextTrack(idx) }
        }

        val audioTracks = state.optJSONArray("audioTracks") ?: JSONArray()
        for (i in 0 until audioTracks.length()) {
            val tr = audioTracks.optJSONObject(i) ?: continue
            val label = tr.optString("label", "Audio ${i + 1}")
            items.add("Audio: $label")
            val idx = tr.optInt("index", i)
            actions.add { selectAudioTrack(idx) }
        }

        val pageButtons = state.optJSONArray("pageButtons") ?: JSONArray()
        for (i in 0 until pageButtons.length()) {
            val btn = pageButtons.optJSONObject(i) ?: continue
            items.add("Language/UI: ${btn.optString("label")}")
            val idx = btn.optInt("index", i)
            actions.add { clickLanguageOption(idx) }
        }

        items.add("Search OpenSubtitles (en, hi, ta, te…)")
        actions.add { searchOpenSubtitles(state) }

        items.add("Set OpenSubtitles API key…")
        actions.add { promptOpenSubtitlesApiKey() }

        AlertDialog.Builder(this)
            .setTitle(state.optString("title", "Playback"))
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

    private fun clickLanguageOption(index: Int) {
        binding.webview.evaluateJavascript(
            "window.__duloTvClickLanguageOption($index);",
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
            if (srt.isNullOrBlank()) {
                runOnUiThread {
                    Toast.makeText(this, "Subtitle download failed", Toast.LENGTH_LONG).show()
                }
                return@Thread
            }
            val vtt = SubtitleFormat.srtToVtt(srt)
            // Pass base64 as-is and let JS decode it as UTF-8 (atob() alone mangles
            // anything outside ASCII, which breaks hi/ta/te/etc. subtitles).
            val b64 = Base64.encodeToString(vtt.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            runOnUiThread {
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
                // Not on the home section yet: one more Back takes the user there...
                !isOnStreamAggregatorsHome() -> goStreamAggregatorsHome()
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
