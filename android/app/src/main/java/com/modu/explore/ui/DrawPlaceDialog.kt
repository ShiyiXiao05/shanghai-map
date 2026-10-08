package com.modu.explore.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.modu.explore.data.Place
import com.modu.explore.data.wheelTargetIndex
import kotlin.math.floor
import kotlin.math.roundToInt

@Composable fun DrawPlaceDialog(places: List<Place>, onDismiss: () -> Unit, onPlace: (Place) -> Unit) {
    var round by remember { mutableIntStateOf(0) }
    var result by remember { mutableStateOf<Place?>(null) }
    val position = remember { Animatable(0f) }
    val rowHeight = 56.dp
    val rowPixels = with(LocalDensity.current) { rowHeight.toPx() }
    LaunchedEffect(round, places) {
        result = null
        val chosen = places.indices.random()
        position.snapTo(0f)
        position.animateTo(wheelTargetIndex(places.size, chosen).toFloat(), tween(2400, easing = CubicBezierEasing(.12f, .6f, .15f, 1f)))
        result = places[chosen]
    }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("今天去哪里？") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.fillMaxWidth().height(168.dp).clipToBounds()) {
                HorizontalDivider(Modifier.align(Alignment.Center).offset(y = (-28).dp), color = MaterialTheme.colorScheme.primary.copy(alpha = .5f))
                HorizontalDivider(Modifier.align(Alignment.Center).offset(y = 28.dp), color = MaterialTheme.colorScheme.primary.copy(alpha = .5f))
                val base = floor(position.value).toInt()
                for (offset in -2..2) {
                    val index = base + offset
                    val place = places[Math.floorMod(index, places.size)]
                    val distance = index - position.value
                    Box(Modifier.fillMaxWidth().height(rowHeight).offset { IntOffset(0, (rowPixels + distance * rowPixels).roundToInt()) }, contentAlignment = Alignment.Center) {
                        Text(place.name, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleMedium,
                            color = if (kotlin.math.abs(distance) < .5f) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .45f))
                    }
                }
            }
            Text(result?.let { "${it.category} · ${it.address.ifBlank { "未填写地址" }}" } ?: "正在抽取…", modifier = Modifier.heightIn(min = 40.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } }, confirmButton = { TextButton(enabled = result != null, onClick = { result?.let(onPlace) }) { Text("查看地点") } },
        dismissButton = { TextButton(enabled = result != null, onClick = { round++ }) { Text("再抽一次") } })
}
