package com.modu.explore.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.modu.explore.*
import com.modu.explore.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable fun DetailScreen(state: ExploreState, vm: ExploreViewModel, confirm: (String, () -> Unit) -> Unit) {
    val place = state.selected ?: run { EmptyState("地点不存在，请返回刷新"); return }
    val context = LocalContext.current
    var comment by rememberSaveable(place.id) { mutableStateOf("") }
    var preview by remember { mutableStateOf<String?>(null) }
    var report by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let(vm::upload) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Box(Modifier.fillMaxWidth().height(4.dp).background(Color(category(place.category).color)))
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(place.name, style = MaterialTheme.typography.headlineSmall)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CategoryIcon(place.category); Text(place.category, color = Color(category(place.category).color))
                    if (place.visited) Text("已去过", color = MaterialTheme.colorScheme.primary)
                }
                if (place.addedBy.isNotBlank()) Text("${place.addedBy} 标记", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (place.address.isNotBlank()) Text(place.address, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("坐标：%.6f, %.6f".format(java.util.Locale.ROOT, place.lng, place.lat), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (place.createdAt.isNotBlank()) Text("添加时间：${place.createdAt.take(10)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                place.visitedAt?.takeIf { it.isNotBlank() }?.let { Text("打卡时间：${it.take(10)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (place.description.isNotBlank()) Text(place.description)
                listOf(place.priceHint, place.hours, place.tags).filter { it.isNotBlank() }.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                if (place.wishes.isNotEmpty()) Text("${place.wishes.size} 人想去 · ${place.wishes.joinToString("、")}", style = MaterialTheme.typography.bodySmall)
            }
            if (state.map != null) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
                Tool(if (place.visited) Icons.AutoMirrored.Outlined.Undo else Icons.Outlined.CheckCircle, if (place.visited) "取消打卡" else "打卡", !state.busy) { vm.placeAction("visited") }
                Tool(if (state.nickname in place.wishes) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, "想去", !state.busy) { vm.placeAction("wish") }
                Tool(if (place.isPublic) Icons.Outlined.Public else Icons.Outlined.PublicOff, if (place.isPublic) "取消公开" else "公开", !state.busy) {
                    if (place.isPublic) vm.placeAction("public") else confirm("公开后地点名称、位置和描述将出现在公共广场，所有人都可以查看。", { vm.placeAction("public") })
                }
                Tool(Icons.Outlined.Edit, "编辑", !state.busy, vm::startEdit)
                Tool(Icons.Outlined.DeleteOutline, "删除", !state.busy) { confirm("删除「${place.name}」？30 天内可从回收站恢复。", { vm.placeAction("delete") }) }
            }
            MenuRow("高德地图导航", Icons.Outlined.Navigation) { openUrl(context, placeNavUrl(place)) }
            if (state.map == null) Text("来自公共广场 · 只读", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else {
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("照片 ${state.photos.size}/9", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    Tool(Icons.Outlined.AddPhotoAlternate, "添加照片", !state.busy && !state.detailLoading && state.detailError == null && state.photos.size < 9) { picker.launch("image/*") }
                }
                if (state.detailLoading) EmptyState("正在加载照片和留言…", true)
                if (state.detailError != null) EmptyState(state.detailError, retry = vm::loadDetail)
                state.photos.chunked(3).forEach { group ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        group.forEach { photo ->
                            Box(Modifier.weight(1f).aspectRatio(1f)) {
                                AsyncImage(imageModel(photo.thumb), "地点照片", contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize().clickable { preview = photo.full ?: vm.api.photoUrl(state.map.code, photo.id) })
                                Surface(Modifier.align(Alignment.TopEnd), color = MaterialTheme.colorScheme.surface.copy(alpha = .85f)) {
                                    Tool(Icons.Outlined.Close, "删除照片", !state.busy) { confirm("删除这张照片？", { vm.removePhoto(photo.id) }) }
                                }
                            }
                        }
                        repeat(3 - group.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
                if (!state.detailLoading && state.detailError == null && state.photos.isEmpty()) Text("还没有照片", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                SectionLabel("留言 ${state.comments.size}")
            }
        }
        if (state.map != null) {
            items(state.comments, key = { it.id }) { c ->
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(c.author.ifBlank { "同学" }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(c.body); if (c.createdAt.isNotBlank()) Text(c.createdAt.take(10), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Tool(Icons.Outlined.Close, "删除留言", !state.busy) { confirm("删除这条留言？", { vm.removeComment(c.id) }) }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(comment, { comment = it.take(280) }, placeholder = { Text("说点什么…") }, modifier = Modifier.weight(1f), enabled = !state.busy, maxLines = 4)
                    Tool(Icons.AutoMirrored.Outlined.Send, "发送留言", !state.busy && comment.isNotBlank()) { vm.addComment(comment) { comment = "" } }
                }
            }
        }
        item { TextButton(onClick = { report = true }, enabled = !state.busy, modifier = Modifier.padding(horizontal = 8.dp)) { Text("举报该内容", color = MaterialTheme.colorScheme.onSurfaceVariant) } }
    }
    preview?.let { source -> Dialog(onDismissRequest = { preview = null }) {
        Surface { Column {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { Tool(Icons.Outlined.Close, "关闭照片") { preview = null } }
            AsyncImage(imageModel(source), "照片原图", modifier = Modifier.fillMaxWidth().heightIn(max = 520.dp), contentScale = ContentScale.Fit)
        } }
    } }
    if (report) AlertDialog(onDismissRequest = { report = false }, title = { Text("举报原因") }, text = { Column {
        listOf("违法违规", "色情低俗", "广告骚扰", "侵犯隐私", "其他问题").forEach { reason -> TextButton(onClick = { vm.report(reason); report = false }) { Text(reason) } }
    } }, confirmButton = { TextButton(onClick = { report = false }) { Text("取消") } })
}

@Composable fun EditScreen(state: ExploreState, vm: ExploreViewModel) {
    val point = state.draft ?: return
    val p = state.selected
    var name by rememberSaveable(point, p?.id) { mutableStateOf(point.name) }
    var address by rememberSaveable(point, p?.id) { mutableStateOf(point.address) }
    var description by rememberSaveable(point, p?.id) { mutableStateOf(p?.description.orEmpty()) }
    var category by rememberSaveable(point, p?.id) { mutableStateOf(p?.category ?: "景点") }
    var price by rememberSaveable(point, p?.id) { mutableStateOf(p?.priceHint.orEmpty()) }
    var hours by rememberSaveable(point, p?.id) { mutableStateOf(p?.hours.orEmpty()) }
    var tags by rememberSaveable(point, p?.id) { mutableStateOf(p?.tags.orEmpty()) }
    var categoryMenu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        EditField("名称", name, 100, !state.busy) { name = it }
        Box {
            OutlinedButton(onClick = { categoryMenu = true }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) { Text(category); Icon(Icons.Outlined.ExpandMore, null) }
            DropdownMenu(categoryMenu, { categoryMenu = false }) { categories.forEach { c -> DropdownMenuItem(text = { Text(c.name) }, onClick = { category = c.name; categoryMenu = false }) } }
        }
        EditField("描述", description, 500, !state.busy, singleLine = false) { description = it }
        EditField("地址", address, 200, !state.busy) { address = it }
        EditField("人均", price, 50, !state.busy) { price = it }
        EditField("营业时间", hours, 100, !state.busy) { hours = it }
        EditField("标签", tags, 100, !state.busy) { tags = it }
        Text("署名：${state.nickname.ifBlank { "未设置昵称" }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.nickname.isBlank()) TextButton(onClick = { vm.navigate(Page.MAPS) }) { Text("设置昵称") }
        Button(enabled = !state.busy && name.isNotBlank() && state.nickname.isNotBlank(), onClick = {
            vm.savePlace(buildJsonObject {
                put("name", name.trim()); put("category", category); put("address", address.trim()); put("description", description.trim())
                put("lng", point.lng); put("lat", point.lat); put("price_hint", price.trim()); put("hours", hours.trim()); put("tags", tags.trim())
            })
        }, modifier = Modifier.fillMaxWidth()) { Text("保存地点") }
    }
}
@Composable fun EditField(label: String, value: String, limit: Int, enabled: Boolean = true, singleLine: Boolean = true, onChange: (String) -> Unit) {
    OutlinedTextField(value, { onChange(it.take(limit)) }, label = { Text(label) }, enabled = enabled, singleLine = singleLine,
        minLines = if (singleLine) 1 else 3, maxLines = if (singleLine) 1 else 6, modifier = Modifier.fillMaxWidth())
}

@Composable fun SearchScreen(state: ExploreState, vm: ExploreViewModel, onConsent: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var shared by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<PickedPoint>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var searched by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var manual by remember { mutableStateOf(false) }
    var manualName by rememberSaveable { mutableStateOf("") }
    var lng by rememberSaveable { mutableStateOf("") }
    var lat by rememberSaveable { mutableStateOf("") }
    val context = LocalContext.current; val scope = rememberCoroutineScope()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(query, { query = it.take(100) }, label = { Text("搜索上海地点") }, singleLine = true, modifier = Modifier.weight(1f))
                Tool(Icons.Outlined.Search, "搜索", !searching && query.isNotBlank()) {
                    when {
                        BuildConfig.AMAP_KEY.isBlank() -> error = "地图尚未配置，可先粘贴高德位置链接导入"
                        !state.mapConsent -> onConsent()
                        else -> scope.launch {
                            searching = true; error = null; results = emptyList()
                            try { results = searchPlaces(context, query.trim()); searched = true }
                            catch (failure: Exception) { if (failure is CancellationException) throw failure; error = failure.message }
                            finally { searching = false }
                        }
                    }
                }
            }
            if (searching) EmptyState("正在搜索…", true)
            error?.let { Text(it, Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.error) }
            if (searched && !searching && results.isEmpty() && error == null) EmptyState("没有找到相关地点")
        }
        items(results) { p -> ListItem(headlineContent = { Text(p.name) }, supportingContent = { Text(p.address) }, leadingContent = { Icon(Icons.Outlined.Place, null) }, modifier = Modifier.clickable { vm.startAdd(p) }) }
        item {
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            SectionLabel("高德分享导入")
            OutlinedTextField(shared, { shared = it.take(2000) }, label = { Text("粘贴位置链接或分享文本") }, minLines = 3, maxLines = 6, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = { val point = parseSharedPoint(shared); if (point != null) vm.startAdd(point) else vm.notice("没有识别到坐标，请使用带位置坐标的分享链接") }, enabled = shared.isNotBlank(), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("导入地点") }
            TextButton(onClick = { manual = !manual }) { Text("手动输入位置") }
            if (manual) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                EditField("地点名称", manualName, 100) { manualName = it }
                EditField("经度（GCJ-02）", lng, 20) { lng = it }
                EditField("纬度（GCJ-02）", lat, 20) { lat = it }
                Button(onClick = {
                    val x = lng.toDoubleOrNull(); val y = lat.toDoubleOrNull()
                    if (x == null || y == null || !x.isFinite() || !y.isFinite() || x !in -180.0..180.0 || y !in -90.0..90.0) vm.notice("请输入有效经纬度")
                    else vm.startAdd(PickedPoint(manualName.trim(), "", x, y))
                }, enabled = manualName.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("使用这个位置") }
            }
        }
    }
}
