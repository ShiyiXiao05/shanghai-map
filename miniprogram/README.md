# 魔都·Explore 微信小程序（体验版）

与网页版共用同一个后端（[项目根目录](../README.md)），数据实时互通。

## 当前状态

- ✅ 已完成：地图主页（原生 map 组件 + 分类圆点标记 + 底部列表/筛选/排序 + 下拉刷新 + 地图全屏 + 手机当前位置附近排序）、创建/加入地图（邀请码大字展示与复制、多地图切换）、添加地点支持按名字搜索（走服务端代理高德，小程序不需要地图 key）与地图手动点选（无需定位权限）、高德分享导入、地点详情（照片九宫格/预览/上传/删除、留言、想去、打卡、公开、编辑、删除）、回忆时间线、行程单、分享海报（canvas 生成存相册）、深浅双主题（跟随系统）、微信分享（携带地图邀请码直达）
- 🔐 登录署名：所有写操作（加地点/导入/留言/想去/传照片/建图）要求登录——静默 `wx.login` 换 token，首次操作弹一次性昵称确认（`input type="nickname"` 键盘上方可一键选用微信昵称，因微信已收回 `getUserProfile`）；之后署名由服务端按登录昵称盖章。需服务端配置 `MINIPROGRAM_APPID/MINIPROGRAM_SECRET/AUTH_SECRET`（见根 README「准备工作」），未配置时登录接口 503
- 配置：`utils/config.js` 填 `CLOUD_ENV_ID`（微信云托管环境 ID，正式版通道）。地点搜索不需要小程序端配置任何地图 key——服务端 `/api/geo/search` 用 `AMAP_KEY` 代理高德

## 如何预览

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版）
2. 导入本项目：选择 `miniprogram/` 目录，AppID 已配置为正式号 `wx45e968f2b0809dde`
3. 后端通道二选一（`utils/config.js`）：
   - **云托管（推荐）**：填 `CLOUD_ENV_ID`（开通见 [../docs/微信云托管部署指引.md](../docs/微信云托管部署指引.md)），请求走 `wx.cloud.callContainer`，与域名校验无关，无需任何勾选
   - **直连 Render（回落）**：`CLOUD_ENV_ID` 留空走 `BASE_URL`，需在详情 → 本地设置勾选**「不校验合法域名」**（真机调试同样需开调试模式）
4. 编译预览；真机调试扫预览二维码
5. 给同学用：工具栏「预览」二维码为开发版；正式体验版在开发者工具「上传」→ mp 后台设为体验版并添加体验成员（≤90 人）；正式版经云托管通道可直接提交审核（免域名备案，见部署指引第 5 步）

## 结构

```
app.js/json/wxss     全局会话（地图切换）、双主题令牌、页面注册
theme.json           darkmode 导航栏配色
utils/config.js      后端通道（CLOUD_ENV_ID 云托管 / BASE_URL 直连回落）/ 腾讯位置 key / 分类元数据
utils/api.js         与网页版对齐的全部 API（云托管 callContainer 或 wx.request，登录自动带 Bearer token）
utils/auth.js        登录守卫（静默登录 + 昵称确认重试）
utils/identity-behavior.js  页面共用：昵称弹层 confirm/cancel 处理
utils/storage.js     与网页版同名的本地存储键 + 登录 token
components/nickname-modal   昵称一次性确认弹层（input type="nickname"）
pages/index          地图主页（含全屏）
pages/entry          创建/加入/切换地图、邀请码分享
pages/detail         地点详情（照片/留言/想去/打卡/编辑/删除）
pages/search|import|itinerary|memories|poster  搜索选点/高德导入/行程/回忆/海报
```
