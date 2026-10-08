package com.modu.explore.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String) : IOException(message)

class MapApi(val baseUrl: String, private val client: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS).readTimeout(65, TimeUnit.SECONDS)
    .callTimeout(90, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()) {
    private fun endpoint(path: String) = baseUrl.trimEnd('/') + path
    suspend fun raw(method: String, path: String, body: JsonObject? = null, code: String? = null): String = withContext(Dispatchers.IO) {
        val content = body?.toString()?.toRequestBody("application/json; charset=utf-8".toMediaType())
            ?: if (method in listOf("POST", "PUT")) "{}".toRequestBody("application/json".toMediaType()) else null
        val builder = Request.Builder().url(endpoint(path)).method(method, content)
        if (code != null) builder.header("x-map-code", code)
        val request = builder.build()
        fun execute(): String = client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val message = runCatching { wireJson.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
                throw ApiException(response.code, message ?: "请求失败（${response.code}），请稍后重试")
            }
            text
        }
        try {
            execute()
        } catch (error: IOException) {
            if (method != "GET" || error is ApiException) throw error
            currentCoroutineContext().ensureActive()
            execute()
        }
    }
    suspend fun createMap(name: String, nickname: String): ExploreMap = wireJson.decodeFromString(raw("POST", "/api/maps", buildJsonObject { put("name", name); put("createdBy", nickname) }))
    suspend fun getMap(code: String): ExploreMap = wireJson.decodeFromString(raw("GET", "/api/maps/$code"))
    suspend fun places(code: String?, trash: Boolean = false): List<Place> = wireJson.decodeFromString<PlacesResponse>(raw("GET", if (code == null) "/api/public/places" else "/api/places?map=$code${if (trash) "&view=trash" else ""}")).places
    suspend fun savePlace(code: String, id: Long?, fields: JsonObject) {
        val body = JsonObject(fields + if (id == null) mapOf("map_code" to JsonPrimitive(code)) else emptyMap())
        raw(if (id == null) "POST" else "PUT", if (id == null) "/api/places" else "/api/places/$id", body, code)
    }
    suspend fun deletePlace(code: String, id: Long) { raw("DELETE", "/api/places/$id", code = code) }
    suspend fun restore(code: String, id: Long) { raw("POST", "/api/places/$id/restore", buildJsonObject { put("map_code", code) }) }
    suspend fun wish(code: String, id: Long, who: String) { raw("POST", "/api/places/$id/wish", buildJsonObject { put("map_code", code); put("who", who) }) }
    suspend fun publish(code: String, id: Long) { raw("POST", "/api/places/$id/public", buildJsonObject { put("map_code", code) }) }
    suspend fun photos(code: String, id: Long) = wireJson.decodeFromString<PhotosResponse>(raw("GET", "/api/places/$id/photos?map=$code")).photos
    fun photoUrl(code: String, id: Long) = endpoint("/api/photos/$id?map=$code")
    suspend fun upload(code: String, id: Long, full: String, thumb: String, nickname: String) {
        raw("POST", "/api/places/$id/photos", buildJsonObject { put("map_code", code); put("full", full); put("thumb", thumb); put("added_by", nickname) })
    }
    suspend fun deletePhoto(code: String, id: Long) { raw("DELETE", "/api/photos/$id", code = code) }
    suspend fun comments(code: String, id: Long) = wireJson.decodeFromString<CommentsResponse>(raw("GET", "/api/places/$id/comments?map=$code")).comments
    suspend fun comment(code: String, id: Long, body: String, nickname: String) { raw("POST", "/api/places/$id/comments", buildJsonObject { put("map_code", code); put("body", body); put("author", nickname) }) }
    suspend fun deleteComment(code: String, id: Long) { raw("DELETE", "/api/comments/$id", code = code) }
    suspend fun itinerary(code: String) = wireJson.decodeFromString<StopsResponse>(raw("GET", "/api/itinerary?map=$code")).stops
    suspend fun saveItinerary(code: String, ids: List<Long>) { raw("PUT", "/api/itinerary", buildJsonObject { put("map_code", code); put("place_ids", JsonArray(ids.map { JsonPrimitive(it) })) }) }
    suspend fun memories(code: String) = wireJson.decodeFromString<MemoriesResponse>(raw("GET", "/api/maps/$code/memories")).memories
    suspend fun rename(code: String, name: String): ExploreMap = wireJson.decodeFromString(raw("PUT", "/api/maps/$code", buildJsonObject { put("name", name) }))
    suspend fun rekey(code: String): ExploreMap = wireJson.decodeFromString(raw("POST", "/api/maps/$code/rekey"))
    suspend fun deleteMap(code: String) { raw("DELETE", "/api/maps/$code") }
    suspend fun export(code: String) = raw("GET", "/api/maps/$code/export")
    suspend fun report(code: String?, id: Long, reason: String, nickname: String) {
        raw("POST", "/api/reports", buildJsonObject { put("target_type", "place"); put("target_id", id); put("reason", reason); put("reporter", nickname); if (code != null) put("map_code", code) })
    }
}
