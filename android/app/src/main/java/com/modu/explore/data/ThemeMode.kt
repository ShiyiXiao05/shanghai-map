package com.modu.explore.data

enum class ThemeMode(val label: String) {
    SYSTEM("跟随系统"), LIGHT("浅色模式"), DARK("深色模式");
    fun isDark(systemDark: Boolean): Boolean = when (this) {
        SYSTEM -> systemDark
        LIGHT -> false
        DARK -> true
    }
}
