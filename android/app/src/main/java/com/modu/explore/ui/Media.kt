package com.modu.explore.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Matrix
import android.net.Uri
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import com.modu.explore.data.ExploreMap
import com.modu.explore.data.Place
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

private fun scaled(bitmap: Bitmap, maxSide: Int): Bitmap {
    val scale = (maxSide.toDouble() / maxOf(bitmap.width, bitmap.height)).coerceAtMost(1.0)
    return Bitmap.createScaledBitmap(bitmap, maxOf(1, (bitmap.width * scale).roundToInt()), maxOf(1, (bitmap.height * scale).roundToInt()), true)
}
private fun jpegBudget(bitmap: Bitmap, budget: Int): ByteArray {
    var image = bitmap
    try {
        while (true) {
            for (quality in listOf(85, 70, 55, 40)) {
                val bytes = ByteArrayOutputStream().use { output -> image.compress(Bitmap.CompressFormat.JPEG, quality, output); output.toByteArray() }
                if (bytes.size <= budget) return bytes
            }
            val next = scaled(image, (maxOf(image.width, image.height) * 0.75).roundToInt())
            if (next === image) error("图片无法压缩到上传大小")
            if (image !== bitmap) image.recycle()
            image = next
        }
    } finally { if (image !== bitmap) image.recycle() }
}
suspend fun compressPhoto(context: Context, uri: Uri): Pair<String, String> = withContext(Dispatchers.IO) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "无法读取这张照片" }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2400) sample *= 2
    val bitmap = context.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: error("无法读取这张照片")
    val orientation = runCatching { context.contentResolver.openInputStream(uri)?.use {
        ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    } }.getOrNull()
    val matrix = Matrix().apply {
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { postRotate(90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { postRotate(270f); postScale(-1f, 1f) }
        }
    }
    val oriented = if (matrix.isIdentity) bitmap else Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    val full = scaled(oriented, 1600); val thumb = scaled(oriented, 360)
    fun url(bytes: ByteArray) = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    try { url(jpegBudget(full, 1_500_000)) to url(jpegBudget(thumb, 60_000)) }
    finally { if (full !== oriented) full.recycle(); if (thumb !== oriented && thumb !== full) thumb.recycle(); if (oriented !== bitmap) oriented.recycle(); bitmap.recycle() }
}
fun imageModel(source: String?): Any? = if (source?.startsWith("data:image/") == true)
    runCatching { Base64.decode(source.substringAfter(','), Base64.DEFAULT) }.getOrNull() else source

fun shareText(context: Context, text: String) {
    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, "分享"))
}
fun openUrl(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
}
fun placeNavUrl(place: Place) = "https://uri.amap.com/marker?position=${place.lng},${place.lat}&name=${Uri.encode(place.name)}&coordinate=gaode&callnative=1"
fun itineraryNavUrl(stops: List<Place>): String {
    fun point(p: Place) = "${p.lng},${p.lat},${Uri.encode(p.name)}"
    return "https://uri.amap.com/navigation?from=${point(stops.first())}&to=${point(stops.last())}" +
        (if (stops.size > 2) "&via=${stops.drop(1).dropLast(1).joinToString(";") { point(it) }}" else "") + "&mode=walk&coordinate=gaode&callnative=1&src=moduExplore"
}
fun poster(map: ExploreMap, places: List<Place>): Bitmap {
    val bitmap = Bitmap.createBitmap(1080, 1440, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap); canvas.drawColor(Color.rgb(10, 15, 30))
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    paint.textSize = 36f; canvas.drawText("魔都 · Explore", 80f, 120f, paint)
    paint.textSize = 68f; paint.isFakeBoldText = true
    var title = map.name
    val lines = mutableListOf<String>()
    while (title.isNotEmpty() && lines.size < 4) {
        val count = paint.breakText(title, true, 920f, null).coerceAtLeast(1)
        lines += title.take(count); title = title.drop(count)
    }
    lines.forEachIndexed { i, line -> canvas.drawText(line, 80f, 260f + i * 90, paint) }
    paint.color = Color.rgb(34, 211, 238); paint.textSize = 110f
    canvas.drawText(places.size.toString(), 80f, 730f, paint)
    paint.color = Color.WHITE; paint.textSize = 38f; paint.isFakeBoldText = false
    canvas.drawText("个想去的上海角落", 80f, 795f, paint)
    canvas.drawText("${places.count { it.visited }} 个已打卡  ·  ${places.sumOf { it.wishes.size }} 次想去", 80f, 900f, paint)
    paint.color = Color.rgb(255, 61, 129); paint.textSize = 32f
    canvas.drawText("一起探索这座城市", 80f, 1110f, paint)
    paint.color = Color.WHITE; paint.textSize = 86f; paint.isFakeBoldText = true
    canvas.drawText(map.code, 80f, 1240f, paint)
    paint.textSize = 30f; paint.isFakeBoldText = false
    canvas.drawText("邀请码", 80f, 1320f, paint)
    return bitmap
}
