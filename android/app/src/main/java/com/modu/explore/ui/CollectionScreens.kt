package com.modu.explore.ui

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.modu.explore.*
import com.modu.explore.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable fun ItineraryScreen(state: ExploreState, vm: ExploreViewModel) {
    val context = LocalContext.current
    val ids = state.stops.map { it.id }
    val total = state.stops.zipWithNext().sumOf { (a, b) -> distanceKm(a.lng, a.lat, b.lng, b.lat) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            when { state.pageLoading -> EmptyState("正在加载行程…", true); state.pageError != null -> EmptyState(state.pageError, retry = vm::loadPage) }
            if (!state.pageLoading && state.pageError == null) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${state.stops.size} 站", style = MaterialTheme.typography.titleLarge)
                    if (state.stops.size > 1) Text("直线距离 ${distanceText(total)} · ${walkText(total)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { shareText(context, "《${state.map?.name}》行程单\n" + state.stops.mapIndexed { i, p -> "${i + 1}. ${p.name}" }.joinToString("\n")) }, enabled = ids.isNotEmpty()) { Icon(Icons.Outlined.Share, null); Text("分享", Modifier.padding(start = 8.dp)) }
                        Button(onClick = { openUrl(context, itineraryNavUrl(state.stops)) }, enabled = ids.size > 1) { Icon(Icons.Outlined.Navigation, null); Text("步行导航", Modifier.padding(start = 8.dp)) }
                    }
                }
                if (ids.isEmpty()) EmptyState("行程还是空的")
            }
        }
        if (!state.pageLoading && state.pageError == null) {
            items(state.stops, key = { it.id }) { p ->
                val index = ids.indexOf(p.id)
                Column {
                    PlaceRow(p, subtitle = "第 ${index + 1} 站 · ${p.category}", onClick = { vm.openPlace(p) }, trailing = {
                        Row {
                            Tool(Icons.Outlined.ArrowUpward, "上移", !state.busy && index > 0) { val next = ids.toMutableList(); java.util.Collections.swap(next, index, index - 1); vm.itinerary(next) }
                            Tool(Icons.Outlined.ArrowDownward, "下移", !state.busy && index < ids.lastIndex) { val next = ids.toMutableList(); java.util.Collections.swap(next, index, index + 1); vm.itinerary(next) }
                            Tool(Icons.Outlined.Close, "移出行程", !state.busy) { vm.itinerary(ids - p.id) }
                        }
                    })
                    state.stops.getOrNull(index + 1)?.let { next ->
                        val distance = distanceKm(p.lng, p.lat, next.lng, next.lat)
                        Text("${distanceText(distance)} · ${walkText(distance)}", Modifier.padding(start = 20.dp, top = 8.dp, bottom = 8.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item { SectionLabel("添加地点") }
            items(state.places.filter { it.id !in ids }, key = { it.id }) { p ->
                PlaceRow(p, onClick = { if (!state.busy) vm.itinerary(ids + p.id) }, trailing = { Tool(Icons.Outlined.Add, "加入行程", !state.busy) { vm.itinerary(ids + p.id) } })
            }
        }
    }
}

@Composable fun MemoriesScreen(state: ExploreState, vm: ExploreViewModel) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { when { state.pageLoading -> EmptyState("正在加载回忆…", true); state.pageError != null -> EmptyState(state.pageError, retry = vm::loadPage); state.memories.isEmpty() -> EmptyState("打卡之后，回忆会出现在这里") } }
        if (!state.pageLoading && state.pageError == null) items(state.memories, key = { it.id }) { memory ->
            Column(Modifier.fillMaxWidth().clickable {
                state.places.find { it.id == memory.id }?.let(vm::openPlace) ?: vm.notice("地点已更新，请返回刷新")
            }.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(memory.visitedAt?.take(10) ?: "已打卡", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Row(verticalAlignment = Alignment.CenterVertically) { CategoryIcon(memory.category); Text(memory.name, Modifier.weight(1f).padding(start = 12.dp), style = MaterialTheme.typography.titleMedium) }
                if (memory.address.isNotBlank()) Text(memory.address, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { memory.photos.take(3).forEach { photo -> AsyncImage(imageModel(photo), "回忆照片", Modifier.weight(1f).aspectRatio(1f), contentScale = ContentScale.Crop) } }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable fun TrashScreen(state: ExploreState, vm: ExploreViewModel, confirm: (String, () -> Unit) -> Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Text("删除的地点保留 30 天", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            when { state.pageLoading -> EmptyState("正在加载回收站…", true); state.pageError != null -> EmptyState(state.pageError, retry = vm::loadPage); state.trash.isEmpty() -> EmptyState("回收站是空的") }
        }
        if (!state.pageLoading && state.pageError == null) items(state.trash, key = { it.id }) { p ->
            PlaceRow(p, subtitle = "删除于 ${p.deletedAt?.take(10).orEmpty()}", onClick = {}, trailing = { Tool(Icons.Outlined.Restore, "恢复地点", !state.busy) { confirm("恢复「${p.name}」？", { vm.restore(p.id) }) } })
        }
    }
}

@Composable fun PosterScreen(state: ExploreState, vm: ExploreViewModel) {
    val map = state.map ?: return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    val bitmap = remember(map, state.places) { poster(map, state.places) }
    DisposableEffect(bitmap) { onDispose { bitmap.recycle() } }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        if (uri != null) scope.launch {
            saving = true
            runCatching { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } ?: error("无法保存海报") } }
                .onSuccess { vm.notice("海报已保存") }.onFailure { vm.notice("保存失败，请重试") }
            saving = false
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (state.loading || state.error != null) { EmptyState(state.error ?: "正在加载…", state.loading, vm::reload); return }
        Image(bitmap.asImageBitmap(), "${map.name} 分享海报", Modifier.weight(1f).fillMaxWidth(), contentScale = ContentScale.Fit)
        Button(onClick = { save.launch("Explore-${map.code}.png") }, enabled = !saving, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Download, null); Text(if (saving) "保存中…" else "保存海报", Modifier.padding(start = 8.dp)) }
    }
}
