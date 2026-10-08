package com.modu.explore.data

import kotlinx.serialization.decodeFromString
import org.junit.Assert.*
import org.junit.Test

class ModelsTest {
    @Test fun serverPlacesDecodeWithoutLeakingMapCodeIntoPublicModel() {
        val result = wireJson.decodeFromString<PlacesResponse>("""{"places":[{"id":7,"name":"外滩","category":"景点","lng":121.49,"lat":31.24,"wishes":["小明"],"photo_count":2,"map_code":"SECRET"}]}""")
        assertEquals(7L, result.places.single().id)
        assertEquals(2, result.places.single().photoCount)
        assertEquals(listOf("小明"), result.places.single().wishes)
        assertFalse(result.places.single().visited)
    }
    @Test fun filterAndWishSortRespectVisitedAndCategories() {
        val places = listOf(
            Place(1, "美术馆", "展馆", 121.0, 31.0, visited = true),
            Place(2, "餐厅", "美食", 121.0, 31.0, wishes = listOf("甲", "乙")),
            Place(3, "公园", "景点", 121.0, 31.0, wishes = listOf("甲"))
        )
        assertEquals(listOf(2L, 3L), filterPlaces(places, emptySet(), true, PlaceSort.WISHES).map { it.id })
        assertEquals(listOf(3L), filterPlaces(places, setOf("景点"), false, PlaceSort.NEWEST).map { it.id })
    }
    @Test fun invitationRequiresExactlySixLettersOrNumbers() {
        assertEquals("AB12CD", normalizeCode(" ab12cd "))
        assertNull(normalizeCode("ABC"))
        assertNull(normalizeCode("ABC/DE"))
    }
    @Test fun distanceUsesGcjCoordinatesAndIsSymmetric() {
        val a = Place(1, "甲", "景点", 121.49, 31.24)
        val b = Place(2, "乙", "景点", 121.49, 31.25)
        assertEquals(1.112, distanceKm(a.lng, a.lat, b.lng, b.lat), 0.002)
        assertEquals(distanceKm(a.lng, a.lat, b.lng, b.lat), distanceKm(b.lng, b.lat, a.lng, a.lat), 0.00001)
    }
    @Test fun importParsesAmapCoordinatesAndRejectsOutOfRange() {
        assertEquals(121.49, parseSharedPoint("https://uri.amap.com/marker?position=121.49,31.24&name=外滩")!!.lng, 0.00001)
        assertEquals("外滩", parseSharedPoint("【外滩】位置：121.49,31.24")!!.name)
        assertNull(parseSharedPoint("位置：999,31"))
    }
}
