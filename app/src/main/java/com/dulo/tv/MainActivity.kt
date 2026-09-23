package com.dulo.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
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
        private const val TARGET_URL = "https://dulo.cx"

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

        if (savedInstanceState != null) {
            binding.webview.restoreState(savedInstanceState)
        } else {
            binding.webview.loadUrl(TARGET_URL)
        }
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
                view?.let { injectScripts(it) }
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
                binding.fullscreenContainer.visibility = View.GONE
                binding.fullscreenContainer.removeAllViews()
                binding.webview.visibility = View.VISIBLE
                customViewCallback?.onCustomViewHidden()
                customView = null
                customViewCallback = null
            }
        }
    }

    private fun injectScripts(webView: WebView) {
        injectAsset(webView, "tv_navigation.js")
        injectAsset(webView, "tv_playback.js")
        webView.evaluateJavascript(
            "if (window.__duloTvNavRefresh) window.__duloTvNavRefresh();",
            null
        )
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
                    showPlaybackMenu()
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

    private fun showPlaybackMenu() {
        binding.webview.evaluateJavascript("window.__duloTvGetPlaybackState();") { raw ->
            runOnUiThread {
                val json = raw?.trim()?.removeSurrounding("\"")?.replace("\\\"", "\"")
                val state = try {
                    JSONObject(json ?: lastPlaybackMeta.toString())
                } catch (e: Exception) {
                    lastPlaybackMeta
                }
                openPlaybackDialog(state)
            }
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
            val b64 = Base64.encodeToString(vtt.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            runOnUiThread {
                binding.webview.evaluateJavascript(
                    "window.__duloTvApplySubtitle(atob('${b64.replace("'", "\\'")}'), " +
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
        if (keyCode == KeyEvent.KEYCODE_BACK && binding.webview.canGoBack()) {
            Log.d(TAG, "back -> webView.goBack()")
            binding.webview.goBack()
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
