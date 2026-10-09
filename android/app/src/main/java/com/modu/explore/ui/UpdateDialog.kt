package com.modu.explore.ui

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.modu.explore.UpdateViewModel
import com.modu.explore.BuildConfig
import com.modu.explore.data.channelLabel

@Composable fun UpdateDialog(vm: UpdateViewModel, onHistory: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var launchError by remember { mutableStateOf<String?>(null) }
    fun launchInstaller(intent: Intent) {
        runCatching { context.startActivity(intent) }.onFailure { launchError = "无法打开系统安装程序，请检查系统设置" }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (context.packageManager.canRequestPackageInstalls()) vm.installIntent()?.let(::launchInstaller)
        else launchError = "尚未允许此应用安装更新，可点击安装后在系统设置中开启"
    }
    if (!state.open) return
    AlertDialog(onDismissRequest = vm::dismiss, title = { Text(if (state.info == null) "检查更新" else "${state.info!!.versionName} ${channelLabel(state.info!!.channel)}") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("当前 ${BuildConfig.VERSION_NAME} · ${channelLabel(BuildConfig.RELEASE_CHANNEL)}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text("体验版更新", Modifier.weight(1f))
                Switch(state.previewEnabled, vm::previewUpdates, enabled = !state.downloading)
            }
            when {
                state.checking -> { CircularProgressIndicator(Modifier.size(28.dp)); Text("正在检查更新…") }
                state.downloading -> {
                    if (state.progress == null) LinearProgressIndicator(Modifier.fillMaxWidth())
                    else LinearProgressIndicator(progress = { state.progress!! / 100f }, modifier = Modifier.fillMaxWidth())
                    Text(state.progress?.let { "已下载 $it%" } ?: "正在下载…")
                }
                state.apk != null -> Text("更新已下载，安装后保留现有地图和设置。")
                state.info != null -> Text(state.info!!.notes.ifBlank { "新版本已发布" })
                state.error == null -> Text(if (!state.previewEnabled && !state.stablePublished) "正式版尚未上线，可开启体验版更新" else "当前已是最新版本")
            }
            (state.error ?: launchError)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            TextButton(onClick = onHistory) { Text("查看更新日志") }
        } },
        confirmButton = {
            when {
                state.checking || state.downloading -> Unit
                state.apk != null -> TextButton(onClick = {
                    launchError = null
                    vm.installIntent()?.let { if (it.action == Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES) permission.launch(it) else launchInstaller(it) }
                }) { Text("安装更新") }
                state.info != null -> TextButton(onClick = { launchError = null; vm.download() }) { Text(if (state.error == null) "下载更新" else "重新下载") }
                else -> TextButton(onClick = { launchError = null; vm.check() }) { Text("重新检查") }
            }
        }, dismissButton = { TextButton(onClick = { if (state.downloading) vm.cancelDownload() else vm.dismiss() }) { Text(if (state.downloading) "取消下载" else "关闭") } })
}
