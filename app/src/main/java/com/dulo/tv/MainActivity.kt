package com.dulo.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
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
 * - Fullscreen, no title bar (see Theme.DuloTV).
 * - JavaScript / DOM storage / database storage enabled.
 * - Autoplay media without requiring a user gesture.
 * - TV-friendly User-Agent string.
 * - Remote D-pad "Back" navigates WebView history before exiting the app.
 * - HTML5 fullscreen <video> is supported via WebChromeClient custom view
 *   handling (common for TV-oriented sites with video content).
 */
class MainActivity : Activity() {

    private lateinit var binding: ActivityMainBinding

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    companion object {
        private const val TARGET_URL = "https://dulo.cx"

        // TV-friendly User-Agent: identifies as an Android TV device so sites
        // that serve TV-optimized layouts / player controls respond correctly.
        private const val TV_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 12; Android TV; Dulo TV) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 TV Safari/537.36"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

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

        // Core content settings.
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        @Suppress("DEPRECATION")
        settings.databaseEnabled = true

        // Allow media (audio/video) to autoplay without a prior user gesture -
        // important for TV remotes, which have no "click to play" concept.
        settings.mediaPlaybackRequiresUserGesture = false

        // Identify as an Android TV browser.
        settings.userAgentString = TV_USER_AGENT

        // Sensible defaults for a TV-oriented, remote-navigated WebView.
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

        // Ensure the WebView can receive D-pad focus/key events (no touchscreen
        // is required on Android TV).
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocus()

        // Keep all navigation inside the WebView instead of handing off to an
        // external browser/app.
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false
            }
        }

        // Support HTML5 fullscreen <video> playback (common on TV/video sites).
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

    /**
     * Android TV remote "Back" button: navigate WebView history first, and
     * only let the system close/exit the app once there is no more history.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && binding.webview.canGoBack()) {
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
