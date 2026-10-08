package com.modu.explore.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

@Composable fun ExploreTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val palette = if (dark) darkColorScheme(
        primary = Color(0xff7bd9bd), onPrimary = Color(0xff103d32),
        secondary = Color(0xffefa49a), background = Color(0xff141716),
        surface = Color(0xff1c201f), onSurface = Color(0xffe5e9e6),
        onBackground = Color(0xffe5e9e6), onSurfaceVariant = Color(0xffabb8b2),
        outline = Color(0xff37433d), outlineVariant = Color(0xff303933), error = Color(0xffffb4ab),
        primaryContainer = Color(0xff254c40), onPrimaryContainer = Color(0xffb0efda),
        surfaceContainer = Color(0xff202522), surfaceContainerHigh = Color(0xff282e2a),
        surfaceContainerHighest = Color(0xff303833)
    ) else lightColorScheme(
        primary = Color(0xff0f766e), onPrimary = Color.White,
        secondary = Color(0xffa95448), background = Color(0xfff5f7f6),
        surface = Color.White, onSurface = Color(0xff1f2d2a),
        onBackground = Color(0xff1f2d2a), onSurfaceVariant = Color(0xff5b6f6b),
        outline = Color(0xffdde7e4), outlineVariant = Color(0xffdde7e4), error = Color(0xffbe4a43),
        primaryContainer = Color(0xffd7eeea), onPrimaryContainer = Color(0xff134e48),
        surfaceContainer = Color.White, surfaceContainerHigh = Color.White,
        surfaceContainerHighest = Color(0xffedf3f1)
    )
    MaterialTheme(colorScheme = palette, shapes = Shapes(small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(8.dp),
        large = RoundedCornerShape(8.dp), extraLarge = RoundedCornerShape(16.dp)), content = content)
}
