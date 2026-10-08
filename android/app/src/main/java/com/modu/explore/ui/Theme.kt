package com.modu.explore.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

@Composable fun ExploreTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val palette = if (dark) darkColorScheme(
        primary = Color(0xff22d3ee), onPrimary = Color(0xff0a0f1e),
        secondary = Color(0xffff3d81), background = Color(0xff0a0f1e),
        surface = Color(0xff10182b), onSurface = Color(0xffe8ecf8),
        onBackground = Color(0xffe8ecf8), onSurfaceVariant = Color(0xff9aa7c7),
        outline = Color(0xff263352), outlineVariant = Color(0xff263352), error = Color(0xffff5d7a),
        primaryContainer = Color(0xff173344), onPrimaryContainer = Color(0xff22d3ee),
        surfaceContainer = Color(0xff10182b), surfaceContainerHigh = Color(0xff10182b),
        surfaceContainerHighest = Color(0xff18233b)
    ) else lightColorScheme(
        primary = Color(0xff0f766e), onPrimary = Color.White,
        secondary = Color(0xff0891b2), background = Color(0xfff2f6f5),
        surface = Color.White, onSurface = Color(0xff1f2d2a),
        onBackground = Color(0xff1f2d2a), onSurfaceVariant = Color(0xff5b6f6b),
        outline = Color(0xffdde7e4), outlineVariant = Color(0xffdde7e4), error = Color(0xffbe4a43),
        primaryContainer = Color(0xffd7eeea), onPrimaryContainer = Color(0xff134e48),
        surfaceContainer = Color.White, surfaceContainerHigh = Color.White,
        surfaceContainerHighest = Color(0xffedf3f1)
    )
    MaterialTheme(colorScheme = palette, content = content)
}
