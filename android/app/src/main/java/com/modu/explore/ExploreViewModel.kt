package com.modu.explore

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.modu.explore.data.*
import com.modu.explore.ui.compressPhoto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.*
import java.io.IOException

enum class Page { HOME, MAPS, DETAIL, EDIT, SEARCH, ITINERARY, MEMORIES, TRASH, POSTER, CHANGELOG }
data class ExploreState(
    val page: Page = Page.HOME, val map: ExploreMap? = null,
    val maps: List<ExploreMap> = emptyList(), val nickname: String = "",
    val places: List<Place> = emptyList(), val selected: Place? = null, val previewId: Long? = null,
    val photos: List<Photo> = emptyList(), val comments: List<Comment> = emptyList(),
    val stops: List<Place> = emptyList(), val memories: List<Memory> = emptyList(), val trash: List<Place> = emptyList(),
    val loading: Boolean = false, val detailLoading: Boolean = false, val busy: Boolean = false,
    val photosLoading: Boolean = false, val commentsLoading: Boolean = false,
    val photosError: String? = null, val commentsError: String? = null,
    val pendingPlaces: Set<Long> = emptySet(),
    val error: String? = null, val detailError: String? = null,
    val pageLoading: Boolean = false, val pageError: String? = null, val message: String? = null,
    val selectedCategories: Set<String> = emptySet(), val hideVisited: Boolean = false,
    val sort: PlaceSort = PlaceSort.NEWEST, val mapConsent: Boolean = false,
    val draft: PickedPoint? = null, val draftFields: JsonObject? = null
)

class ExploreViewModel @JvmOverloads constructor(application: Application, val api: MapApi = MapApi(BuildConfig.API_BASE_URL)) : AndroidViewModel(application) {
    private val sessions = SessionStore(application)
    private val initialMap = sessions.maps().find { it.code == sessions.code }
    private val mutable = MutableStateFlow(ExploreState(
        map = initialMap, maps = sessions.maps(),
        nickname = sessions.nickname, mapConsent = sessions.mapConsent,
        places = sessions.places(initialMap?.code)
    ))
    val state = mutable.asStateFlow()
    private var revision = 0
    private var detailRevision = 0
    private var detailJob: Job? = null
    private var reloadJob: Job? = null
    private var prefetchJob: Job? = null
    private var prefetchKey: Pair<String, Long>? = null
    private data class MediaCache(val photos: List<Photo>? = null, val comments: List<Comment>? = null, val savedAt: Long = 0) {
        fun fresh() = photos != null && comments != null && android.os.SystemClock.elapsedRealtime() - savedAt < 60_000
    }
    private val mediaCache = object : LinkedHashMap<Pair<String, Long>, MediaCache>(20, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Pair<String, Long>, MediaCache>?) = size > 20
    }
    init { reload() }
    private fun message(error: Throwable) = when (error) {
        is ApiException -> error.message ?: "请求失败"
        is IOException -> "连接失败，请检查网络后重试"
        else -> error.message ?: "操作失败，请稍后重试"
    }
    fun notice(text: String) { mutable.update { it.copy(message = text) } }
    fun dismissMessage() { mutable.update { it.copy(message = null) } }
    fun nickname(value: String) { sessions.nickname = value; mutable.update { it.copy(nickname = sessions.nickname) } }
    fun consent() { sessions.mapConsent = true; mutable.update { it.copy(mapConsent = true) } }
    fun revokeConsent() { sessions.mapConsent = false; mutable.update { it.copy(mapConsent = false) } }
    fun filter(name: String) { mutable.update { it.copy(selectedCategories = if (name in it.selectedCategories) it.selectedCategories - name else it.selectedCategories + name) } }
    fun hideVisited(value: Boolean) { mutable.update { it.copy(hideVisited = value) } }
    fun sort(value: PlaceSort) { mutable.update { it.copy(sort = value) } }
    fun navigate(page: Page) {
        if (mutable.value.busy) return
        mutable.update { it.copy(page = page, pageError = null) }
        when (page) {
            Page.ITINERARY, Page.MEMORIES, Page.TRASH -> loadPage()
            else -> Unit
        }
    }
    fun back() {
        if (mutable.value.busy) return
        detailRevision++
        detailJob?.cancel()
        mutable.update { it.copy(page = if (it.page == Page.EDIT && it.selected != null) Page.DETAIL else Page.HOME, pageError = null,
            detailLoading = false, photosLoading = false, commentsLoading = false) }
        if (mutable.value.page == Page.DETAIL) loadDetail()
    }
    fun switchMap(map: ExploreMap?) {
        if (mutable.value.busy) return
        revision++; detailRevision++
        detailJob?.cancel(); prefetchJob?.cancel()
        sessions.code = map?.code
        mutable.update { it.copy(map = map, page = Page.HOME, places = sessions.places(map?.code), selected = null, previewId = null,
            photos = emptyList(), comments = emptyList(), stops = emptyList(), memories = emptyList(), trash = emptyList(),
            selectedCategories = emptySet(), loading = true, error = null) }
        reload()
    }
    fun reload() {
        val stamp = ++revision
        reloadJob?.cancel()
        val code = mutable.value.map?.code
        mutable.update { it.copy(loading = true, error = null) }
        reloadJob = viewModelScope.launch {
            try {
                supervisorScope {
                    if (code != null) launch {
                        try {
                            val map = api.getMap(code)
                            if (stamp == revision) {
                                sessions.saveMap(map)
                                mutable.update { it.copy(map = map, maps = sessions.maps()) }
                            }
                        } catch (error: Exception) { if (error is CancellationException) throw error }
                    }
                val places = api.places(code)
                if (stamp != revision) return@supervisorScope
                mutable.update { current ->
                    val visible = places.map { p ->
                        if (p.id in current.pendingPlaces) current.places.find { it.id == p.id }?.let { p.copy(wishes = it.wishes) } ?: p else p
                    }
                    current.copy(places = visible, loading = false,
                        selected = current.selected?.let { selected -> visible.find { p -> p.id == selected.id } })
                }
                sessions.savePlaces(code, places)
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (stamp == revision) mutable.update { it.copy(loading = false, error = message(error)) }
            }
        }
    }
    private fun write(success: String, onFailure: () -> Unit = {}, action: suspend () -> Unit) {
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true) }
        viewModelScope.launch {
            try { action(); notice(success) }
            catch (error: Exception) { if (error is CancellationException) throw error; onFailure(); notice(message(error)) }
            finally {
                mutable.update { it.copy(busy = false) }
                sessions.savePlaces(mutable.value.map?.code, mutable.value.places)
            }
        }
    }
    private suspend fun refreshPlaces(code: String) {
        val places = api.places(code)
        mutable.update { it.copy(places = places, selected = it.selected?.let { p -> places.find { it.id == p.id } }) }
    }
    fun createMap(name: String) {
        if (name.isBlank() || name.length > 40) { notice("地图名称需为 1–40 字"); return }
        if (mutable.value.nickname.isBlank()) { notice("请先设置昵称"); return }
        write("地图已创建") {
            val map = api.createMap(name.trim(), mutable.value.nickname)
            sessions.saveMap(map); sessions.code = map.code; revision++
            mutable.update { it.copy(map = map, maps = sessions.maps(), places = emptyList(), selected = null, page = Page.HOME,
                loading = false, error = null, selectedCategories = emptySet(), previewId = null) }
        }
    }
    fun joinMap(raw: String) {
        val code = normalizeCode(raw) ?: run { notice("请输入 6 位字母或数字邀请码"); return }
        write("已加入地图") {
            val (map, places) = coroutineScope {
                val map = async { api.getMap(code) }; val places = async { api.places(code) }
                map.await() to places.await()
            }
            sessions.saveMap(map); sessions.code = code; revision++
            mutable.update { it.copy(map = map, maps = sessions.maps(), places = places, selected = null, page = Page.HOME,
                loading = false, error = null, selectedCategories = emptySet(), previewId = null) }
        }
    }
    fun previewPlace(place: Place) {
        if (place.id in mutable.value.pendingPlaces) return
        if (!mutable.value.busy) {
            mutable.update { it.copy(page = Page.HOME, previewId = place.id) }
            val code = mutable.value.map?.code ?: return
            prefetchJob?.cancel()
            prefetchKey = code to place.id
            prefetchJob = viewModelScope.launch {
                delay(250)
                fetchMedia(code, place.id, display = false)
            }
        }
    }
    fun closePreview() { mutable.update { it.copy(previewId = null) } }
    fun openPlace(place: Place) {
        if (place.id in mutable.value.pendingPlaces) return
        val key = mutable.value.map?.code?.let { it to place.id }
        if (prefetchKey != key) prefetchJob?.cancel()
        val cached = key?.let { mediaCache[it] }
        mutable.update { it.copy(selected = place, page = Page.DETAIL, photos = cached?.photos.orEmpty(), comments = cached?.comments.orEmpty(),
            detailError = null, photosError = null, commentsError = null, detailLoading = false, photosLoading = false, commentsLoading = false) }
        loadDetail()
    }
    fun loadDetail() {
        val code = mutable.value.map?.code ?: return
        val place = mutable.value.selected ?: return
        detailJob?.cancel()
        val cached = mediaCache[code to place.id]
        val fresh = cached?.fresh() == true
        val prefetch = prefetchJob?.takeIf { it.isActive && prefetchKey == (code to place.id) }
        mutable.update { it.copy(detailLoading = !fresh,
            photosLoading = !fresh && (prefetch == null || cached?.photos == null),
            commentsLoading = !fresh && (prefetch == null || cached?.comments == null)) }
        if (prefetch != null) { detailJob = viewModelScope.launch { prefetch.join() }; return }
        detailJob = viewModelScope.launch { fetchMedia(code, place.id, display = true) }
    }
    private suspend fun fetchMedia(code: String, id: Long, display: Boolean) = supervisorScope {
        val key = code to id
        val cached = mediaCache[key]
        if (cached?.fresh() == true) return@supervisorScope
        val stamp = if (display) ++detailRevision else detailRevision
        fun active() = stamp == detailRevision && mutable.value.page == Page.DETAIL &&
            code == mutable.value.map?.code && id == mutable.value.selected?.id
        mediaCache[key] = MediaCache()
        if (active()) mutable.update { it.copy(detailLoading = true, photosLoading = true, commentsLoading = true, photosError = null, commentsError = null) }
        var photos: List<Photo>? = null
        var comments: List<Comment>? = null
        val photosJob = launch {
            try {
                photos = api.photos(code, id)
                mediaCache[key] = (mediaCache[key] ?: MediaCache()).copy(photos = photos)
                if (active()) mutable.update { it.copy(photos = photos!!, photosLoading = false, detailLoading = it.commentsLoading) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (active()) mutable.update { it.copy(photosLoading = false, detailLoading = it.commentsLoading, photosError = message(error)) }
            }
        }
        val commentsJob = launch {
            try {
                comments = api.comments(code, id)
                mediaCache[key] = (mediaCache[key] ?: MediaCache()).copy(comments = comments)
                if (active()) mutable.update { it.copy(comments = comments!!, commentsLoading = false, detailLoading = it.photosLoading) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (active()) mutable.update { it.copy(commentsLoading = false, detailLoading = it.photosLoading, commentsError = message(error)) }
            }
        }
        photosJob.join(); commentsJob.join()
        if (photos != null && comments != null) mediaCache[key] = MediaCache(
            if (active()) mutable.value.photos else photos!!, if (active()) mutable.value.comments else comments!!,
            android.os.SystemClock.elapsedRealtime())
    }
    fun startAdd(point: PickedPoint) { mutable.update { it.copy(selected = null, draft = point, draftFields = null, page = Page.EDIT, error = null) } }
    fun startEdit() {
        val p = mutable.value.selected ?: return
        if (mutable.value.busy || p.id in mutable.value.pendingPlaces) return
        mutable.update { it.copy(draft = PickedPoint(p.name, p.address, p.lng, p.lat), draftFields = null, page = Page.EDIT) }
    }
    fun savePlace(fields: JsonObject) {
        if (mutable.value.busy) return
        val code = mutable.value.map?.code ?: return
        if (mutable.value.nickname.isBlank()) { notice("请先在我的地图中设置昵称"); return }
        if (!validEmoji(fields["emoji"]?.jsonPrimitive?.content.orEmpty())) { notice("请选择一个 emoji"); return }
        val id = mutable.value.selected?.id
        if (id != null && id in mutable.value.pendingPlaces) return
        val previousState = mutable.value
        val temporaryId = id ?: -System.currentTimeMillis()
        val previous = previousState.selected?.let { wireJson.encodeToJsonElement(it).jsonObject } ?: buildJsonObject {
            put("id", temporaryId); put("added_by", previousState.nickname)
        }
        val optimistic = wireJson.decodeFromJsonElement<Place>(JsonObject(previous + fields))
        revision++; reloadJob?.cancel()
        mutable.update { it.copy(places = if (id == null) listOf(optimistic) + it.places else it.places.map { p -> if (p.id == id) optimistic else p },
            selected = if (id == null) null else optimistic, page = Page.HOME, previewId = temporaryId, loading = false,
            pendingPlaces = it.pendingPlaces + temporaryId) }
        write("地点已保存", onFailure = {
            mutable.update { it.copy(places = if (id == null) it.places.filter { p -> p.id != temporaryId }
                else it.places.map { p -> if (p.id == id) previousState.places.find { old -> old.id == id } ?: p else p },
                selected = previousState.selected, page = Page.EDIT, previewId = null,
                pendingPlaces = it.pendingPlaces - temporaryId, draftFields = wireJson.encodeToJsonElement(optimistic).jsonObject) }
        }) {
            val result = api.savePlace(code, id, JsonObject(fields + if (id == null) mapOf("added_by" to JsonPrimitive(mutable.value.nickname)) else emptyMap()))
            val saved = wireJson.decodeFromJsonElement<Place>(JsonObject(wireJson.encodeToJsonElement(optimistic).jsonObject + result))
            mutable.update { it.copy(places = it.places.map { p -> if (p.id == temporaryId) saved else p },
                selected = if (id == null) null else saved, previewId = saved.id, pendingPlaces = it.pendingPlaces - temporaryId, draftFields = null) }
        }
    }
    fun placeAction(action: String) {
        val code = mutable.value.map?.code ?: return
        val place = mutable.value.selected ?: return
        if (place.id in mutable.value.pendingPlaces) return
        if (action == "wish" && mutable.value.nickname.isBlank()) { notice("请先设置昵称"); return }
        if (action == "wish") {
            val who = mutable.value.nickname
            val next = if (who in place.wishes) place.wishes - who else place.wishes + who
            updatePlace(place.id) { it.copy(wishes = next) }
            mutable.update { it.copy(pendingPlaces = it.pendingPlaces + place.id) }
            viewModelScope.launch {
                try {
                    val wishes = api.wish(code, place.id, who)
                    if (code == mutable.value.map?.code) updatePlace(place.id) { it.copy(wishes = wishes) }
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    if (code == mutable.value.map?.code) {
                        updatePlace(place.id) { it.copy(wishes = place.wishes) }
                        notice("点赞未同步：${message(error)}")
                    }
                } finally {
                    mutable.update { it.copy(pendingPlaces = it.pendingPlaces - place.id) }
                    if (code == mutable.value.map?.code) sessions.savePlaces(code, mutable.value.places)
                }
            }
            return
        }
        write("已更新") {
            when (action) {
                "visited" -> {
                    val result = api.savePlace(code, place.id, buildJsonObject { put("visited", !place.visited) })
                    updatePlace(place.id) { it.copy(visited = result.getValue("visited").jsonPrimitive.boolean, visitedAt = result["visited_at"]?.jsonPrimitive?.contentOrNull) }
                }
                "wish" -> { val wishes = api.wish(code, place.id, mutable.value.nickname); updatePlace(place.id) { it.copy(wishes = wishes) } }
                "public" -> { val published = api.publish(code, place.id); updatePlace(place.id) { it.copy(isPublic = published) } }
                "delete" -> api.deletePlace(code, place.id)
            }
            if (action == "delete") { revision++; mutable.update { it.copy(loading = false, places = it.places.filter { p -> p.id != place.id }, previewId = null) } }
            if (action == "delete") mutable.update { it.copy(page = Page.HOME, selected = null) }
        }
    }
    private fun updatePlace(id: Long, transform: (Place) -> Place) {
        revision++
        mutable.update { state -> state.copy(loading = false, places = state.places.map { if (it.id == id) transform(it) else it },
            selected = state.selected?.let { if (it.id == id) transform(it) else it }) }
    }
    fun addComment(text: String, onSuccess: () -> Unit = {}) {
        if (mutable.value.busy || mutable.value.commentsLoading || mutable.value.commentsError != null) return
        val code = mutable.value.map?.code ?: return; val id = mutable.value.selected?.id ?: return
        if (text.isBlank() || text.length > 280) { notice("留言需为 1–280 字"); return }
        if (mutable.value.nickname.isBlank()) { notice("请先设置昵称"); return }
        val author = mutable.value.nickname
        val temporary = Comment(-System.currentTimeMillis(), author, text.trim())
        mutable.update { it.copy(comments = it.comments + temporary) }
        updatePlace(id) { it.copy(commentCount = it.commentCount + 1) }
        write("留言已发送", onFailure = {
            mutable.update { it.copy(comments = it.comments.filter { c -> c.id != temporary.id }) }
            updatePlace(id) { it.copy(commentCount = (it.commentCount - 1).coerceAtLeast(0)) }
        }) {
            val comment = api.comment(code, id, text.trim(), author)
            onSuccess()
            mutable.update { it.copy(comments = it.comments.map { c -> if (c.id == temporary.id) comment else c }) }
            cacheMedia(code, id)
        }
    }
    fun removeComment(id: Long) { val code = mutable.value.map?.code ?: return
        val placeId = mutable.value.selected?.id ?: return
        write("留言已删除") { api.deleteComment(code, id); mutable.update { it.copy(comments = it.comments.filter { c -> c.id != id }) }; updatePlace(placeId) { it.copy(commentCount = (it.commentCount - 1).coerceAtLeast(0)) }; cacheMedia(code, placeId) } }
    fun upload(uri: Uri) {
        val code = mutable.value.map?.code ?: return; val id = mutable.value.selected?.id ?: return
        if (mutable.value.nickname.isBlank()) { notice("请先设置昵称"); return }
        write("照片已上传") {
            val (full, thumb) = compressPhoto(getApplication(), uri)
            val photoId = api.upload(code, id, full, thumb, mutable.value.nickname)
            mutable.update { it.copy(photos = it.photos + Photo(photoId, thumb = thumb, addedBy = it.nickname)) }
            updatePlace(id) { it.copy(photoCount = mutable.value.photos.size) }
            cacheMedia(code, id)
        }
    }
    fun removePhoto(id: Long) { val code = mutable.value.map?.code ?: return
        val placeId = mutable.value.selected?.id ?: return
        write("照片已删除") { api.deletePhoto(code, id); mutable.update { it.copy(photos = it.photos.filter { p -> p.id != id }) }; updatePlace(placeId) { it.copy(photoCount = (it.photoCount - 1).coerceAtLeast(0)) }; cacheMedia(code, placeId) } }
    private fun cacheMedia(code: String, id: Long) {
        if (!mutable.value.detailLoading && mutable.value.photosError == null && mutable.value.commentsError == null)
            mediaCache[code to id] = MediaCache(mutable.value.photos, mutable.value.comments, android.os.SystemClock.elapsedRealtime())
        else mediaCache.remove(code to id)
    }
    fun loadPage() {
        val code = mutable.value.map?.code ?: return; val page = mutable.value.page; val stamp = revision
        mutable.update { it.copy(pageLoading = true, pageError = null) }
        viewModelScope.launch {
            try {
                when (page) {
                    Page.ITINERARY -> { val stops = api.itinerary(code); if (stamp == revision && mutable.value.page == page) mutable.update { it.copy(stops = stops, pageLoading = false) } }
                    Page.MEMORIES -> { val memories = api.memories(code); if (stamp == revision && mutable.value.page == page) mutable.update { it.copy(memories = memories, pageLoading = false) } }
                    Page.TRASH -> { val trash = api.places(code, true); if (stamp == revision && mutable.value.page == page) mutable.update { it.copy(trash = trash, pageLoading = false) } }
                    else -> mutable.update { it.copy(pageLoading = false) }
                }
            } catch (error: Exception) { if (error is CancellationException) throw error; if (stamp == revision && mutable.value.page == page) mutable.update { it.copy(pageLoading = false, pageError = message(error)) } }
        }
    }
    fun itinerary(ids: List<Long>) {
        val code = mutable.value.map?.code ?: return
        if (ids.size > 50) { notice("行程最多 50 站"); return }
        write("行程已保存") { api.saveItinerary(code, ids); val stops = api.itinerary(code); mutable.update { it.copy(stops = stops) } }
    }
    fun restore(id: Long) { val code = mutable.value.map?.code ?: return
        write("地点已恢复") { api.restore(code, id); val trash = api.places(code, true); mutable.update { it.copy(trash = trash) }; refreshPlaces(code) } }
    fun rename(name: String) { val map = mutable.value.map ?: return
        if (name.isBlank() || name.length > 40) { notice("地图名称需为 1–40 字"); return }
        write("地图已改名") { val next = api.rename(map.code, name.trim()); sessions.saveMap(next); revision++; mutable.update { it.copy(map = next, maps = sessions.maps(), loading = false) }; reload() } }
    fun rekey() { val map = mutable.value.map ?: return
        if (mutable.value.pendingPlaces.isNotEmpty()) { notice("地点正在同步，请稍后更换邀请码"); return }
        write("邀请码已更换，请重新分享新码") { val next = api.rekey(map.code); sessions.saveMap(next, map.code); sessions.code = next.code; revision++; mutable.update { it.copy(map = next, maps = sessions.maps()) } } }
    fun deleteMap() { val map = mutable.value.map ?: return
        write("地图已删除") { api.deleteMap(map.code); sessions.forgetMap(map.code); sessions.code = null; revision++; mutable.update { it.copy(map = null, maps = sessions.maps(), selected = null, page = Page.HOME, places = emptyList()) }; reload() } }
    fun report(reason: String) { val place = mutable.value.selected ?: return
        write("举报已提交") { api.report(mutable.value.map?.code, place.id, reason, mutable.value.nickname) } }
}
