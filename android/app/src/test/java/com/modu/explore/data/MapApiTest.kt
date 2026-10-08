package com.modu.explore.data

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress

class MapApiTest {
    @Test fun getRecoversOnceAfterSocketDisconnect() = runTest {
        MockWebServer().use { server ->
            server.start(InetAddress.getByName("127.0.0.1"), 0)
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
            server.enqueue(MockResponse().setBody("""{"photos":[]}"""))
            val url = server.url("/").newBuilder().host("127.0.0.1").build()
            assertTrue(MapApi(url.toString()).photos("AB12CD", 1).isEmpty())
            assertEquals(2, server.requestCount)
        }
    }
    @Test fun getHttpErrorIsNotRetried() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"无权访问"}"""))
            try {
                MapApi(server.url("/").toString()).getMap("AB12CD")
                fail("Expected ApiException")
            } catch (error: ApiException) {
                assertEquals(403, error.status)
            }
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun deleteCarriesInviteHeaderAndHandlesEmpty204() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(204))
            MapApi(server.url("/").toString()).deletePlace("AB12CD", 7)
            val request = server.takeRequest()
            assertEquals("DELETE", request.method)
            assertEquals("/api/places/7", request.path)
            assertEquals("AB12CD", request.getHeader("x-map-code"))
            assertNull(request.getHeader("Authorization"))
        }
    }
    @Test fun failedWriteIsNeverAutomaticallyRepeated() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"服务暂时不可用"}"""))
            try {
                MapApi(server.url("/").toString()).createMap("周末", "小明")
                fail("Expected ApiException")
            } catch (error: ApiException) {
                assertEquals(503, error.status)
                assertEquals("服务暂时不可用", error.message)
            }
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun createMapUsesExistingWebIdentityContract() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"code":"AB12CD","name":"周末","created_by":"小明"}"""))
            val map = MapApi(server.url("/").toString()).createMap("周末", "小明")
            assertEquals("AB12CD", map.code)
            assertTrue(server.takeRequest().body.readUtf8().contains("\"createdBy\":\"小明\""))
        }
    }
}
