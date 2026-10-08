package com.modu.explore.ui

import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.modu.explore.*
import com.modu.explore.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun Tool(icon: ImageVector, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(), tooltip = { PlainTooltip { Text(label) } }, state = rememberTooltipState()) {
        IconButton(onClick = onClick, enabled = enabled) { Icon(icon, contentDescription = label) }
    }
}
@Composable fun CategoryIcon(name: String, modifier: Modifier = Modifier, emoji: String = defaultEmoji(name)) {
    Box(modifier.size(40.dp).background(Color(category(name).color).copy(alpha = .12f), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
        Text(emoji, style = MaterialTheme.typography.titleLarge)
    }
}
@Composable fun EmptyState(text: String, loading: Boolean = false, retry: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (loading) CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
        retry?.let { OutlinedButton(onClick = it) { Text("重试") } }
    }
}
@Composable fun PlaceRow(place: Place, subtitle: String? = null, onClick: () -> Unit, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        CategoryIcon(place.category, emoji = place.displayEmoji)
        Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(place.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(subtitle ?: listOf(place.category, place.addedBy.takeIf { it.isNotBlank() },
                if (place.photoCount > 0) "${place.photoCount} 张照片" else null,
                if (place.commentCount > 0) "${place.commentCount} 条留言" else null).filterNotNull().joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (place.visited) Icon(Icons.Outlined.CheckCircle, "已去过", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
        if (trailing != null) trailing() else if (place.wishes.isNotEmpty()) Text("♡ ${place.wishes.size}", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 8.dp))
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = .5f))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ExploreApp(vm: ExploreViewModel = viewModel()) {
    val updates: UpdateViewModel = viewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var privacy by remember { mutableStateOf(false) }
    var confirmation by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val confirm: (String, () -> Unit) -> Unit = { text, action -> confirmation = text to action }
    BackHandler(state.page != Page.HOME) { vm.back() }
    DisposableEffect(lifecycle, updates) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) updates.check(quiet = true) }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) updates.check(quiet = true)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(state.message) { state.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() } }
    Scaffold(containerColor = MaterialTheme.colorScheme.background, snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(title = {
                if (state.page == Page.HOME) Column(Modifier.clickable(enabled = !state.busy) { vm.navigate(Page.MAPS) }) {
                    Text(state.map?.name ?: "公共广场", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                    Text("切换 ▾", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                } else Text(when (state.page) {
                    Page.MAPS -> "我的地图"; Page.DETAIL -> "地点详情"; Page.EDIT -> if (state.selected == null) "标记地点" else "编辑地点"
                    Page.SEARCH -> "选择地点"; Page.ITINERARY -> "行程单"; Page.MEMORIES -> "回忆时间线"
                    Page.TRASH -> "回收站"; Page.POSTER -> "分享海报"; Page.CHANGELOG -> "更新日志"; else -> "魔都·Explore"
                }, style = MaterialTheme.typography.titleMedium)
            }, navigationIcon = { if (state.page != Page.HOME) Tool(Icons.AutoMirrored.Outlined.ArrowBack, "返回", !state.busy, vm::back) },
                actions = {
                    if (state.page == Page.HOME) {
                        Tool(Icons.Outlined.PhotoCamera, "回忆", !state.busy) { vm.navigate(if (state.map == null) Page.MAPS else Page.MEMORIES) }
                        Tool(Icons.AutoMirrored.Outlined.DirectionsWalk, "行程", !state.busy) { vm.navigate(if (state.map == null) Page.MAPS else Page.ITINERARY) }
                        Tool(Icons.Outlined.AddLocationAlt, "标记地点", !state.busy) { vm.navigate(if (state.map == null) Page.MAPS else Page.SEARCH) }
                    } else if (state.page == Page.DETAIL) Tool(Icons.Outlined.Share, "分享地点") {
                        state.selected?.let { shareText(context, "${it.name}\n${vm.api.baseUrl}/?${if (state.map != null) "map=${state.map!!.code}&" else ""}place=${it.id}") }
                    }
                }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background))
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            when (state.page) {
                Page.HOME -> HomeScreen(state, vm, onConsent = { privacy = true })
                Page.MAPS -> MapsScreen(state, vm, confirm, updates)
                Page.DETAIL -> DetailScreen(state, vm, confirm)
                Page.EDIT -> EditScreen(state, vm)
                Page.SEARCH -> SearchScreen(state, vm) { privacy = true }
                Page.ITINERARY -> ItineraryScreen(state, vm)
                Page.MEMORIES -> MemoriesScreen(state, vm)
                Page.TRASH -> TrashScreen(state, vm, confirm)
                Page.POSTER -> PosterScreen(state, vm)
                Page.CHANGELOG -> ChangelogScreen(updates)
            }
        }
    }
    UpdateDialog(updates) { updates.dismiss(); vm.navigate(Page.CHANGELOG); updates.loadHistory() }
    if (privacy) AlertDialog(onDismissRequest = { privacy = false }, title = { Text("开启地图服务") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("地图、地点搜索与定位由高德提供。开启后，SDK 将处理设备信息和网络信息；定位仅在你主动使用并授予权限后进行。")
            TextButton(onClick = { openUrl(context, "https://lbs.amap.com/pages/privacy/") }) { Text("高德隐私政策") }
        } }, confirmButton = { TextButton(onClick = { vm.consent(); privacy = false }) { Text("同意并开启") } },
        dismissButton = { TextButton(onClick = { privacy = false }) { Text("暂不开启") } })
    confirmation?.let { (text, action) -> AlertDialog(onDismissRequest = { confirmation = null },
        title = { Text("确认操作") }, text = { Text(text) }, confirmButton = { TextButton(onClick = { confirmation = null; action() }) { Text("确认") } },
        dismissButton = { TextButton(onClick = { confirmation = null }) { Text("取消") } }) }
}

@Composable private fun HomeScreen(state: ExploreState, vm: ExploreViewModel, onConsent: () -> Unit) {
    var fullscreen by rememberSaveable { mutableStateOf(false) }
    var sortOpen by remember { mutableStateOf(false) }
    var center by remember { mutableStateOf<PickedPoint?>(null) }
    var nearby by remember { mutableStateOf(false) }
    var drawCandidates by remember { mutableStateOf<List<Place>>(emptyList()) }
    var mapFraction by rememberSaveable { mutableFloatStateOf(.43f) }
    var contentHeight by remember { mutableIntStateOf(0) }
    var fitRequest by remember { mutableIntStateOf(0) }
    val preview = state.places.find { it.id == state.previewId }
    LaunchedEffect(state.map?.code) { center = null; fullscreen = false; drawCandidates = emptyList(); nearby = false }
    LaunchedEffect(preview?.id) { preview?.let { center = PickedPoint(it.name, it.address, it.lng, it.lat) } }
    val filtered = remember(state.places, state.selectedCategories, state.hideVisited, state.sort) {
        filterPlaces(state.places, state.selectedCategories, state.hideVisited, state.sort)
    }
    val locate = rememberLocate(state.mapConsent, onConsent, { center = it; nearby = true }, vm::notice)
    val previewPlace: (Place) -> Unit = { fullscreen = false; center = PickedPoint(it.name, it.address, it.lng, it.lat); vm.previewPlace(it) }
    fun closePreview() { vm.closePreview(); center = null }
    BackHandler(preview != null || fullscreen) { if (preview != null) closePreview() else fullscreen = false }
    Column(Modifier.fillMaxSize().onSizeChanged { contentHeight = it.height }) {
        Box(Modifier.fillMaxWidth().weight(if (fullscreen) 1f else mapFraction).background(MaterialTheme.colorScheme.surface)) {
            NativeMap(filtered, state.mapConsent, isSystemInDarkTheme(), Modifier.fillMaxSize(), center, onConsent,
                onPlace = previewPlace, onPick = if (state.map == null) null else vm::startAdd,
                selectedId = preview?.id, fitRequest = fitRequest, mapIdentity = state.map?.code,
                onMapClick = { closePreview() })
            Surface(Modifier.align(Alignment.BottomEnd).padding(12.dp), shape = RoundedCornerShape(8.dp), shadowElevation = 2.dp) {
                Row {
                    Tool(Icons.Outlined.CenterFocusStrong, "显示全部地点") { center = null; fitRequest++ }
                    Tool(Icons.Outlined.MyLocation, "附近", !state.busy, locate)
                    Tool(Icons.Outlined.Casino, "随机抽取", !state.busy) { if (state.places.isEmpty()) vm.notice("还没有可抽取的地点") else drawCandidates = state.places.toList() }
                    Tool(if (fullscreen) Icons.Outlined.FullscreenExit else Icons.Outlined.Fullscreen, "切换全屏") { fullscreen = !fullscreen }
                }
            }
        }
        if (!fullscreen) {
            Box(Modifier.fillMaxWidth().height(24.dp).background(MaterialTheme.colorScheme.surface)
                .semantics {
                    contentDescription = "调整地图与地点比例"
                    progressBarRangeInfo = ProgressBarRangeInfo(mapFraction, .25f.. .7f)
                    setProgress { mapFraction = it.coerceIn(.25f, .7f); true }
                }
                .draggable(rememberDraggableState { delta -> mapFraction = adjustedMapFraction(mapFraction, delta, contentHeight.toFloat()) }, Orientation.Vertical),
                contentAlignment = Alignment.Center) {
                Box(Modifier.width(44.dp).height(4.dp).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .5f), RoundedCornerShape(2.dp)))
            }
        Column(Modifier.weight(1f - mapFraction).fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
            if (preview != null) PlacePreview(preview, pending = preview.id in state.pendingPlaces, onClose = { closePreview() }, onDetails = { vm.openPlace(preview) })
            else {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                categories.forEach { c -> FilterChip(selected = c.name in state.selectedCategories, onClick = { vm.filter(c.name) },
                    label = { Text(c.name) }, leadingIcon = { Box(Modifier.size(8.dp).background(Color(c.color), RoundedCornerShape(4.dp))) }) }
            }
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("只看还没去的", style = MaterialTheme.typography.bodySmall)
                Switch(checked = state.hideVisited, onCheckedChange = vm::hideVisited, modifier = Modifier.padding(start = 8.dp))
                Spacer(Modifier.weight(1f))
                Box {
                    Tool(Icons.AutoMirrored.Outlined.Sort, state.sort.label) { sortOpen = true }
                    DropdownMenu(expanded = sortOpen, onDismissRequest = { sortOpen = false }) {
                        PlaceSort.entries.forEach { sort -> DropdownMenuItem(text = { Text(sort.label) }, onClick = { vm.sort(sort); sortOpen = false }) }
                    }
                }
                Tool(Icons.Outlined.Refresh, "刷新", !state.loading && !state.busy, vm::reload)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            LazyColumn(Modifier.weight(1f)) {
                item {
                    when {
                        state.loading && state.places.isEmpty() -> EmptyState("正在加载地点…", true)
                        state.loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
                        state.error != null -> EmptyState(state.error, retry = vm::reload)
                        filtered.isEmpty() -> {
                            EmptyState(if (state.places.isEmpty()) "这张地图还没有地点" else "这个筛选下没有地点")
                            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { TextButton(onClick = { vm.navigate(if (state.map == null) Page.MAPS else Page.SEARCH) }) { Text(if (state.map == null) "创建／加入地图" else "搜索添加地点") } }
                        }
                        else -> Text("${filtered.size} 个地点", Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                items(filtered, key = { it.id }) { PlaceRow(it, onClick = { previewPlace(it) }) }
            }
            }
        }
        }
    }
    if (drawCandidates.isNotEmpty()) DrawPlaceDialog(drawCandidates, onDismiss = { drawCandidates = emptyList() }, onPlace = { drawCandidates = emptyList(); previewPlace(it) })
    if (nearby && center != null) AlertDialog(onDismissRequest = { nearby = false }, title = { Text("离我最近") },
        text = { Column {
            val origin = center!!
            state.places.sortedBy { distanceKm(origin.lng, origin.lat, it.lng, it.lat) }.take(5).forEach { p ->
                PlaceRow(p, subtitle = distanceText(distanceKm(origin.lng, origin.lat, p.lng, p.lat)), onClick = { nearby = false; previewPlace(p) })
            }
            if (state.places.isEmpty()) Text("这张地图还没有地点")
        } }, confirmButton = { TextButton(onClick = { nearby = false }) { Text("关闭") } })
}

@Composable private fun PlacePreview(place: Place, pending: Boolean, onClose: () -> Unit, onDetails: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            CategoryIcon(place.category, emoji = place.displayEmoji)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(place.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(place.category + if (place.visited) " · 已去过" else "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Tool(Icons.Outlined.Close, "关闭简介", onClick = onClose)
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("位置", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(place.address.ifBlank { "未填写地址" })
            Text("%.6f, %.6f".format(java.util.Locale.ROOT, place.lng, place.lat), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("备注", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(place.description.ifBlank { "暂无备注" })
        }
        Button(onClick = onDetails, enabled = !pending, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            Text(if (pending) "正在同步…" else "进入详情"); Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null)
        }
    }
}

@Composable private fun MapsScreen(state: ExploreState, vm: ExploreViewModel, confirm: (String, () -> Unit) -> Unit, updates: UpdateViewModel) {
    var form by remember { mutableStateOf<String?>(null) }
    var input by rememberSaveable { mutableStateOf("") }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var exportCode by rememberSaveable { mutableStateOf<String?>(null) }
    val export = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val code = exportCode
        if (uri != null && code != null) scope.launch {
            runCatching { val text = vm.api.export(code); withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } ?: error("无法写入文件") } }
                .onSuccess { vm.notice("备份已导出") }.onFailure { vm.notice("导出失败，请重试") }
        }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { Text("魔都·Explore", Modifier.padding(16.dp), style = MaterialTheme.typography.titleLarge) }
        items(state.maps, key = { it.code }) { map ->
            ListItem(headlineContent = { Text(map.name) }, supportingContent = { Text(map.code) },
                leadingContent = { RadioButton(selected = state.map?.code == map.code, onClick = { vm.switchMap(map) }, enabled = !state.busy) },
                trailingContent = { Tool(Icons.Outlined.Share, "分享邀请码") { shareText(context, "${map.name}\n邀请码：${map.code}\n${vm.api.baseUrl}/?map=${map.code}") } },
                modifier = Modifier.clickable(enabled = !state.busy) { vm.switchMap(map) })
        }
        item {
            if (state.maps.isEmpty()) EmptyState("还没有加入任何地图")
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { input = ""; form = "create" }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Add, null); Text("创建新地图", Modifier.padding(start = 8.dp)) }
                OutlinedButton(onClick = { input = ""; form = "join" }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Key, null); Text("用邀请码加入", Modifier.padding(start = 8.dp)) }
                OutlinedButton(onClick = { vm.switchMap(null) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Public, null); Text("进入公共广场", Modifier.padding(start = 8.dp)) }
            }
            SectionLabel("我的身份")
            ListItem(headlineContent = { Text(state.nickname.ifBlank { "未设置昵称" }) }, trailingContent = { Tool(Icons.Outlined.Edit, "修改昵称", !state.busy) { input = state.nickname; form = "nickname" } })
            if (state.map != null) {
                SectionLabel("地图管理 · ${state.map.name}")
                MenuRow("修改地图名称", Icons.Outlined.Edit, !state.busy) { input = state.map.name; form = "rename" }
                MenuRow("回收站", Icons.Outlined.DeleteOutline, !state.busy) { vm.navigate(Page.TRASH) }
                MenuRow("分享海报", Icons.Outlined.Image, !state.busy && !state.loading && state.error == null) { vm.navigate(Page.POSTER) }
                MenuRow("导出地图备份", Icons.Outlined.Download, !state.busy) { exportCode = state.map.code; export.launch("Explore-${state.map.code}.json") }
                MenuRow("更换邀请码", Icons.Outlined.Key, !state.busy) { confirm("旧邀请码将立即失效，其他成员需要重新输入新码加入。", vm::rekey) }
                MenuRow("删除地图", Icons.Outlined.DeleteForever, !state.busy) { confirm("删除「${state.map.name}」及所有地点、照片和留言？此操作无法恢复。", vm::deleteMap) }
            }
            SectionLabel("位置服务")
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("高德地图授权", Modifier.weight(1f)); Switch(state.mapConsent, onCheckedChange = { if (!it) vm.revokeConsent() else vm.notice("请返回首页点击开启地图") })
            }
            SectionLabel("应用")
            MenuRow("检查更新 · ${BuildConfig.VERSION_NAME} ${channelLabel(BuildConfig.RELEASE_CHANNEL)}", Icons.Outlined.SystemUpdateAlt) { updates.check() }
            MenuRow("更新日志", Icons.Outlined.History) { vm.navigate(Page.CHANGELOG); updates.loadHistory() }
        }
    }
    form?.let { mode -> AlertDialog(onDismissRequest = { form = null }, title = { Text(when (mode) { "create" -> "创建新地图"; "join" -> "加入地图"; "rename" -> "修改名称"; else -> "修改昵称" }) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(input, { input = it.take(if (mode == "join") 6 else if (mode == "nickname") 30 else 40) }, label = { Text(when (mode) { "join" -> "6 位邀请码"; "nickname" -> "昵称"; else -> "地图名称" }) }, singleLine = true)
            if (mode == "create" && state.nickname.isBlank()) Text("创建前请先设置昵称", color = MaterialTheme.colorScheme.error)
        } }, confirmButton = { TextButton(enabled = input.isNotBlank() && !state.busy && (mode != "create" || state.nickname.isNotBlank()), onClick = {
            when (mode) { "create" -> vm.createMap(input); "join" -> vm.joinMap(input); "rename" -> vm.rename(input); else -> vm.nickname(input) }; form = null
        }) { Text("确定") } }, dismissButton = { TextButton(onClick = { form = null }) { Text("取消") } }) }
}
@Composable fun SectionLabel(text: String) {
    Text(text, Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
}
@Composable fun MenuRow(text: String, icon: ImageVector, enabled: Boolean = true, action: () -> Unit) {
    ListItem(headlineContent = { Text(text, color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant) },
        leadingContent = { Icon(icon, null) }, trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) }, modifier = Modifier.clickable(enabled = enabled, onClick = action))
}
