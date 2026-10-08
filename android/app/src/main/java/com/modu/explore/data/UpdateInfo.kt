package com.modu.explore.data

import kotlinx.serialization.Serializable
import java.net.URI

@Serializable data class UpdateInfo(
    val packageName: String, val versionCode: Int, val versionName: String,
    val apkUrl: String, val sha256: String, val notes: String = ""
) {
    fun isValid(): Boolean = runCatching {
        val url = URI(apkUrl)
        versionCode > 0 && versionName.isNotBlank() && packageName.isNotBlank() &&
            url.scheme == "https" && !url.host.isNullOrBlank() && url.userInfo == null &&
            sha256.matches(Regex("[a-fA-F0-9]{64}"))
    }.getOrDefault(false)
    fun isNewerThan(currentPackage: String, currentVersion: Int) = isValid() && packageName == currentPackage && versionCode > currentVersion
}
