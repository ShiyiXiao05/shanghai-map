package com.modu.explore.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.modu.explore.BuildConfig
import com.modu.explore.UpdateViewModel
import com.modu.explore.data.channelLabel

@Composable fun ChangelogScreen(vm: UpdateViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            if (state.historyLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.historyError?.let { EmptyState(it, retry = vm::loadHistory) }
            if (!state.historyLoading && state.historyError == null && state.history.isEmpty()) EmptyState("暂时没有更新日志")
        }
        items(state.history, key = { it.versionCode }) { release ->
            Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(release.versionName, style = MaterialTheme.typography.titleLarge)
                    Text(channelLabel(release.channel), style = MaterialTheme.typography.labelMedium,
                        color = if (release.channel == "preview") MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary)
                    if (release.versionCode == BuildConfig.VERSION_CODE) Text("当前版本", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (release.publishedAt.isNotBlank()) Text(release.publishedAt.take(10), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(release.notes.ifBlank { "维护与体验改进" }, style = MaterialTheme.typography.bodyMedium)
            }
            HorizontalDivider(Modifier.padding(horizontal = 20.dp), color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
