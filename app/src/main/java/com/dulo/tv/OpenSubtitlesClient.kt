package com.dulo.tv

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Minimal OpenSubtitles.com REST client (same ecosystem Kodi subtitle addons use).
 * Requires a free API key: https://www.opensubtitles.com/en/consumers
 */
class OpenSubtitlesClient(
    private val apiKey: String,
    private val userAgent: String = "DuloTV/1.2 AndroidTV",
) {

    data class SubtitleResult(
        val id: String,
        val language: String,
        val release: String,
        val downloadPath: String,
    )

    fun search(query: String, languages: List<String>): List<SubtitleResult> {
        if (apiKey.isBlank()) return emptyList()
        val lang = languages.joinToString(",")
        val q = URLEncoder.encode(query.trim(), Charsets.UTF_8.name())
        val url =
            "https://api.opensubtitles.com/api/v1/subtitles?query=$q&languages=$lang"
        val json = getJson(url) ?: return emptyList()
        val data = json.optJSONArray("data") ?: return emptyList()
        val out = mutableListOf<SubtitleResult>()
        for (i in 0 until data.length()) {
            val item = data.optJSONObject(i) ?: continue
            val attrs = item.optJSONObject("attributes") ?: continue
            val files = attrs.optJSONArray("files") ?: continue
            if (files.length() == 0) continue
            val file = files.optJSONObject(0) ?: continue
            val fileId = file.optInt("file_id", -1)
            if (fileId < 0) continue
            out.add(
                SubtitleResult(
                    id = item.optString("id", fileId.toString()),
                    language = attrs.optString("language", lang),
                    release = attrs.optString("release", attrs.optString("feature_details", "")),
                    downloadPath = fileId.toString(),
                )
            )
        }
        return out
    }

    fun downloadSubtitle(fileId: String): String? {
        if (apiKey.isBlank()) return null
        val url = URL("https://api.opensubtitles.com/api/v1/download")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20000
            readTimeout = 20000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Api-Key", apiKey)
            setRequestProperty("User-Agent", userAgent)
        }
        conn.outputStream.use { os ->
            os.write("""{"file_id":${fileId.toIntOrNull() ?: return null}}""".toByteArray())
        }
        val code = conn.responseCode
        if (code !in 200..299) {
            Log.e(TAG, "download failed HTTP $code")
            return null
        }
        val body = conn.inputStream.bufferedReader().use { it.readText() }
        val link = JSONObject(body).optString("link")
        if (link.isBlank()) return null
        return downloadText(link)
    }

    private fun getJson(urlString: String): JSONObject? {
        val body = getText(urlString) ?: return null
        return try {
            JSONObject(body)
        } catch (e: Exception) {
            Log.e(TAG, "json parse", e)
            null
        }
    }

    private fun getText(urlString: String): String? {
        val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20000
            readTimeout = 20000
            setRequestProperty("Api-Key", apiKey)
            setRequestProperty("User-Agent", userAgent)
        }
        return try {
            if (conn.responseCode !in 200..299) {
                Log.e(TAG, "GET $urlString -> ${conn.responseCode}")
                null
            } else {
                conn.inputStream.bufferedReader().use { it.readText() }
            }
        } catch (e: Exception) {
            Log.e(TAG, "GET failed", e)
            null
        } finally {
            conn.disconnect()
        }
    }

    private fun downloadText(urlString: String): String? {
        val conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
            connectTimeout = 20000
            readTimeout = 20000
            setRequestProperty("User-Agent", userAgent)
        }
        return try {
            if (conn.responseCode !in 200..299) null
            else conn.inputStream.bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            Log.e(TAG, "subtitle file download", e)
            null
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val TAG = "DuloTvSubs"
    }
}
