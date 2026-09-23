package com.dulo.tv

object SubtitleFormat {

    /** Convert SRT subtitle text to WebVTT for HTML5 &lt;track&gt; elements. */
    fun srtToVtt(srt: String): String {
        val body = srt
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .trim()
        val blocks = body.split(Regex("\n\\s*\n"))
        val lines = StringBuilder("WEBVTT\n\n")
        for (block in blocks) {
            val parts = block.lines().filter { it.isNotBlank() }
            if (parts.size < 2) continue
            var timeIdx = 0
            if (parts[0].trim().all { it.isDigit() }) timeIdx = 1
            if (timeIdx >= parts.size) continue
            val timing = parts[timeIdx].replace(',', '.')
            if (!timing.contains("-->")) continue
            lines.append(timing).append('\n')
            for (i in timeIdx + 1 until parts.size) {
                lines.append(parts[i]).append('\n')
            }
            lines.append('\n')
        }
        return lines.toString()
    }
}
