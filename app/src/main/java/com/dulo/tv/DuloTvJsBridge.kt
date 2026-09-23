package com.dulo.tv

import android.util.Log
import android.webkit.JavascriptInterface

/**
 * Receives debug lines from injected [tv_navigation.js] on the page.
 */
class DuloTvJsBridge {

    @JavascriptInterface
    fun log(message: String) {
        Log.d(TAG, "JS: $message")
    }

    companion object {
        private const val TAG = "DuloTvNav"
    }
}
