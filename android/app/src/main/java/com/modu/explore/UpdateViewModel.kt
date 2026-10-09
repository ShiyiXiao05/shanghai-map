package com.modu.explore

import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.modu.explore.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.decodeFromString
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class UpdateState(
    val open: Boolean = false, val checking: Boolean = false, val downloading: Boolean = false,
    val progress: Int? = null, val info: UpdateInfo? = null, val apk: File? = null, val error: String? = null,
    val previewEnabled: Boolean = false, val history: List<UpdateInfo> = emptyList(),
    val historyLoading: Boolean = false, val historyError: String? = null, val stablePublished: Boolean = false
)

class UpdateViewModel(application: Application) : AndroidViewModel(application) {
    private val sessions = SessionStore(application)
    private var catalog: UpdateCatalog? = sessions.updates()
    private val mutable = MutableStateFlow(UpdateState(previewEnabled = sessions.previewUpdates,
        history = catalog?.history(BuildConfig.APPLICATION_ID, sessions.previewUpdates).orEmpty()))
    val state = mutable.asStateFlow()
    private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false).build()
    private var job: Job? = null
    @Volatile private var downloadCall: okhttp3.Call? = null
    private var lastCheck = 0L
    private var dismissedDuringCheck = false

    fun check(quiet: Boolean = false) {
        if (mutable.value.checking || mutable.value.downloading) { if (!quiet) { dismissedDuringCheck = false; mutable.update { it.copy(open = true) } }; return }
        val now = android.os.SystemClock.elapsedRealtime()
        if (quiet && lastCheck != 0L && now - lastCheck < 30 * 60_000) return
        lastCheck = now
        dismissedDuringCheck = false
        mutable.update { it.copy(open = !quiet, checking = true, error = null, apk = null, info = null) }
        job = viewModelScope.launch {
            try {
                val next = fetchCatalog()
                catalog = next
                sessions.saveUpdates(next)
                val newer = next.latest(BuildConfig.APPLICATION_ID, BuildConfig.VERSION_CODE, mutable.value.previewEnabled)
                mutable.update { it.copy(checking = false, open = it.open || (quiet && newer != null && !dismissedDuringCheck), info = newer,
                    history = next.history(BuildConfig.APPLICATION_ID, it.previewEnabled), historyError = null,
                    stablePublished = next.releases.any { release -> release.packageName == BuildConfig.APPLICATION_ID && release.channel == "stable" && release.isValid() }) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(checking = false, error = error.message ?: "检查更新失败，请重试") }
            }
        }
    }

    private suspend fun fetchCatalog(): UpdateCatalog = withContext(Dispatchers.IO) {
        suspend fun fetch(url: String): String {
            require(java.net.URI(url).scheme == "https") { "更新地址必须使用 HTTPS" }
            return client.newCall(Request.Builder().url(url).header("Cache-Control", "no-cache").build()).awaitResponse().use { response ->
                if (!response.isSuccessful) throw ApiException(response.code, if (response.code == 404) "更新服务尚未发布，请稍后再试" else "检查更新失败（${response.code}）")
                require(response.request.url.isHttps) { "更新服务跳转到了非 HTTPS 地址" }
                val source = (response.body ?: throw IOException("更新信息为空")).source()
                source.request(512 * 1024 + 1L)
                val bytes = source.buffer.readByteArray()
                require(bytes.size <= 512 * 1024) { "更新信息过大" }
                bytes.toString(Charsets.UTF_8)
            }
        }
        val historyUrl = java.net.URI(BuildConfig.UPDATE_MANIFEST_URL).resolve("releases.json").toString()
        try { wireJson.decodeFromString<UpdateCatalog>(fetch(historyUrl)) }
        catch (error: ApiException) {
            if (error.status != 404) throw error
            val latest = wireJson.decodeFromString<UpdateInfo>(fetch(BuildConfig.UPDATE_MANIFEST_URL))
            UpdateCatalog((listOf(latest) + sessions.updates()?.releases.orEmpty()).distinctBy { it.versionCode })
        }
    }

    fun previewUpdates(enabled: Boolean) {
        if (mutable.value.downloading) return
        job?.cancel()
        sessions.previewUpdates = enabled
        mutable.update { it.copy(previewEnabled = enabled, checking = false, info = null, apk = null,
            history = catalog?.history(BuildConfig.APPLICATION_ID, enabled).orEmpty()) }
        check()
    }

    fun loadHistory() {
        if (mutable.value.historyLoading) return
        mutable.update { it.copy(historyLoading = true, historyError = null) }
        viewModelScope.launch {
            try {
                val next = fetchCatalog(); catalog = next
                sessions.saveUpdates(next)
                mutable.update { it.copy(historyLoading = false, history = next.history(BuildConfig.APPLICATION_ID, it.previewEnabled)) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                mutable.update { it.copy(historyLoading = false, historyError = error.message ?: "更新日志加载失败") }
            }
        }
    }

    fun download() {
        val info = mutable.value.info ?: return
        if (mutable.value.downloading) return
        mutable.value = mutable.value.copy(downloading = true, progress = null, error = null, apk = null)
        job = viewModelScope.launch {
            try {
                val apk = withContext(Dispatchers.IO) {
                    val directory = File(getApplication<Application>().cacheDir, "updates").apply { mkdirs() }
                    val file = File(directory, "explore-${info.versionCode}.apk")
                    val partial = File(directory, "download.part")
                    try {
                        val call = client.newCall(Request.Builder().url(info.apkUrl).build())
                        downloadCall = call
                        currentCoroutineContext().ensureActive()
                        call.awaitResponse().use { response ->
                            if (!response.isSuccessful) throw IOException("下载失败（${response.code}）")
                            require(response.request.url.isHttps) { "下载跳转到了非 HTTPS 地址" }
                            val body = response.body ?: throw IOException("下载文件为空")
                            val length = body.contentLength()
                            val limit = 250L * 1024 * 1024
                            require(length <= limit) { "更新包过大" }
                            val digest = MessageDigest.getInstance("SHA-256")
                            body.byteStream().use { input -> partial.outputStream().use { output ->
                                val buffer = ByteArray(64 * 1024)
                                var total = 0L
                                while (true) {
                                    currentCoroutineContext().ensureActive()
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    total += count
                                    require(total <= limit) { "更新包过大" }
                                    output.write(buffer, 0, count); digest.update(buffer, 0, count)
                                    val progress = if (length > 0) (total * 100 / length).toInt().coerceIn(0, 100) else null
                                    mutable.update { it.copy(progress = progress) }
                                }
                            } }
                            val actual = digest.digest().joinToString("") { "%02x".format(it) }
                            require(actual.equals(info.sha256, ignoreCase = true)) { "文件校验失败，请重新下载" }
                        }
                        validateUpdateApk(getApplication(), partial, info)
                        file.delete()
                        require(partial.renameTo(file)) { "无法保存更新包" }
                        file
                    } finally { partial.delete(); downloadCall = null }
                }
                mutable.value = mutable.value.copy(downloading = false, progress = 100, apk = apk)
            } catch (error: Exception) {
                if (error is CancellationException) { mutable.update { it.copy(downloading = false, progress = null) }; throw error }
                mutable.value = mutable.value.copy(downloading = false, error = error.message ?: "下载失败，请重试")
            }
        }
    }

    fun dismiss() { dismissedDuringCheck = true; mutable.update { it.copy(open = false) } }
    fun cancelDownload() { job?.cancel(); downloadCall?.cancel() }
    fun installIntent(): Intent? {
        val app = getApplication<Application>()
        val file = mutable.value.apk ?: return null
        return try {
            validateUpdateApk(app, file, mutable.value.info ?: return null)
            if (!app.packageManager.canRequestPackageInstalls()) Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:${app.packageName}"))
            else Intent(Intent.ACTION_VIEW).setDataAndType(FileProvider.getUriForFile(app, "${app.packageName}.updates", file), "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (error: Exception) { mutable.value = mutable.value.copy(error = error.message ?: "无法打开安装程序", apk = null); null }
    }
}

@Suppress("DEPRECATION")
fun validateUpdateApk(context: android.content.Context, file: File, info: UpdateInfo) {
    val manager = context.packageManager
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val archive = manager.getPackageArchiveInfo(file.absolutePath, flags) ?: error("更新包格式无效")
    val current = manager.getPackageInfo(context.packageName, flags)
    val archiveVersion = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
    val currentVersion = if (Build.VERSION.SDK_INT >= 28) current.longVersionCode else current.versionCode.toLong()
    require(archive.packageName == context.packageName && archive.packageName == info.packageName && archiveVersion == info.versionCode.toLong() && archiveVersion > currentVersion) { "更新包的应用或版本不匹配" }
    fun signatures(p: android.content.pm.PackageInfo) = (if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners else p.signatures)
        .orEmpty().map { it.toCharsString() }.toSet()
    val installed = signatures(current)
    require(installed.isNotEmpty() && installed == signatures(archive)) { "更新包签名不同，无法覆盖安装" }
}
