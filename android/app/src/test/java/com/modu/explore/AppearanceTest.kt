package com.modu.explore

import com.modu.explore.data.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import com.modu.explore.ui.currentLocationBitmap

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class AppearanceTest {
    @Test fun themeChoiceSurvivesNewSessionAndOverridesSystem() {
        val app = RuntimeEnvironment.getApplication()
        app.getSharedPreferences("explore", 0).edit().clear().commit()
        assertEquals(ThemeMode.SYSTEM, SessionStore(app).themeMode)
        SessionStore(app).themeMode = ThemeMode.LIGHT
        assertFalse(SessionStore(app).themeMode.isDark(true))
        SessionStore(app).themeMode = ThemeMode.DARK
        assertTrue(SessionStore(app).themeMode.isDark(false))
        assertTrue(ThemeMode.SYSTEM.isDark(true))
        assertFalse(ThemeMode.SYSTEM.isDark(false))
    }
    @Test fun presetsAreVariedUniqueAndValidSingleEmoji() {
        assertTrue(emojiChoices.size >= 100)
        assertEquals(emojiChoices.size, emojiChoices.distinct().size)
        assertEquals(emptyList<String>(), emojiChoices.filterNot(::validEmoji))
        categories.forEach { assertTrue(defaultEmoji(it.name) in emojiChoices) }
    }
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    @Test fun locationDotHasBlueCenterWhiteRimAndTransparentCorners() {
        val bitmap = currentLocationBitmap(2f)
        try {
            assertEquals(56, bitmap.width)
            assertEquals(android.graphics.Color.rgb(42, 132, 255), bitmap.getPixel(28, 28))
            assertEquals(android.graphics.Color.WHITE, bitmap.getPixel(28, 12))
            assertEquals(0, android.graphics.Color.alpha(bitmap.getPixel(0, 0)))
        } finally { bitmap.recycle() }
    }
}
