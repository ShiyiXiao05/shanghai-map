# 魔都 · Explore for Windows

Windows 原生桌面客户端，C# / .NET 8 / WPF。主界面、列表、编辑、照片、留言、行程和设置使用原生控件；地图区域通过 WebView2 接入高德 JS SDK。应用直接调用与 Android 相同的 HTTPS 后端。

## 运行

双击 `ModuExplore.exe`。这是包含 .NET 运行时的便携版，可放在用户有写入权限的文件夹，无需管理员权限或另装 .NET。支持 Windows 10 2004 及以上的 x64 系统、Windows 11 x64。

地图需要 Microsoft Edge WebView2 Runtime。常规 Windows 11 已包含；缺失时界面提供官方下载入口。没有开启地图或地图加载失败时，地点浏览与管理仍可使用。地图、同步和搜索需要网络；离线时可以查看本机缓存的地点，写操作失败时保留输入。

初次打开公共广场。在「地图管理」创建地图或输入 6 位邀请码加入，即可与 Android、网页和小程序共用数据。地图邀请码与署名保存在本机，公开地点不包含邀请码。

本机数据位于 `%LOCALAPPDATA%/ModuExplore`。删除便携 EXE 不删除地图记忆和设置。分享地图需注意邀请码意味着编辑权限。

当前为 `0.1.0-preview` 本地体验版，没有数字代码签名。Windows 是否提示来源检查取决于电脑策略和文件来源。

## 功能

- 公共广场与多地图切换；创建、加入、改名、更换邀请码、本机移除、永久删除、JSON 导出。
- 地图和地点列表联动；分类、未去过筛选；最新 / 名称 / 想去数排序；关键词搜索；随机地点。
- 高德 POI 搜索、分享文本坐标导入、手动输入、地图选点、附近地点、范围适配与地图聚焦。
- 地点名称、描述、地址、分类、人均、时间、标签与默认 / 自定义 emoji；想去、打卡、公开与内容举报。
- 照片最多 9 张；上传压缩、EXIF 方向处理、PNG / JPEG / WebP / BMP / TIFF 解码；原图预览、保存、删除。
- 280 字留言与删除；照片和留言并行加载、独立重试；写入失败保留输入。
- 最多 50 站的行程：加入、移除、排序、清空、复制、相邻直线距离与步行时间估算。
- **导航遵循 Windows 能力**：用浏览器打开高德路线；多站步行提供逐段导航，保留所有中间地点。估算不是实际道路距离。
- 回忆时间线、照片、分享海报 PNG；回收站 30 天恢复。
- 署名、浅色 / 深色 / 跟随 Windows；更新日志、正式版 / 体验版开关；同源 HTTPS 更新包下载与 SHA-256 校验、重启替换。
- Windows 更新目录尚未上线时，会正常显示首版日志并说明暂无在线更新。构建脚本生成可供部署的目录文件，部署后应用才会收到更新。

## 桌面操作

| 操作 | 快捷键 |
| --- | --- |
| 搜索收藏 | Ctrl + F |
| 新增地点 | Ctrl + N |
| 刷新 | F5 |
| 关闭详情 / 取消选点 | Esc |
| 原生焦点导航 | Tab / Shift + Tab |
| 激活按钮 | Enter / 空格 |
| 输入自定义 emoji | Windows + . |

列表 / 地图宽度可拖动调整；小窗口打开详情时暂时收起列表；应用声明 Per Monitor V2 DPI 适配。按钮有可访问名称，写操作期间防止重复提交和切换地图。

## 构建

安装 .NET 8 SDK，在 Windows 上执行：

```powershell
dotnet build windows/Modu.Desktop/Modu.Desktop.csproj -c Release
./windows/scripts/build.ps1
```

构建脚本在 `windows/artifacts/release` 生成便携 EXE、SHA-256 和待部署更新目录。只需分发 EXE 即可运行。`releases.json` 中 URL 是未来部署位置，构建本身不上传或部署。

## 验证

```powershell
# 核心数据、校验、缓存、HTTP 错误、更新安全
dotnet run --project windows/Modu.Tests/Modu.Tests.csproj -c Release

# 隔离接口验证：另一个终端运行本机内存数据库测试服务
node windows/scripts/test-server.mjs
dotnet run --project windows/Modu.Tests/Modu.Tests.csproj -c Release -- http://127.0.0.1:47831

# 原生控件回归（数据目录应独立）
ModuExplore.exe --demo --no-map --ui-test --data C:/Temp/modu-ui --screenshot C:/Temp/modu-ui.png --exit
ModuExplore.exe --no-map --functional-ui-test --server http://127.0.0.1:47831 --data C:/Temp/modu-functional --screenshot C:/Temp/modu-functional.png --exit

# 真正高德地图与 POI 搜索验证：使用演示地点，联网，不写生产数据
ModuExplore.exe --demo --map-preview --ui-test --data C:/Temp/modu-map --screenshot C:/Temp/modu-map.png --exit
```

演示模式禁止服务器写入。功能界面测试只允许 localhost 后端。测试服务使用 `pg-mem` 隔离库，需要先运行 `npm --prefix server ci`。截图与回归日志保存在指定目录。

测试覆盖不等于保证所有电脑上零缺陷；真实 GPS 精度、不同输入法、企业策略、不同 DPI / 多显示器及屏幕阅读器仍需要实机验收。
