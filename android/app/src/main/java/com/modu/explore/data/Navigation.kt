package com.modu.explore.data

import java.net.URLEncoder

private fun parameter(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

fun amapRouteUri(stops: List<Place>): String {
    require(stops.isNotEmpty())
    val target = stops.last()
    val query = linkedMapOf("sourceApplication" to "魔都Explore", "dlat" to target.lat.toString(),
        "dlon" to target.lng.toString(), "dname" to target.name, "dev" to "0", "t" to "2")
    if (stops.size > 1) {
        val origin = stops.first()
        query += mapOf("slat" to origin.lat.toString(), "slon" to origin.lng.toString(), "sname" to origin.name)
        val via = stops.drop(1).dropLast(1)
        if (via.isNotEmpty()) query += mapOf("vian" to via.size.toString(),
            "vialons" to via.joinToString("|") { it.lng.toString() }, "vialats" to via.joinToString("|") { it.lat.toString() },
            "vianames" to via.joinToString("|") { it.name.replace("|", " ") })
    }
    return "amapuri://route/plan/?" + query.entries.joinToString("&") { "${it.key}=${parameter(it.value)}" }
}
