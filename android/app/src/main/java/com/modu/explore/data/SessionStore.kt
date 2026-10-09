package com.modu.explore.data

import android.content.Context
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("explore", Context.MODE_PRIVATE)
    var themeMode: ThemeMode
        get() = ThemeMode.entries.find { it.name == prefs.getString("themeMode", null) } ?: ThemeMode.SYSTEM
        set(value) { prefs.edit().putString("themeMode", value.name).apply() }
    var nickname: String
        get() = prefs.getString("nickname", "").orEmpty()
        set(value) { prefs.edit().putString("nickname", value.trim().take(30)).apply() }
    var code: String?
        get() = prefs.getString("code", null)
        set(value) { prefs.edit().putString("code", value).apply() }
    var mapConsent: Boolean
        get() = prefs.getBoolean("mapConsent", false)
        set(value) { prefs.edit().putBoolean("mapConsent", value).apply() }
    var previewUpdates: Boolean
        get() = prefs.getBoolean("previewUpdates", com.modu.explore.BuildConfig.RELEASE_CHANNEL == "preview")
        set(value) { prefs.edit().putBoolean("previewUpdates", value).apply() }
    fun updates(): UpdateCatalog? = runCatching {
        prefs.getString("updateCatalog", null)?.let { wireJson.decodeFromString<UpdateCatalog>(it) }
    }.getOrNull()
    fun saveUpdates(catalog: UpdateCatalog) { prefs.edit().putString("updateCatalog", wireJson.encodeToString(catalog)).apply() }
    fun places(code: String?): List<Place> = runCatching {
        wireJson.decodeFromString<List<Place>>(prefs.getString("places:${code ?: "public"}", "[]")!!)
    }.getOrDefault(emptyList())
    fun savePlaces(code: String?, places: List<Place>) {
        prefs.edit().putString("places:${code ?: "public"}", wireJson.encodeToString(places.filter { it.id > 0 })).apply()
    }
    fun maps(): List<ExploreMap> = runCatching { wireJson.decodeFromString<List<ExploreMap>>(prefs.getString("maps", "[]")!!) }.getOrDefault(emptyList())
    fun saveMap(map: ExploreMap, previousCode: String? = null) {
        val next = maps().filter { it.code != map.code && it.code != previousCode } + map
        prefs.edit().apply { if (previousCode != null) remove("places:$previousCode") }
            .putString("maps", wireJson.encodeToString(next)).apply()
    }
    fun forgetMap(code: String) { prefs.edit().remove("places:$code").putString("maps", wireJson.encodeToString(maps().filter { it.code != code })).apply() }
}
