package com.modu.explore

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import androidx.lifecycle.ViewModelStore
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.modu.explore.data.*
import com.modu.explore.ui.compressPhoto
import com.modu.explore.ui.placeMarkerBitmap
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class NativeRegressionTest {
    private val app: Application get() = ApplicationProvider.getApplicationContext()
    private fun onMain(action: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync(action)

    @Test fun emojiMarkersKeepStableSizeWhiteBackgroundAndVisitedBadge() {
        val bitmap = placeMarkerBitmap("美食", true, false, 1f)
        try {
            assertEquals(56, bitmap.width)
            assertEquals(60, bitmap.height)
            assertEquals(android.graphics.Color.WHITE, bitmap.getPixel(28, 8))
            assertEquals(0, android.graphics.Color.alpha(bitmap.getPixel(0, 0)))
            assertEquals(255, android.graphics.Color.alpha(bitmap.getPixel(49, 10)))
        } finally { bitmap.recycle() }
    }

    @Test fun wishUsesMutationResponseWithoutReloadingMapOrMedia() = runBlocking {
        app.getSharedPreferences("explore", 0).edit().clear().commit()
        SessionStore(app).apply { saveMap(ExploreMap("AB12CD", "测试")); code = "AB12CD"; nickname = "我" }
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = when {
                    request.path == "/api/maps/AB12CD" -> MockResponse().setBody("""{"code":"AB12CD","name":"测试"}""")
                    request.path == "/api/places?map=AB12CD" -> MockResponse().setBody("""{"places":[{"id":1,"name":"外滩","category":"景点","lng":121.49,"lat":31.24}]}""")
                    request.path?.endsWith("/wish") == true -> MockResponse().setBody("""{"wished":true,"wishes":["我"]}""")
                    request.path?.contains("photos") == true -> MockResponse().setBody("""{"photos":[]}""")
                    request.path?.contains("comments") == true -> MockResponse().setBody("""{"comments":[]}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
            val api = MapApi(server.url("/").toString())
            lateinit var vm: ExploreViewModel
            val store = ViewModelStore()
            onMain { vm = ExploreViewModel(app, api); store.put("test", vm) }
            try {
                withTimeout(5000) { vm.state.first { !it.loading } }
                onMain { vm.openPlace(vm.state.value.places.single()) }
                withTimeout(5000) { vm.state.first { !it.detailLoading } }
                val count = server.requestCount
                onMain { vm.placeAction("wish") }
                withTimeout(5000) { vm.state.first { !it.busy } }
                delay(100)
                assertEquals(listOf("我"), vm.state.value.selected?.wishes)
                assertEquals(count + 1, server.requestCount)
            } finally { onMain { store.clear() } }
        }
    }

    @Test fun previewPrefetchesMediaAndKeepsHomeUntilDetailsOpen() = runBlocking {
        app.getSharedPreferences("explore", 0).edit().clear().commit()
        SessionStore(app).apply { saveMap(ExploreMap("AB12CD", "测试地图")); code = "AB12CD" }
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = when {
                    request.path == "/api/maps/AB12CD" -> MockResponse().setBody("""{"code":"AB12CD","name":"测试地图"}""")
                    request.path == "/api/places?map=AB12CD" -> MockResponse().setBody("""{"places":[{"id":1,"name":"外滩","category":"景点","lng":121.49,"lat":31.24,"address":"中山东一路","description":"夜景"}]}""")
                    request.path?.contains("photos") == true -> MockResponse().setBody("""{"photos":[]}""")
                    request.path?.contains("comments") == true -> MockResponse().setBody("""{"comments":[]}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
            lateinit var vm: ExploreViewModel
            val store = ViewModelStore()
            val api = MapApi(server.url("/").toString())
            onMain { vm = ExploreViewModel(app, api); store.put("test", vm) }
            try {
                withTimeout(5000) { vm.state.first { !it.loading } }
                val requests = server.requestCount
                val place = vm.state.value.places.single()
                onMain { vm.previewPlace(place) }
                assertEquals(Page.HOME, vm.state.value.page)
                assertEquals(place.id, vm.state.value.previewId)
                delay(100)
                assertEquals(requests, server.requestCount)
                onMain { vm.openPlace(place) }
                withTimeout(5000) { vm.state.first { !it.detailLoading } }
                assertEquals(Page.DETAIL, vm.state.value.page)
                assertEquals(requests + 2, server.requestCount)
                onMain { vm.back(); vm.closePreview() }
                assertEquals(Page.HOME, vm.state.value.page)
                assertNull(vm.state.value.previewId)
            } finally { onMain { store.clear() } }
        }
    }

    @Test fun leavingItineraryDoesNotLeaveHomeInLoadingState() = runBlocking {
        app.getSharedPreferences("explore", 0).edit().clear().commit()
        SessionStore(app).apply { saveMap(ExploreMap("AB12CD", "测试地图")); code = "AB12CD" }
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = when (request.path) {
                    "/api/maps/AB12CD" -> MockResponse().setBody("""{"code":"AB12CD","name":"测试地图"}""")
                    "/api/places?map=AB12CD" -> MockResponse().setBody("""{"places":[]}""")
                    "/api/itinerary?map=AB12CD" -> MockResponse().setBody("""{"stops":[]}""").setBodyDelay(1, TimeUnit.SECONDS)
                    else -> MockResponse().setResponseCode(404)
                }
            }
            lateinit var vm: ExploreViewModel
            val store = ViewModelStore()
            val api = MapApi(server.url("/").toString())
            onMain { vm = ExploreViewModel(app, api); store.put("test", vm) }
            try {
                withTimeout(5000) { vm.state.first { !it.loading } }
                onMain { vm.navigate(Page.ITINERARY); vm.back() }
                assertEquals(Page.HOME, vm.state.value.page)
                assertFalse("Collection requests must not change home loading", vm.state.value.loading)
                delay(1200)
                assertEquals(Page.HOME, vm.state.value.page)
                assertFalse(vm.state.value.loading)
            } finally { onMain { store.clear() } }
        }
    }

    @Test fun cameraOrientationAndUploadBudgetsArePreserved() = runBlocking {
        val file = File(app.cacheDir, "camera-test.jpg")
        val original = Bitmap.createBitmap(1200, 600, Bitmap.Config.ARGB_8888)
        original.eraseColor(android.graphics.Color.GREEN)
        file.outputStream().use { original.compress(Bitmap.CompressFormat.JPEG, 90, it) }; original.recycle()
        ExifInterface(file).apply { setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString()); saveAttributes() }
        try {
            val (full, thumb) = compressPhoto(app, Uri.fromFile(file))
            val bytes = Base64.decode(full.substringAfter(','), Base64.DEFAULT)
            val thumbBytes = Base64.decode(thumb.substringAfter(','), Base64.DEFAULT)
            val image = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            assertEquals(600, image.width)
            assertEquals(1200, image.height)
            assertTrue(bytes.size < 1_500_000)
            assertTrue(thumbBytes.size < 60_000)
            image.recycle()
        } finally { file.delete() }
    }

    @Test fun joiningDuringStartupFinishesLoadingAndIgnoresOldResponse() = runBlocking {
        app.getSharedPreferences("explore", 0).edit().clear().commit()
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = when (request.path) {
                    "/api/public/places" -> MockResponse().setBody("""{"places":[]}""").setBodyDelay(2, TimeUnit.SECONDS)
                    "/api/maps/AB12CD" -> MockResponse().setBody("""{"code":"AB12CD","name":"新地图"}""")
                    "/api/places?map=AB12CD" -> MockResponse().setBody("""{"places":[{"id":1,"name":"外滩","category":"景点","lng":121.49,"lat":31.24}]}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
            lateinit var vm: ExploreViewModel
            val store = ViewModelStore()
            val api = MapApi(server.url("/").toString())
            onMain { vm = ExploreViewModel(app, api); store.put("test", vm) }
            try {
                server.takeRequest(5, TimeUnit.SECONDS)
                onMain { vm.joinMap("ab12cd") }
                withTimeout(5000) { vm.state.first { it.map?.code == "AB12CD" && !it.busy } }
                assertFalse(vm.state.value.loading)
                delay(2200)
                assertEquals("外滩", vm.state.value.places.single().name)
                assertEquals("AB12CD", vm.state.value.map?.code)
            } finally { onMain { store.clear() } }
        }
    }

    @Test fun editingDoesNotSendAnotherAuthorsIdentity() = runBlocking {
        app.getSharedPreferences("explore", 0).edit().clear().commit()
        SessionStore(app).apply { saveMap(ExploreMap("AB12CD", "测试地图")); code = "AB12CD"; nickname = "编辑者" }
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = when {
                    request.method == "PUT" -> MockResponse().setBody("{}")
                    request.path == "/api/maps/AB12CD" -> MockResponse().setBody("""{"code":"AB12CD","name":"测试地图"}""")
                    request.path == "/api/places?map=AB12CD" -> MockResponse().setBody("""{"places":[{"id":1,"name":"外滩","category":"景点","lng":121.49,"lat":31.24,"added_by":"原作者"}]}""")
                    request.path?.contains("photos") == true -> MockResponse().setBody("""{"photos":[]}""")
                    request.path?.contains("comments") == true -> MockResponse().setBody("""{"comments":[]}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
            lateinit var vm: ExploreViewModel
            val store = ViewModelStore()
            val api = MapApi(server.url("/").toString())
            onMain { vm = ExploreViewModel(app, api); store.put("test", vm) }
            try {
                withTimeout(5000) { vm.state.first { !it.loading } }
                onMain { vm.openPlace(vm.state.value.places.single()); vm.savePlace(buildJsonObject { put("name", "新名称") }) }
                withTimeout(5000) { vm.state.first { !it.busy } }
                var request: RecordedRequest?
                do { request = server.takeRequest(5, TimeUnit.SECONDS) } while (request != null && request.method != "PUT")
                assertNotNull(request)
                assertFalse(request!!.body.readUtf8().contains("added_by"))
                assertEquals("原作者", vm.state.value.selected?.addedBy)
            } finally { onMain { store.clear() } }
        }
    }
}
