import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}
val local = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun config(name: String, fallback: String = "") = providers.gradleProperty(name).orNull
    ?: System.getenv(name) ?: local.getProperty(name) ?: fallback
fun literal(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.modu.explore"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.modu.explore"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.4.0"
        val releaseChannel = config("RELEASE_CHANNEL", "preview")
        require(releaseChannel in listOf("stable", "preview")) { "RELEASE_CHANNEL must be stable or preview" }
        if (releaseChannel == "preview") versionNameSuffix = "-preview"
        buildConfigField("String", "RELEASE_CHANNEL", literal(releaseChannel))
        buildConfigField("String", "API_BASE_URL", literal(config("API_BASE_URL", "https://shanghai-wish-map.onrender.com")))
        buildConfigField("String", "AMAP_KEY", literal(config("AMAP_ANDROID_KEY")))
        buildConfigField("String", "UPDATE_MANIFEST_URL", literal(config("UPDATE_MANIFEST_URL", config("API_BASE_URL", "https://shanghai-wish-map.onrender.com").trimEnd('/') + "/android/update.json")))
        manifestPlaceholders["amapKey"] = config("AMAP_ANDROID_KEY")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    val keystore = config("ANDROID_KEYSTORE")
    if (keystore.isNotBlank()) {
        signingConfigs.create("release") {
            storeFile = file(keystore)
            storePassword = config("ANDROID_STORE_PASSWORD")
            keyAlias = config("ANDROID_KEY_ALIAS")
            keyPassword = config("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystore.isNotBlank()) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.03.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("com.amap.api:3dmap-location-search:10.1.200_loc6.4.9_sea9.7.4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.1")
    testImplementation("org.robolectric:robolectric:4.15.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
