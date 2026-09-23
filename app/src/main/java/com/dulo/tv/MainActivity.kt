package com.dulo.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.dulo.tv.databinding.ActivityMainBinding

/**
 * Single-activity Android TV WebView wrapper for https://dulo.cx.
 *
 * Injects [tv_navigation.js] for Netflix-style row navigation (wrap within rows,
 * move between rows/apps/nav on up/down) and logs to Logcat tag [DuloTvNav].
 */
class MainActivity : Activity() {

    private lateinit var binding: ActivityMainBinding

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

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

        webView.addJavascriptInterface(DuloTvJsBridge(), "DuloTvBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                Log.d(TAG, "navigate url=$url")
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "page finished url=$url")
                view?.let { injectTvNavigation(it) }
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

    private fun injectTvNavigation(webView: WebView) {
        try {
            val script = assets.open("tv_navigation.js").bufferedReader().use { it.readText() }
            webView.evaluateJavascript(script) { result ->
                Log.d(TAG, "injected tv_navigation.js result=$result")
            }
            webView.evaluateJavascript(
                "if (window.__duloTvNavRefresh) window.__duloTvNavRefresh();",
                null
            )
        } catch (e: Exception) {
            Log.e(TAG, "failed to inject tv_navigation.js", e)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
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
