package com.modu.explore.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.Json
import java.net.URLDecoder
import kotlin.math.*

val wireJson = Json { ignoreUnknownKeys = true; coerceInputValues = true; encodeDefaults = true }

@Serializable
data class ExploreMap(val code: String, val name: String, @SerialName("created_by") val createdBy: String = "")

@Serializable
data class Place(
    val id: Long, val name: String, val category: String, val lng: Double, val lat: Double,
    val address: String = "", val description: String = "", val visited: Boolean = false,
    @SerialName("added_by") val addedBy: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("visited_at") val visitedAt: String? = null,
    @SerialName("deleted_at") val deletedAt: String? = null,
    @SerialName("price_hint") val priceHint: String = "", val hours: String = "", val tags: String = "",
    @SerialName("is_public") val isPublic: Boolean = false,
    @SerialName("photo_count") val photoCount: Int = 0,
    @SerialName("comment_count") val commentCount: Int = 0,
    val wishes: List<String> = emptyList(), val emoji: String = ""
)
@Serializable data class PlacesResponse(val places: List<Place>)
@Serializable data class Photo(val id: Long, val thumb: String = "", val full: String? = null,
    @SerialName("added_by") val addedBy: String = "")
@Serializable data class PhotosResponse(val photos: List<Photo>)
@Serializable data class Comment(val id: Long, val author: String = "", val body: String,
    @SerialName("created_at") val createdAt: String = "")
@Serializable data class CommentsResponse(val comments: List<Comment>)
@Serializable data class StopsResponse(val stops: List<Place>)
@Serializable data class Memory(val id: Long, val name: String, val category: String,
    val address: String = "", @SerialName("visited_at") val visitedAt: String? = null,
    val photos: List<String> = emptyList())
@Serializable data class MemoriesResponse(val memories: List<Memory>)

data class Category(val name: String, val color: Long)
val categories = listOf(Category("景点", 0xff2fa877), Category("美食", 0xffe8862e),
    Category("展馆", 0xff4d82d4), Category("购物", 0xffe0568f),
    Category("娱乐", 0xff8e63d8), Category("其他", 0xff7e8f9c))
fun category(name: String) = categories.find { it.name == name } ?: categories.last()
fun defaultEmoji(name: String) = when (name) {
    "景点" -> "🏞️"; "美食" -> "🍜"; "展馆" -> "🏛️"
    "购物" -> "🛍️"; "娱乐" -> "🎡"; else -> "📍"
}
data class EmojiGroup(val name: String, val emojis: List<String>)
val emojiGroups = listOf(
    EmojiGroup("美食饮品", listOf("🍜", "☕", "🍰", "🍣", "🍕", "🍔", "🥟", "🍲", "🍻", "🍵", "🧋", "🥤", "🍷", "🍸", "🍦", "🍩", "🍪", "🥐", "🥯", "🥖", "🥪", "🌮", "🍝", "🍱", "🍛", "🍢", "🍤", "🥩", "🥗", "🍓", "🍒", "🍉")),
    EmojiGroup("自然风景", listOf("🏞️", "🌳", "🌸", "🏖️", "🌲", "🌴", "🌿", "🌻", "🌷", "🌹", "🪷", "🍁", "🍂", "🍀", "⛰️", "🏔️", "🌋", "🏝️", "🌊", "🌅", "🌇", "🌈", "☀️", "🌙", "🦋", "🐈", "🐕", "🐼")),
    EmojiGroup("城市建筑", listOf("🏛️", "🌆", "🌉", "🏰", "🏙️", "🗼", "🏯", "⛩️", "⛪", "🕌", "🏠", "🏡", "🏨", "🏢", "🏫", "🏟️", "⛲", "🎠", "🎪", "🚉")),
    EmojiGroup("文艺娱乐", listOf("🎡", "🎨", "📚", "🎭", "🎬", "🎵", "🎮", "⚽", "🎢", "🎤", "🎸", "🎹", "🎻", "🎧", "📷", "🎳", "🏀", "🏸", "🎾", "🏊", "🧗", "⛸️", "🛼", "🪁")),
    EmojiGroup("购物出行", listOf("🛍️", "💎", "👗", "👟", "💄", "🧸", "🎁", "💐", "🚲", "🛵", "🚗", "🚕", "🚌", "🚇", "🚄", "✈️", "⛵", "🚢", "⛺", "🧳")),
    EmojiGroup("心情标记", listOf("📍", "❤️", "⭐", "✨", "💛", "💚", "💙", "💜", "🧡", "🤍", "🔥", "💯", "👍", "😊", "🥰", "😎", "🥳", "🤩", "💌", "🏆"))
)
val emojiChoices = emojiGroups.flatMap { it.emojis }
val Place.displayEmoji: String get() = emoji.ifBlank { defaultEmoji(category) }
fun validEmoji(value: String): Boolean {
    if (value.isBlank()) return true
    if (value.length > 32) return false
    val iterator = android.icu.text.BreakIterator.getCharacterInstance(java.util.Locale.ROOT)
    iterator.setText(value)
    iterator.first()
    if (iterator.next() != value.length) return false
    val first = value.codePointAt(0)
    return first in 0x1F000..0x1FAFF || first in 0x2300..0x27FF || first in listOf(0x00A9, 0x00AE, 0x2B50, 0x2B55, 0x3030, 0x303D, 0x3297, 0x3299) ||
        (first in 48..57 || first == 35 || first == 42) && value.contains('\u20E3')
}
enum class PlaceSort(val label: String) { NEWEST("最新添加"), NAME("按名称"), WISHES("最想去") }
fun filterPlaces(places: List<Place>, selected: Set<String>, hideVisited: Boolean, sort: PlaceSort): List<Place> {
    val filtered = places.filter { (selected.isEmpty() || it.category in selected) && (!hideVisited || !it.visited) }
    return when (sort) {
        PlaceSort.NEWEST -> filtered.sortedByDescending { it.id }
        PlaceSort.NAME -> filtered.sortedBy { it.name }
        PlaceSort.WISHES -> filtered.sortedWith(compareByDescending<Place> { it.wishes.size }.thenByDescending { it.id })
    }
}
fun normalizeCode(raw: String): String? = raw.trim().uppercase().takeIf { it.matches(Regex("[A-Z0-9]{6}")) }
fun distanceKm(lngA: Double, latA: Double, lngB: Double, latB: Double): Double {
    val rad = PI / 180
    val a = sin((latB - latA) * rad / 2).pow(2) + cos(latA * rad) * cos(latB * rad) * sin((lngB - lngA) * rad / 2).pow(2)
    return 6371 * 2 * asin(sqrt(a.coerceIn(0.0, 1.0)))
}
fun distanceText(km: Double) = if (km < 1) "${(km * 1000).roundToInt()} m" else "%.1f km".format(km)
fun walkText(km: Double) = "步行约 ${max(1, (km / 4.5 * 60).roundToInt())} 分钟"
data class PickedPoint(val name: String, val address: String, val lng: Double, val lat: Double, val accuracy: Float = 0f)
fun parseSharedPoint(text: String): PickedPoint? {
    val match = Regex("(?:position=|位置[：:]\\s*)(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)").find(text) ?: return null
    val lng = match.groupValues[1].toDoubleOrNull() ?: return null
    val lat = match.groupValues[2].toDoubleOrNull() ?: return null
    if (lng !in -180.0..180.0 || lat !in -90.0..90.0) return null
    val rawName = Regex("[?&]name=([^&\\s]+)").find(text)?.groupValues?.get(1)
    val name = rawName?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrDefault(it) }
        ?: Regex("【([^】]+)】").find(text)?.groupValues?.get(1) ?: ""
    return PickedPoint(name, "", lng, lat)
}
