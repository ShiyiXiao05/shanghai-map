package com.modu.explore.data

fun adjustedMapFraction(current: Float, deltaPixels: Float, availablePixels: Float): Float =
    if (availablePixels <= 0f || !availablePixels.isFinite()) current
    else (current + deltaPixels / availablePixels).coerceIn(.25f, .7f)

fun wheelTargetIndex(size: Int, chosenIndex: Int): Int {
    require(size > 0 && chosenIndex in 0 until size)
    return size * 5 + chosenIndex
}
