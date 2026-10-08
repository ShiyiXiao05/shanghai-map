package com.modu.explore.data

import java.net.URI
import java.net.URLDecoder
import org.junit.Assert.*
import org.junit.Test

class NavigationTest {
    private fun query(uri: String) = URI(uri).rawQuery.split('&').associate {
        val (key, value) = it.split('=', limit = 2)
        key to URLDecoder.decode(value, "UTF-8")
    }
    @Test fun singleDestinationUsesAppSchemeAndCurrentLocation() {
        val uri = amapRouteUri(listOf(Place(1, "咖啡 & 面包", "美食", 121.4, 31.2)))
        assertEquals("amapuri", URI(uri).scheme)
        val values = query(uri)
        assertEquals("咖啡 & 面包", values["dname"])
        assertEquals("0", values["dev"])
        assertEquals("2", values["t"])
        assertFalse(values.containsKey("slat"))
    }
    @Test fun itineraryKeepsStartDestinationAndEveryWaypoint() {
        val stops = (1L..4L).map { Place(it, "第${it}站", "景点", 121.0 + it, 31.0 + it) }
        val values = query(amapRouteUri(stops))
        assertEquals("第1站", values["sname"])
        assertEquals("第4站", values["dname"])
        assertEquals("2", values["vian"])
        assertEquals("第2站|第3站", values["vianames"])
    }
}
