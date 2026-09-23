package com.dulo.tv

import android.util.Log
import android.webkit.JavascriptInterface

/**
 * JS bridge: navigation logs + playback metadata for subtitles / audio.
 */
class DuloTvJsBridge(
    private val playbackListener: PlaybackListener?,
) {

    interface PlaybackListener {
        fun onPlaybackMeta(json: String)
    }

    @JavascriptInterface
    fun log(message: String) {
        Log.d(TAG, "JS: $message")
    }

    @JavascriptInterface
    fun onPlaybackMeta(json: String) {
        playbackListener?.onPlaybackMeta(json)
    }

    companion object {
        private const val TAG = "DuloTvNav"
    }
}
