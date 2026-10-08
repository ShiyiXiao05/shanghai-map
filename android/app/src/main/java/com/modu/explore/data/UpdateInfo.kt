package com.modu.explore.data

import kotlinx.serialization.Serializable
import java.net.URI

@Serializable data class UpdateInfo(
    val packageName: String, val versionCode: Int, val versionName: String,
    val apkUrl: String = "", val sha256: String = "", val notes: String = "",
    val channel: String = "stable", val publishedAt: String = ""
) {
    fun isValid(): Boolean = runCatching {
        val url = URI(apkUrl)
        versionCode > 0 && versionName.isNotBlank() && packageName.isNotBlank() && channel in listOf("stable", "preview") &&
            url.scheme == "https" && !url.host.isNullOrBlank() && url.userInfo == null &&
            sha256.matches(Regex("[a-fA-F0-9]{64}"))
    }.getOrDefault(false)
    fun isNewerThan(currentPackage: String, currentVersion: Int) = isValid() && packageName == currentPackage && versionCode > currentVersion
}

@Serializable data class UpdateCatalog(val releases: List<UpdateInfo> = emptyList()) {
    fun latest(packageName: String, versionCode: Int, preview: Boolean): UpdateInfo? = releases
        .filter { it.isNewerThan(packageName, versionCode) && (it.channel == "stable" || preview) }
        .maxByOrNull { it.versionCode }
    fun history(packageName: String, preview: Boolean) = releases
        .filter { it.packageName == packageName && it.versionCode > 0 && it.versionName.isNotBlank() &&
            (it.channel == "stable" || preview && it.channel == "preview") }
        .distinctBy { it.versionCode }.sortedByDescending { it.versionCode }
}
fun channelLabel(channel: String) = if (channel == "preview") "体验版" else "正式版"
