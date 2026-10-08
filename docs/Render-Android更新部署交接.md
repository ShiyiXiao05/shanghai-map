# Render Android 在线更新部署交接

交接日期：2026-10-08。目标：让现有 `shanghai-wish-map` 后端同时提供 Android 更新清单和 APK 下载。无需另建 Android 编译服务；本次已经生成并提交可安装 APK。

## 本次交付

| 项目 | 值 |
| --- | --- |
| 仓库 | `https://github.com/ShiyiXiao05/shanghai-map` |
| 目标分支 | `main` |
| Render 服务 | `shanghai-wish-map` |
| 后端地址 | `https://shanghai-wish-map.onrender.com` |
| 应用包名 | `com.modu.explore` |
| 版本 | `0.2.0`，`versionCode=2` |
| 发布清单 | `public/android/update.json` |
| 安装包 | `public/android/modu-explore-0.2.0.apk`，约 73 MB |
| APK SHA-256 | `be92c6f47a8eec0f9ba2492e630add1fab4d102e610440f2b1ebfa6c77bdca6a` |
| 当前签名 | Android 调试证书，SHA1 `47:1A:F9:9A:26:B9:37:70:C0:48:76:C4:43:E1:B9:AA:F6:77:36:49` |

0.2.0 包含：等待地图加载后绘制标记、地点范围适配及「显示全部地点」按钮、带描边的深橙色美食标记、首页下方地点简介、显式进入完整详情、应用内更新检查/下载/系统确认覆盖安装。高德 Android Key 已编入本次 APK，源码从本机配置或构建环境读取 Key，未提交本机配置。

验收前状态：12 项 JVM 测试、6 项 Android 15 模拟器回归测试通过，lint 无错误，APK 签名和安装启动已验证；本地 Express 更新下载及哈希验证通过。线上尚未部署，地图实际显示、手机联网更新和系统安装流程仍需真机验收。

## 部署前确认

1. 确认 Render 服务关联上述仓库的 `main` 分支，并已取得包含本交接文档、APK 和清单的提交。
2. 保留现有环境变量：特别是 `DATABASE_URL`、已有高德网页 Key、微信相关配置等。Android Key 已在 APK 中，部署下载文件无需把 Android Key 加到 Render 环境变量。
3. 确认数据库仍使用现有持久化数据库。本次不包含数据库迁移，不需要删除或重建数据库。

## Render 控制台设置

在现有服务的 Settings 中确认如下设置。使用 Blueprint 管理的服务可同步仓库内 `render.yaml`，但仍需核实生效结果。

| 设置 | 目标值 |
| --- | --- |
| Runtime | Node |
| Root Directory | **留空，使用仓库根目录** |
| Build Command | `npm --prefix server ci` |
| Start Command | `npm --prefix server start` |
| Health Check Path | `/api/health` |

原配置为 `rootDir: server`。本次已调整 `render.yaml`，因为 Express 在 `server/index.js` 使用 `../public` 服务静态文件，需要部署中包含同级的 `public/`。Render 明确说明 Root Directory 外的文件在构建和运行时不可用，也不会因根目录外改动自动触发部署；参见 [Render Monorepo 文档](https://render.com/docs/monorepo-support)。

如果控制台启用了 Build Filters，确保包含 `public/android/**`；或移除限制。否则仅发布新 APK/清单时可能不会触发自动部署。

## 执行部署

1. 在 Render 的 Deploys 页面选择 **Manual Deploy → Deploy latest commit**。如需锁定交接版本，选择 **Deploy a specific commit** 并输入交接提交 SHA；注意此选项会关闭自动部署，后续如需自动发布要重新开启。
2. 等待构建和启动成功，查看日志确认后端启动且健康检查通过。
3. 不需要在 Render 构建 Android，不需要 JDK/Android SDK，也不要重新签名仓库中的 APK。

操作参考：[Render 部署文档](https://render.com/docs/deploys)。

## 线上验收

以下命令在部署人员电脑执行；临时下载的 APK 可在验收后删除。

```sh
curl --fail --show-error https://shanghai-wish-map.onrender.com/api/health
curl --fail --show-error https://shanghai-wish-map.onrender.com/android/update.json
curl --fail --show-error --location \
  https://shanghai-wish-map.onrender.com/android/modu-explore-0.2.0.apk \
  --output modu-explore-0.2.0.apk
shasum -a 256 modu-explore-0.2.0.apk
```

Windows PowerShell 的文件校验命令：

```powershell
Get-FileHash .\modu-explore-0.2.0.apk -Algorithm SHA256
```

通过标准：

- `/api/health` 正常，现有网页和小程序数据访问正常。
- 更新清单 HTTP 200，内容是 JSON，包名、版本、下载地址与上表一致。
- APK 下载成功，SHA-256 与上表及清单完全相同。
- 更新清单保持及时刷新；现有 Express 静态服务已经设置 `Cache-Control: no-cache`。如外加 CDN，不要给 `update.json` 长期缓存。
- 手机覆盖安装 0.2.0 后，从「我的地图 → 检查更新」可以完成检查。当前线上同为 0.2.0 时，应显示「当前已是最新版本」。

本次只能验证检查链路；要验收完整下载与覆盖安装，需要后续真实发布更高版本（例如 `versionCode=3`），使用同一签名构建后更新清单。不要仅修改清单中的版本号来模拟新版本：客户端会核对 APK 内版本，并拒绝不匹配的包。

## 后续发布流程

1. Android 开发人员在 `android/app/build.gradle.kts` 提高 `versionCode` 和 `versionName`。
2. 使用与当前安装包一致的签名构建。构建命令与 Key 配置见 `android/README.md`。
3. 在仓库根目录运行 `node android/scripts/prepare-update.mjs`，生成新 APK 与清单。脚本自动读取 APK 构建元数据并计算 SHA-256。可传入自定义更新说明作为第 4 个命令行参数。
4. 明确加入发布文件：`git add -f public/android/update.json public/android/modu-explore-新版本.apk`，提交并推送到 Render 关联分支，重新部署。
5. 校验线上文件和哈希后，在仍安装旧版本的手机上验收下载、系统确认、覆盖安装和数据保留。

APK/清单默认在 `.gitignore` 中，本次交付显式加入 Git。后续必须显式加入新文件；仓库中已被跟踪的清单更新正常提交即可。长期反复提交大型 APK 会增加仓库体积，后续可把 APK 改放对象存储，清单的 `apkUrl` 指向公开 HTTPS 地址；客户端已支持这种方式，清单仍可由当前后端提供。

## 签名与用户安装说明

- 0.1.0 没有更新入口，用户需手动覆盖安装一次 0.2.0，以后从应用内更新。
- Android 更新仍需要系统安装确认。首次会要求允许该应用安装更新；应用不会静默替换代码。
- 同包名、同签名覆盖安装保留现有地图邀请码、昵称和设置。客户端校验文件哈希、包名、版本和签名。
- 当前是体验用调试签名。签名私钥不在仓库中；后续必须由持有同一签名证书的开发环境构建，或建立受控签名发布流程。
- 不可直接使用其他电脑或 CI 默认调试签名替换本次签名。GitHub Actions 的默认调试包不保证与此 APK 签名一致。
- 若迁移到正式发布签名，现有调试包无法覆盖安装：需规划迁移、先导出地图信息，并在高德控制台配置正式签名 SHA1。

## 常见部署问题

| 问题 | 检查方式 |
| --- | --- |
| 更新清单/APK 返回 404 | 检查部署提交是否含 `public/android/` 文件，Root Directory 是否留空，部署分支是否正确 |
| 推送新版本后未部署 | 检查自动部署设置和 Build Filters；手动部署最新提交 |
| APK 校验失败 | 检查线上下载是否完整，清单 SHA-256 是否对应实际 APK，是否有 CDN 旧缓存 |
| 签名不同/无法覆盖安装 | 检查发布人员是否使用了不同电脑或 CI 默认签名 |
| 无法确认安装 | 允许应用安装更新，确认设备有系统安装程序并有足够存储空间 |
| 检查最新但未提示升级 | 确认清单 `versionCode` 大于手机已安装版本，并确认清单没有缓存 |

不要通过手工修改 APK、哈希或伪造版本绕过校验；重新使用正确配置构建并发布匹配文件。
