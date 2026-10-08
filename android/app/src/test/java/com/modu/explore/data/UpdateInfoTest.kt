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
}
