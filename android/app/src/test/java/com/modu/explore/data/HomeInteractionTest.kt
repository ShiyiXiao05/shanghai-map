package com.modu.explore.data

import org.junit.Assert.*
import org.junit.Test

class HomeInteractionTest {
    @Test fun splitKeepsBothPanesUsableAndHandlesInvalidMeasurement() {
        assertEquals(.6f, adjustedMapFraction(.5f, 100f, 1000f), .001f)
        assertEquals(.7f, adjustedMapFraction(.5f, 2000f, 1000f), .001f)
        assertEquals(.25f, adjustedMapFraction(.5f, -2000f, 1000f), .001f)
        assertEquals(.5f, adjustedMapFraction(.5f, 100f, 0f), .001f)
    }
    @Test fun wheelEndsAtChosenIndexAfterSeveralTurns() {
        val target = wheelTargetIndex(7, 2)
        assertEquals(2, target % 7)
        assertTrue(target >= 7 * 4)
        assertEquals(0, wheelTargetIndex(1, 0) % 1)
    }
}
