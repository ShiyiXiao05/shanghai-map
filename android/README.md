# 魔都·Explore Android

独立 Android 原生客户端，Kotlin + Jetpack Compose。首页、详情、地图管理和深浅配色沿用微信小程序；通过 HTTPS API 与网页和小程序共用地图数据。

## 安装

当前体验版目标为 `0.4.0-preview`，支持 Android 8 及以上。发布包需要使用原有签名，才能覆盖安装并保留设置。

首次进入公共广场。点击顶部地图名称进入「我的地图」，设置昵称后创建地图，或输入已有的 6 位邀请码加入。Android 沿用网页的昵称署名与邀请码权限，不使用小程序 `wx.login`。

## 构建

依赖 JDK 17、Android SDK 35 与 build-tools 35.0.0。Android Studio 可直接打开本目录。命令行：

```sh
./gradlew testDebugUnitTest lintDebug assembleDebug
# 输出 app/build/outputs/apk/debug/app-debug.apk
```

`local.properties` 配置本机 SDK 和高德 Key（已忽略，不提交）：

```properties
sdk.dir=/absolute/path/to/android-sdk
AMAP_ANDROID_KEY=你的Android平台SDKKey
API_BASE_URL=https://shanghai-wish-map.onrender.com
```

三个参数也支持环境变量或 Gradle `-P` 参数，优先级为 `-P`、环境变量、`local.properties`、默认值。默认连接 Render 后端；不能用 `wx.cloud.callContainer`，因为这是小程序专属通道。

调试构建允许 `localhost`、`127.0.0.1` 和模拟器宿主 `10.0.2.2` 的 HTTP 本地测试连接；其余连接仍要求 HTTPS。正式构建不允许 HTTP。

## 高德 Key

在[高德控制台](https://console.amap.com/)创建「Android 平台 SDK」Key，绑定：

- 包名：`com.modu.explore`
- 本次本地调试 APK 的 SHA1：`47:1A:F9:9A:26:B9:37:70:C0:48:76:C4:43:E1:B9:AA:F6:77:36:49`
- 正式版 SHA1：由自己的发布签名生成，需另外配置；其他电脑或 GitHub CI 的调试签名也会不同。

填好 Key 后重新构建并安装。未配置 Key 时，地图显示「地图暂未配置」，列表、地图管理、详情、照片、留言、行程、回忆、海报和带坐标的高德导入仍可用。地图显示、关键词搜索、长按选点和当前位置需有效 Key。

地图 SDK 只在用户同意高德隐私政策后初始化；定位在用户主动点「附近」时申请权限，不申请后台位置权限。SDK 版本固定为 `10.1.200_loc6.4.9_sea9.7.4`，地图、搜索与定位使用同一 SDK 组合，坐标为 GCJ-02。

## 功能

- 公共广场、创建/加入/切换地图，邀请码与原有客户端互通。
- 分类筛选、未去过筛选、排序、刷新、随机抽取；地图全屏、附近地点、地图长按选点。
- 地点增改删、打卡、想去、公开切换、高德导航、分享与举报。
- 系统照片选择器、图片预览、照片预算压缩、照片/留言增删。
- 行程添加/移除/排序、距离与步行估算、多点高德导航。
- 回忆时间线、原生 Canvas 海报生成与文件保存。
- 地图改名、换码、删除、JSON 备份导出、回收站恢复。

Android 原生推送尚未接入。现有 Web Push 是浏览器能力，无法直接作为原生推送复用。

## 0.4.0 体验版

当前发布为 `0.4.0-preview`（`versionCode = 4`），使用用户提供的城市探索少女图标。

- 地图标记改为分类默认 emoji；编辑页支持选择或输入单个 emoji，以及恢复分类默认值。`emoji` 随地点由服务端保存，部署服务端后才能跨设备同步；已有地点自动使用分类默认图标。
- 地点与行程导航通过显式 Intent 打开高德 App 的步行路线规划；未安装时提示用户。
- 首页使用本机列表缓存，刷新保留已有内容；点赞、地点保存与留言立即显示待同步结果，失败回退。详情预取并短时缓存，照片与留言独立显示；上传成功后直接更新缩略图，地图标记按变化更新。
- 深色配色改为石墨色，配合柔和绿与珊瑚色；列表和地图共用地点 emoji，统一控件尺寸与间距。

### 正式版、体验版与更新日志

本次默认构建渠道为 `RELEASE_CHANNEL=preview`（体验版），版本名自动添加 `-preview`。后续正式版构建使用 `-PRELEASE_CHANNEL=stable`；这与 debug/release 签名类型分别配置。

客户端启动和回到前台时自动检查更新（30 分钟内避免重复检查），默认只提示正式版。在「检查更新」中开启「体验版更新」后，体验版才进入候选更新和更新日志；关闭后移除体验版候选。安装仍由系统确认。此机制在应用前台检查，不包含后台消息通知服务。

`public/android/releases.json` 保存历史发布，按 `versionCode` 降序显示；「我的地图 → 更新日志」及检查更新弹窗均有入口。清单支持 `channel`（`stable` / `preview`）、`publishedAt`、`notes`、APK 地址和 SHA-256。历史版本可以只保留日志，不提供下载。

后续发布时为每次正式版或体验版分配更大的 `versionCode`，正式版需要大于此前体验版，才能覆盖升级。保持同一安装签名，然后使用发布脚本：

```sh
node android/scripts/prepare-update.mjs APK路径 https://你的服务地址 "逐行更新内容" stable
node android/scripts/prepare-update.mjs APK路径 https://你的服务地址 "逐行体验内容" preview
```

脚本保留历史，体验版不会覆盖旧客户端使用的 `update.json`；仅正式版更新该兼容清单。优先发布 APK，再发布目录清单。新客户端在 `releases.json` 尚未部署时回退到原来的正式版清单。已有 0.3.0 安装包需在下一次发布后才能使用这些新功能。

## 正式签名

生成并妥善保存发布 keystore，设置下列环境变量后执行 `./gradlew assembleRelease`：

```sh
export ANDROID_KEYSTORE=/absolute/path/to/release.jks
export ANDROID_STORE_PASSWORD=你的密码
export ANDROID_KEY_ALIAS=你的别名
export ANDROID_KEY_PASSWORD=你的密码
./gradlew assembleRelease
```

没有签名配置时仅生成未签名 release APK，不能直接安装。签名文件和密码不进入仓库。当前首版用于侧载验证；应用商店发布前需补齐隐私政策、签名、原生地图真机验证，并核对目标商店要求。

## 测试和 CI

`app/src/test/` 覆盖 JSON 契约、筛选、距离、邀请码、高德坐标导入、写请求错误及授权头。

本次验证：10 项单元测试、4 项 Android 15 模拟器回归测试通过，lint 无错误，APK 安装和签名校验通过。已检查浅色/深色页面截图；尚未进行真机及有效高德 Key 下的地图、搜索、定位验证。

已在本机 `local.properties` 配置 Android Key 并重新构建，单元测试与 lint 通过，Key 已核对包含于构建配置和 Manifest，签名保持一致；高德在线授权效果待设备联网验证。

0.2.0 改为点击标记或列表先显示首页下方的地点简介（位置、坐标、备注），点「进入详情」后显示照片、留言和完整信息。地图加载完成后绘制标记，初次加载/切换地图/筛选自动适配地点范围，手动移动后可点「显示全部地点」恢复。美食标记使用较深橙色，所有标记带白色外圈和深色描边，已去过地点显示角标而不降低透明度。

0.2.0 验证：12 项 JVM 测试、6 项 Android 15 模拟器测试通过，lint 无错误；已检查地点简介截图，APK 签名校验通过。地图实际渲染、联网更新与系统安装确认仍需真机验证。APK SHA-256：`be92c6f47a8eec0f9ba2492e630add1fab4d102e610440f2b1ebfa6c77bdca6a`。

## 应用内更新

0.3.0 发布内容与验收说明见 [Android 0.3.0 发布说明](../docs/Android-0.3.0发布说明.md)。

部署人员交接文档见 [Render Android 更新部署交接](../docs/Render-Android更新部署交接.md)。Render 的 Root Directory 需留空，Build/Start 使用 `npm --prefix server ci` 和 `npm --prefix server start`，以包含同级 `public/`。

启动时静默检查新版本；「我的地图 → 检查更新」可手动检查。支持下载进度、取消、重试，以及系统确认覆盖安装。首次安装更新需要在系统设置中允许此应用安装更新。客户端验证 HTTPS、SHA-256、包名、版本和签名；服务器未发布时手动检查会显示提示。

默认更新地址：`https://shanghai-wish-map.onrender.com/android/update.json`，可用 `UPDATE_MANIFEST_URL` 覆盖。文件结构：

```json
{
  "packageName": "com.modu.explore",
  "versionCode": 2,
  "versionName": "0.2.0",
  "apkUrl": "https://shanghai-wish-map.onrender.com/android/modu-explore-0.2.0.apk",
  "sha256": "APK文件的64位SHA256",
  "notes": "本次更新内容"
}
```

后续每次发布提高 `versionCode` 和 `versionName`，使用同一签名构建，然后在仓库根目录执行：

```sh
node android/scripts/prepare-update.mjs
# 将 APK 和 update.json 生成到 public/android/
```

现有 Express 静态服务可直接提供这两个文件，已在本地验证下载与文件哈希；**线上尚未部署，当前线上更新地址返回 404**。生成文件默认不进 Git。Render 当前从 Git 构建，发布时必须让构建产物包含这两个文件：可以将文件显式加入发布提交（APK 约 73 MB，建议后续使用对象存储），或从已配置的存储地址在构建阶段下载。Docker 发布可直接把生成目录包含在镜像构建上下文中。先上传 APK，再更新清单，避免客户端先看到不存在的包。

现有 0.1.0 没有更新入口，因此本次需要手动覆盖安装一次 0.2.0；以后由应用内发起下载和系统覆盖安装，地图与设置保留。安装仍由 Android 系统确认，不支持静默替换原生代码。不同电脑/CI 默认调试签名不同，不能直接拿 CI 调试包更新本机签名的安装包。若换成正式签名，需要先卸载旧调试版，再安装正式版，并更新高德平台的发布 SHA1。

`app/src/androidTest/` 在 Android 设备上覆盖照片 EXIF 方向与压缩预算、返回首页后的异步加载状态：

```sh
./gradlew connectedDebugAndroidTest
```

GitHub Actions 的 `Android APK` 工作流运行单元测试、lint 和 APK 构建，上传 `modu-explore-debug-apk`。可在 GitHub Secrets 设置 `AMAP_ANDROID_KEY`；没有 Key 也能构建。

注意：邀请码是访问凭证。海报、分享链接、JSON 导出中包含地图信息，请只分享给预期成员。
