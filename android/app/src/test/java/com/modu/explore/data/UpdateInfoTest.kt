package com.modu.explore.data

import org.junit.Assert.*
import org.junit.Test

class UpdateInfoTest {
    private val info = UpdateInfo("com.modu.explore", 3, "0.3.0", "https://example.com/explore.apk", "a".repeat(64), "改进地图")
    @Test fun onlyNewerMatchingPackagesAreUpdates() {
        assertTrue(info.isNewerThan("com.modu.explore", 2))
        assertFalse(info.isNewerThan("com.modu.explore", 3))
        assertFalse(info.isNewerThan("com.modu.explore", 4))
        assertFalse(info.isNewerThan("another.app", 2))
    }
    @Test fun rejectsInsecureUrlsAndMissingChecksums() {
        assertTrue(info.isValid())
        assertFalse(info.copy(apkUrl = "http://example.com/explore.apk").isValid())
        assertFalse(info.copy(sha256 = "").isValid())
        assertFalse(info.copy(apkUrl = "https://user:password@example.com/app.apk").isValid())
        assertFalse(info.copy(versionCode = -1).isValid())
    }
    @Test fun previewIsHiddenUntilOptInAndStableStillWinsByVersion() {
        val stable = info.copy(versionCode = 4, versionName = "0.4.0")
        val preview = info.copy(versionCode = 5, versionName = "0.5.0-preview", channel = "preview")
        val catalog = UpdateCatalog(listOf(info, stable, preview))
        assertEquals(stable, catalog.latest("com.modu.explore", 3, false))
        assertEquals(preview, catalog.latest("com.modu.explore", 3, true))
        assertNull(catalog.latest("com.modu.explore", 4, false))
        assertEquals(listOf(4, 3), catalog.history("com.modu.explore", false).map { it.versionCode })
        assertEquals(listOf(5, 4, 3), catalog.history("com.modu.explore", true).map { it.versionCode })
        assertEquals(stable.copy(versionCode = 6), UpdateCatalog(listOf(preview, stable.copy(versionCode = 6))).latest("com.modu.explore", 5, true))
    }
    @Test fun legacyManifestDefaultsToStableAndHistoryDoesNotRequireAnApk() {
        val legacy = wireJson.decodeFromString<UpdateInfo>("""{"packageName":"com.modu.explore","versionCode":3,"versionName":"0.3.0","apkUrl":"https://example.com/app.apk","sha256":"${"a".repeat(64)}"}""")
        assertEquals("stable", legacy.channel)
        assertTrue(legacy.isValid())
        val catalog = UpdateCatalog(listOf(legacy.copy(apkUrl = "", sha256 = "")))
        assertEquals(1, catalog.history("com.modu.explore", false).size)
        assertNull(catalog.latest("com.modu.explore", 1, false))
    }
}
