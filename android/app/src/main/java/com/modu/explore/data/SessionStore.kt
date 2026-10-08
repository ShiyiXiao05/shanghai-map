package com.modu.explore.data

import android.content.Context
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("explore", Context.MODE_PRIVATE)
    var nickname: String
        get() = prefs.getString("nickname", "").orEmpty()
        set(value) { prefs.edit().putString("nickname", value.trim().take(30)).apply() }
    var code: String?
        get() = prefs.getString("code", null)
        set(value) { prefs.edit().putString("code", value).apply() }
    var mapConsent: Boolean
        get() = prefs.getBoolean("mapConsent", false)
        set(value) { prefs.edit().putBoolean("mapConsent", value).apply() }
    fun maps(): List<ExploreMap> = runCatching { wireJson.decodeFromString<List<ExploreMap>>(prefs.getString("maps", "[]")!!) }.getOrDefault(emptyList())
    fun saveMap(map: ExploreMap, previousCode: String? = null) {
        val next = maps().filter { it.code != map.code && it.code != previousCode } + map
        prefs.edit().putString("maps", wireJson.encodeToString(next)).apply()
    }
    fun forgetMap(code: String) { prefs.edit().putString("maps", wireJson.encodeToString(maps().filter { it.code != code })).apply() }
}
