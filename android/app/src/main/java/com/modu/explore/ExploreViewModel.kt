package com.modu.explore

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.modu.explore.data.*
import com.modu.explore.ui.compressPhoto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.*
import java.io.IOException

enum class Page { HOME, MAPS, DETAIL, EDIT, SEARCH, ITINERARY, MEMORIES, TRASH, POSTER }
data class ExploreState(
    val page: Page = Page.HOME, val map: ExploreMap? = null,
    val maps: List<ExploreMap> = emptyList(), val nickname: String = "",
    val places: List<Place> = emptyList(), val selected: Place? = null, val previewId: Long? = null,
    val photos: List<Photo> = emptyList(), val comments: List<Comment> = emptyList(),
    val stops: List<Place> = emptyList(), val memories: List<Memory> = emptyList(), val trash: List<Place> = emptyList(),
    val loading: Boolean = false, val detailLoading: Boolean = false, val busy: Boolean = false,
    val error: String? = null, val detailError: String? = null,
    val pageLoading: Boolean = false, val pageError: String? = null, val message: String? = null,
    val selectedCategories: Set<String> = emptySet(), val hideVisited: Boolean = false,
    val sort: PlaceSort = PlaceSort.NEWEST, val mapConsent: Boolean = false,
    val draft: PickedPoint? = null
)

class ExploreViewModel @JvmOverloads constructor(application: Application, val api: MapApi = MapApi(BuildConfig.API_BASE_URL)) : AndroidViewModel(application) {
    private val sessions = SessionStore(application)
    private val mutable = MutableStateFlow(ExploreState(
        map = sessions.maps().find { it.code == sessions.code }, maps = sessions.maps(),
        nickname = sessions.nickname, mapConsent = sessions.mapConsent
    ))
    val state = mutable.asStateFlow()
    private var revision = 0
    private var detailRevision = 0
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
        mutable.update { it.copy(page = if (it.page == Page.EDIT && it.selected != null) Page.DETAIL else Page.HOME, pageError = null, detailLoading = false) }
    }
    fun switchMap(map: ExploreMap?) {
        if (mutable.value.busy) return
        revision++; detailRevision++
        sessions.code = map?.code
        mutable.update { it.copy(map = map, page = Page.HOME, places = emptyList(), selected = null, previewId = null,
            photos = emptyList(), comments = emptyList(), stops = emptyList(), memories = emptyList(), trash = emptyList(),
            selectedCategories = emptySet(), loading = true, error = null) }
        reload()
    }
    fun reload() {
        val stamp = ++revision
        val code = mutable.value.map?.code
        mutable.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val map = code?.let { api.getMap(it) }
                val places = api.places(code)
                if (stamp != revision) return@launch
                if (map != null) sessions.saveMap(map)
                mutable.update { it.copy(map = map, maps = sessions.maps(), places = places, loading = false,
                    selected = it.selected?.let { selected -> places.find { p -> p.id == selected.id } }) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (stamp == revision) mutable.update { it.copy(loading = false, error = message(error)) }
            }
        }
    }
    private fun write(success: String, action: suspend () -> Unit) {
        if (mutable.value.busy) return
        detailRevision++
        mutable.update { it.copy(busy = true, detailLoading = false) }
        viewModelScope.launch {
            try { action(); notice(success) }
            catch (error: Exception) { if (error is CancellationException) throw error; notice(message(error)) }
            finally {
                mutable.update { it.copy(busy = false) }
                if (mutable.value.page == Page.DETAIL && mutable.value.selected != null) loadDetail()
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
            val map = api.getMap(code); val places = api.places(code)
            sessions.saveMap(map); sessions.code = code; revision++
            mutable.update { it.copy(map = map, maps = sessions.maps(), places = places, selected = null, page = Page.HOME,
                loading = false, error = null, selectedCategories = emptySet(), previewId = null) }
        }
    }
    fun previewPlace(place: Place) {
        if (!mutable.value.busy) mutable.update { it.copy(page = Page.HOME, previewId = place.id) }
    }
    fun closePreview() { mutable.update { it.copy(previewId = null) } }
    fun openPlace(place: Place) {
        mutable.update { it.copy(selected = place, page = Page.DETAIL, photos = emptyList(), comments = emptyList(), detailError = null) }
        loadDetail()
    }
    fun loadDetail() {
        val stamp = ++detailRevision
        val code = mutable.value.map?.code ?: return
        val place = mutable.value.selected ?: return
        mutable.update { it.copy(detailLoading = true, detailError = null) }
        viewModelScope.launch {
            try {
                val photos = api.photos(code, place.id); val comments = api.comments(code, place.id)
                if (stamp == detailRevision && code == mutable.value.map?.code && place.id == mutable.value.selected?.id)
                    mutable.update { it.copy(photos = photos, comments = comments, detailLoading = false) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (stamp == detailRevision) mutable.update { it.copy(detailLoading = false, detailError = message(error)) }
            }
        }
    }
    fun startAdd(point: PickedPoint) { mutable.update { it.copy(selected = null, draft = point, page = Page.EDIT, error = null) } }
    fun startEdit() { mutable.value.selected?.let { p -> mutable.update { it.copy(draft = PickedPoint(p.name, p.address, p.lng, p.lat), page = Page.EDIT) } } }
    fun savePlace(fields: JsonObject) {
        val code = mutable.value.map?.code ?: return
        if (mutable.value.nickname.isBlank()) { notice("请先在我的地图中设置昵称"); return }
        val id = mutable.value.selected?.id
        write("地点已保存") {
            api.savePlace(code, id, JsonObject(fields + if (id == null) mapOf("added_by" to JsonPrimitive(mutable.value.nickname)) else emptyMap()))
            refreshPlaces(code); mutable.update { it.copy(page = if (id == null) Page.HOME else Page.DETAIL) }
        }
    }
    fun placeAction(action: String) {
        val code = mutable.value.map?.code ?: return
        val place = mutable.value.selected ?: return
        if (action == "wish" && mutable.value.nickname.isBlank()) { notice("请先设置昵称"); return }
        write("已更新") {
            when (action) {
                "visited" -> api.savePlace(code, place.id, buildJsonObject { put("visited", !place.visited) })
                "wish" -> api.wish(code, place.id, mutable.value.nickname)
                "public" -> api.publish(code, place.id)
                "delete" -> api.deletePlace(code, place.id)
            }
            refreshPlaces(code)
            if (action == "delete") mutable.update { it.copy(page = Page.HOME, selected = null) }
        }
    }
    fun addComment(text: String, onSuccess: () -> Unit = {}) {
        val code = mutable.value.map?.code ?: return; val id = mutable.value.selected?.id ?: return
        if (text.isBlank() || text.length > 280) { notice("留言需为 1–280 字"); return }
        if (mutable.value.nickname.isBlank()) { notice("请先设置昵称"); return }
        write("留言已发送") { api.comment(code, id, text.trim(), mutable.value.nickname); onSuccess(); val comments = api.comments(code, id); mutable.update { it.copy(comments = comments) }; refreshPlaces(code) }
    }
    fun removeComment(id: Long) { val code = mutable.value.map?.code ?: return
        write("留言已删除") { api.deleteComment(code, id); mutable.update { it.copy(comments = it.comments.filter { c -> c.id != id }) }; refreshPlaces(code) } }
    fun upload(uri: Uri) {
        val code = mutable.value.map?.code ?: return; val id = mutable.value.selected?.id ?: return
        if (mutable.value.nickname.isBlank()) { notice("请先设置昵称"); return }
        write("照片已上传") {
            val (full, thumb) = compressPhoto(getApplication(), uri)
            api.upload(code, id, full, thumb, mutable.value.nickname)
            val photos = api.photos(code, id); mutable.update { it.copy(photos = photos) }; refreshPlaces(code)
        }
    }
    fun removePhoto(id: Long) { val code = mutable.value.map?.code ?: return
        write("照片已删除") { api.deletePhoto(code, id); mutable.update { it.copy(photos = it.photos.filter { p -> p.id != id }) }; refreshPlaces(code) } }
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
        write("邀请码已更换，请重新分享新码") { val next = api.rekey(map.code); sessions.saveMap(next, map.code); sessions.code = next.code; revision++; mutable.update { it.copy(map = next, maps = sessions.maps()) } } }
    fun deleteMap() { val map = mutable.value.map ?: return
        write("地图已删除") { api.deleteMap(map.code); sessions.forgetMap(map.code); sessions.code = null; revision++; mutable.update { it.copy(map = null, maps = sessions.maps(), selected = null, page = Page.HOME, places = emptyList()) }; reload() } }
    fun report(reason: String) { val place = mutable.value.selected ?: return
        write("举报已提交") { api.report(mutable.value.map?.code, place.id, reason, mutable.value.nickname) } }
}
