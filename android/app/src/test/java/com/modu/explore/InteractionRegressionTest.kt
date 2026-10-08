package com.modu.explore

import android.app.Application
import androidx.lifecycle.ViewModelStore
import com.modu.explore.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.jsonPrimitive

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class InteractionRegressionTest {
    private val dispatcher = StandardTestDispatcher()
    private val store = ViewModelStore()
    private lateinit var server: MockWebServer
    private lateinit var vm: ExploreViewModel
    private lateinit var app: Application
    private var wishResponse = MockResponse().setBody("""{"wishes":["我"]}""").setBodyDelay(250, TimeUnit.MILLISECONDS)
    private var commentDelay = 0L
    private var placeWriteResponse = MockResponse().setResponseCode(503).setBody("""{"error":"稍后重试"}""").setBodyDelay(250, TimeUnit.MILLISECONDS)
    private var commentWriteResponse = MockResponse().setResponseCode(503).setBody("""{"error":"稍后重试"}""").setBodyDelay(250, TimeUnit.MILLISECONDS)

    @Before fun setup() {
        Dispatchers.setMain(dispatcher)
        app = RuntimeEnvironment.getApplication()
        app.getSharedPreferences("explore", 0).edit().clear().commit()
        SessionStore(app).apply { saveMap(ExploreMap("AB12CD", "测试")); code = "AB12CD"; nickname = "我" }
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when {
                request.method == "POST" && request.path == "/api/places" -> placeWriteResponse
                request.method == "POST" && request.path?.contains("comments") == true -> commentWriteResponse
                request.path == "/api/maps/AB12CD" -> MockResponse().setBody("""{"code":"AB12CD","name":"测试"}""")
                request.path == "/api/places?map=AB12CD" -> MockResponse().setBody("""{"places":[{"id":1,"name":"外滩","category":"景点","lng":121.49,"lat":31.24}]}""")
                request.path?.endsWith("/wish") == true -> wishResponse
                request.path?.contains("photos") == true -> MockResponse().setBody("""{"photos":[{"id":2,"thumb":"https://example.com/photo.jpg"}]}""")
                request.path?.contains("comments") == true -> MockResponse().setBody("""{"comments":[]}""").setBodyDelay(commentDelay, TimeUnit.MILLISECONDS)
                else -> MockResponse().setResponseCode(404)
            }
        }
        server.start()
        vm = ExploreViewModel(app, MapApi(server.url("/").toString()))
        store.put("vm", vm)
        await { !vm.state.value.loading }
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (true) {
            dispatcher.scheduler.runCurrent()
            if (condition()) return
            if (System.nanoTime() > deadline) fail("Timed out: ${vm.state.value}")
            Thread.sleep(10)
        }
    }

    @After fun teardown() {
        store.clear(); dispatcher.scheduler.runCurrent()
        server.shutdown(); Dispatchers.resetMain()
    }

    @Test fun wishIsImmediateAndRollsBackWhenServerRejectsIt() {
        wishResponse = MockResponse().setResponseCode(503).setBody("""{"error":"稍后重试"}""").setBodyDelay(250, TimeUnit.MILLISECONDS)
        vm.openPlace(vm.state.value.places.single())
        await { !vm.state.value.detailLoading && vm.state.value.photos.isNotEmpty() }
        val requests = server.requestCount
        vm.placeAction("wish")
        assertEquals(listOf("我"), vm.state.value.selected!!.wishes)
        assertFalse(vm.state.value.busy)
        await { vm.state.value.pendingPlaces.isEmpty() }
        assertTrue(vm.state.value.selected!!.wishes.isEmpty())
        assertEquals(requests + 1, server.requestCount)
    }

    @Test fun photosAppearBeforeSlowCommentsAndReopeningUsesCache() {
        commentDelay = 600
        vm.openPlace(vm.state.value.places.single())
        await { vm.state.value.photos.isNotEmpty() }
        assertTrue(vm.state.value.commentsLoading)
        await { !vm.state.value.detailLoading }
        val requests = server.requestCount
        vm.back(); vm.openPlace(vm.state.value.places.single())
        dispatcher.scheduler.runCurrent()
        assertFalse(vm.state.value.detailLoading)
        assertEquals(1, vm.state.value.photos.size)
        assertEquals(requests, server.requestCount)
    }

    @Test fun refreshKeepsVisiblePlacesAndRestartReadsLocalCache() {
        vm.reload()
        assertTrue(vm.state.value.loading)
        assertEquals("外滩", vm.state.value.places.single().name)
        await { !vm.state.value.loading }
        val another = ExploreViewModel(app, MapApi(server.url("/").toString()))
        store.put("another", another)
        assertEquals("外滩", another.state.value.places.single().name)
    }

    @Test fun customEmojiAcceptsOneCompositeSymbolAndUsesCategoryFallback() {
        assertTrue(validEmoji("👨‍🍳"))
        assertTrue(validEmoji("🇨🇳"))
        assertFalse(validEmoji("🍜🍕"))
        assertFalse(validEmoji("hello"))
        assertEquals("🍜", Place(1, "餐厅", "美食", 1.0, 1.0).displayEmoji)
        assertEquals("☕", Place(1, "餐厅", "美食", 1.0, 1.0, emoji = "☕").displayEmoji)
    }

    @Test fun openingDetailAdoptsAnInFlightPrefetchWithoutDuplicateRequests() {
        commentDelay = 600
        val requests = server.requestCount
        val place = vm.state.value.places.single()
        vm.previewPlace(place)
        dispatcher.scheduler.advanceTimeBy(300)
        await { server.requestCount >= requests + 2 }
        assertEquals(Page.HOME, vm.state.value.page)
        vm.openPlace(place)
        await { vm.state.value.photos.isNotEmpty() }
        assertTrue(vm.state.value.commentsLoading)
        await { !vm.state.value.detailLoading }
        assertEquals(requests + 2, server.requestCount)
    }

    @Test fun failedAddRemovesTemporaryPlaceAndPreservesEditedFields() {
        vm.startAdd(PickedPoint("", "", 121.4, 31.2))
        vm.savePlace(buildJsonObject {
            put("name", "新咖啡馆"); put("category", "美食"); put("emoji", "☕")
            put("description", "这段备注不能丢"); put("lng", 121.4); put("lat", 31.2)
        })
        assertEquals(Page.HOME, vm.state.value.page)
        assertTrue(vm.state.value.places.any { it.id < 0 && it.name == "新咖啡馆" })
        await { !vm.state.value.busy }
        assertEquals(Page.EDIT, vm.state.value.page)
        assertEquals(listOf(1L), vm.state.value.places.map { it.id })
        assertEquals("这段备注不能丢", vm.state.value.draftFields!!["description"]!!.jsonPrimitive.content)
        assertTrue(vm.state.value.pendingPlaces.isEmpty())
    }

    @Test fun failedCommentRemovesPlaceholderAndDoesNotClearDraft() {
        vm.openPlace(vm.state.value.places.single())
        await { !vm.state.value.detailLoading }
        var cleared = false
        vm.addComment("今晚去看看") { cleared = true }
        assertTrue(vm.state.value.comments.single().id < 0)
        assertEquals(1, vm.state.value.selected!!.commentCount)
        await { !vm.state.value.busy }
        assertTrue(vm.state.value.comments.isEmpty())
        assertEquals(0, vm.state.value.selected!!.commentCount)
        assertFalse(cleared)
    }
}
