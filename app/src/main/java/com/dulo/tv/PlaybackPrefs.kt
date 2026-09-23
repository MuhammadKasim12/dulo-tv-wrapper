package com.dulo.tv

import android.content.Context

object PlaybackPrefs {
    private const val PREFS = "dulo_tv_playback"
    private const val KEY_OS_API = "opensubtitles_api_key"
    private const val KEY_SUB_LANGS = "subtitle_languages"

    fun getOpenSubtitlesApiKey(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_OS_API, "") ?: ""

    fun setOpenSubtitlesApiKey(context: Context, key: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_OS_API, key.trim())
            .apply()
    }

    fun getSubtitleLanguages(context: Context): List<String> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_SUB_LANGS, "en,hi,ta,te") ?: "en,hi,ta,te"
        return raw.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }
    }
}
