package com.modu.explore.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Color
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.amap.api.maps.*
import com.amap.api.maps.model.*
import com.amap.api.location.AMapLocationClient
import com.amap.api.location.AMapLocationClientOption
import com.amap.api.services.core.ServiceSettings
import com.amap.api.services.poisearch.PoiSearchV2
import com.amap.api.services.poisearch.PoiResultV2
import com.amap.api.services.core.PoiItemV2
import com.modu.explore.BuildConfig
import com.modu.explore.data.*
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.flow.first
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

fun initializeMaps(context: android.content.Context) {
    MapsInitializer.updatePrivacyShow(context, true, true)
    MapsInitializer.updatePrivacyAgree(context, true)
    ServiceSettings.updatePrivacyShow(context, true, true)
    ServiceSettings.updatePrivacyAgree(context, true)
    ServiceSettings.getInstance().setApiKey(BuildConfig.AMAP_KEY)
    AMapLocationClient.updatePrivacyShow(context, true, true)
    AMapLocationClient.updatePrivacyAgree(context, true)
    AMapLocationClient.setApiKey(BuildConfig.AMAP_KEY)
}

@Composable fun NativeMap(
    places: List<Place>, consent: Boolean, dark: Boolean, modifier: Modifier = Modifier,
    center: PickedPoint? = null, onConsent: () -> Unit,
    onPlace: (Place) -> Unit, onPick: ((PickedPoint) -> Unit)? = null,
    selectedId: Long? = null, fitRequest: Int = 0, mapIdentity: String? = null, onMapClick: () -> Unit = {}
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    if (BuildConfig.AMAP_KEY.isBlank()) {
        Box(modifier, contentAlignment = androidx.compose.ui.Alignment.Center) {
            Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                Text("地图暂未配置", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text("地点列表可正常使用", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        return
    }
    if (!consent) {
        Box(modifier, contentAlignment = androidx.compose.ui.Alignment.Center) {
            Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                Text("地图与位置服务", style = MaterialTheme.typography.titleMedium)
                Button(onClick = onConsent) { Text("开启地图") }
            }
        }
        return
    }
    val onPlaceCurrent by rememberUpdatedState(onPlace)
    val onPickCurrent by rememberUpdatedState(onPick)
    val placesCurrent by rememberUpdatedState(places)
    val onMapClickCurrent by rememberUpdatedState(onMapClick)
    val view = remember(context) { initializeMaps(context); MapView(context).apply { onCreate(Bundle()) } }
    var loaded by remember(view) { mutableStateOf(false) }
    var size by remember(view) { mutableStateOf(IntSize.Zero) }
    val density = context.resources.displayMetrics.density
    val icons = remember(view) { mutableMapOf<Triple<String, Boolean, Boolean>, BitmapDescriptor>() }
    DisposableEffect(view, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) { Lifecycle.Event.ON_RESUME -> view.onResume(); Lifecycle.Event.ON_PAUSE -> view.onPause(); else -> Unit }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.onResume()
        view.map.apply {
            uiSettings.isZoomControlsEnabled = false
            uiSettings.isRotateGesturesEnabled = false
            moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(31.2304, 121.4737), 12f))
            setOnMarkerClickListener { marker ->
                placesCurrent.find { it.id == marker.`object` }?.let(onPlaceCurrent)
                true
            }
            setOnMapLongClickListener { point -> onPickCurrent?.invoke(PickedPoint("", "", point.longitude, point.latitude)) }
            setOnMapClickListener { onMapClickCurrent() }
            setOnMapLoadedListener { loaded = true }
        }
        onDispose { lifecycle.removeObserver(observer); view.onPause(); view.onDestroy(); icons.values.forEach { it.recycle() }; icons.clear() }
    }
    LaunchedEffect(loaded, places, dark, selectedId) {
        if (!loaded) return@LaunchedEffect
        view.map.apply {
            clear(); mapType = if (dark) AMap.MAP_TYPE_NIGHT else AMap.MAP_TYPE_NORMAL
            places.filter { it.lat.isFinite() && it.lng.isFinite() && it.lat in -90.0..90.0 && it.lng in -180.0..180.0 }.forEach { p ->
                val key = Triple(p.category, p.visited, p.id == selectedId)
                val icon = icons.getOrPut(key) { BitmapDescriptorFactory.fromBitmap(placeMarkerBitmap(p.category, p.visited, p.id == selectedId, density)) }
                addMarker(MarkerOptions().position(LatLng(p.lat, p.lng)).title(p.name)
                    .anchor(.5f, 1f).zIndex(if (p.id == selectedId) 10f else 1f).icon(icon)).`object` = p.id
            }
        }
    }
    val coordinates = places.filter { it.lat.isFinite() && it.lng.isFinite() && it.lat in -90.0..90.0 && it.lng in -180.0..180.0 }.map { it.lng to it.lat }.distinct()
    LaunchedEffect(loaded, coordinates, mapIdentity, fitRequest) {
        if (!loaded || coordinates.isEmpty() || center != null) return@LaunchedEffect
        val dimensions = snapshotFlow { size }.first { it.width > 0 && it.height > 0 }
                if (coordinates.size == 1) view.map.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(coordinates[0].second, coordinates[0].first), 15f))
                else {
                    val bounds = LatLngBounds.builder()
                    coordinates.forEach { (lng, lat) -> bounds.include(LatLng(lat, lng)) }
                    view.map.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), dimensions.width, dimensions.height, (48 * density).toInt()))
                }
    }
    LaunchedEffect(loaded, center) { if (loaded) center?.let { view.map.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.lat, it.lng), 15f)) } }
    AndroidView(factory = { view }, modifier = modifier.onSizeChanged { size = it })
}

fun placeMarkerBitmap(categoryName: String, visited: Boolean, selected: Boolean, density: Float): Bitmap {
    val scale = density.coerceAtLeast(1f)
    val bitmap = Bitmap.createBitmap((48 * scale).toInt(), (58 * scale).toInt(), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap).apply { scale(scale, scale) }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val path = Path().apply { moveTo(16f, 38f); lineTo(24f, 54f); lineTo(32f, 38f); close() }
    paint.color = Color.rgb(30, 45, 42)
    canvas.drawPath(path, paint); canvas.drawCircle(24f, 24f, if (selected) 23f else 21f, paint)
    paint.color = Color.WHITE; canvas.drawCircle(24f, 24f, 19f, paint)
    paint.color = if (categoryName == "美食") Color.rgb(187, 63, 13) else category(categoryName).color.toInt()
    canvas.drawCircle(24f, 24f, 15f, paint)
    paint.color = Color.WHITE; paint.textSize = 18f; paint.textAlign = Paint.Align.CENTER; paint.isFakeBoldText = true
    canvas.drawText(when (categoryName) { "美食" -> "食"; "展馆" -> "展"; "购物" -> "购"; "娱乐" -> "娱"; "其他" -> "点"; else -> "景" }, 24f, 30f, paint)
    if (visited) {
        paint.color = Color.WHITE; canvas.drawCircle(39f, 9f, 8f, paint)
        paint.color = Color.rgb(30, 45, 42); paint.style = Paint.Style.STROKE; paint.strokeWidth = 2f
        canvas.drawCircle(39f, 9f, 8f, paint)
        canvas.drawPath(Path().apply { moveTo(35f, 9f); lineTo(38f, 12f); lineTo(43f, 6f) }, paint)
    }
    return bitmap
}

suspend fun searchPlaces(context: android.content.Context, text: String): List<PickedPoint> = suspendCancellableCoroutine { continuation ->
    initializeMaps(context)
    val query = PoiSearchV2.Query(text, "", "上海").apply { pageSize = 20; pageNum = 0; cityLimit = true }
    val search = PoiSearchV2(context, query)
    search.setOnPoiSearchListener(object : PoiSearchV2.OnPoiSearchListener {
        override fun onPoiSearched(result: PoiResultV2?, code: Int) {
            if (!continuation.isActive) return
            if (code != 1000) { continuation.resumeWithException(IllegalStateException("地点搜索失败（$code）")); return }
            continuation.resume(result?.pois.orEmpty().map { PickedPoint(it.title, it.snippet.orEmpty(), it.latLonPoint.longitude, it.latLonPoint.latitude) })
        }
        override fun onPoiItemSearched(item: PoiItemV2?, code: Int) = Unit
    })
    search.searchPOIAsyn()
}

@Composable fun rememberLocate(consent: Boolean, onConsent: () -> Unit, onResult: (PickedPoint) -> Unit, onError: (String) -> Unit): () -> Unit {
    val context = LocalContext.current
    var client by remember { mutableStateOf<AMapLocationClient?>(null) }
    val resultCurrent by rememberUpdatedState(onResult)
    val errorCurrent by rememberUpdatedState(onError)
    fun locate() {
        runCatching {
            initializeMaps(context)
            client?.onDestroy()
            client = AMapLocationClient(context).apply {
                setLocationOption(AMapLocationClientOption().apply { isOnceLocation = true; httpTimeOut = 15000 })
                setLocationListener { location ->
                    if (location.errorCode == 0) resultCurrent(PickedPoint("当前位置", location.address.orEmpty(), location.longitude, location.latitude))
                    else errorCurrent("定位失败（${location.errorCode}），请检查位置服务")
                    stopLocation()
                }
                startLocation()
            }
        }.onFailure { errorCurrent("定位失败，请稍后重试") }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) locate() else errorCurrent("未获得位置权限，可在系统设置中开启")
    }
    DisposableEffect(Unit) { onDispose { client?.onDestroy() } }
    return {
        when {
            BuildConfig.AMAP_KEY.isBlank() -> onError("地图尚未配置，定位暂不可用")
            !consent -> onConsent()
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED -> locate()
            else -> permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }
}
