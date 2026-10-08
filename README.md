# 魔都·Explore 🌃

在魔都的夜色里，和同学一起标记想去的上海角落：搜索定位、吸附选点、添加描述、分类管理、去过后打卡，每个地点还能传照片、写留言。**邀请码共享多地图**：每张地图有独立邀请码，同码即可共建。

> **线上地址**：https://shanghai-wish-map.onrender.com
>
> 2026-10-08 可用性审计与修复记录见 `docs/audit/2026-10-08/`：`可用性审计报告.md`（问题清单与证据）、`修复报告.md`（根因与改动）、`fix-verification.mjs`（修复后回归脚本）
> 新访客在欢迎页「创建地图」拿邀请码，或输入同学的邀请码加入；邀请链接形如 `/?map=邀请码` 可直接打开。

## 功能

- **🌍 公共广场**：无需邀请码的默认地图，聚合所有人勾选「公开」的地点（只读，不泄露各地图邀请码）
- 每张地图独立：创建即生成 6 位邀请码，侧栏切换器管理多张地图，地点互相隔离
- ⚙️ 地图设置：改名、换邀请码（权限重置，旧码立即失效）、删除地图（级联清理全部数据 + CDN 照片）、**JSON 导出备份**、**🗑️ 回收站**（删除的地点保留 30 天可恢复）
- 邀请码即权限：知道码才能看和编（读 `?map=`、写请求带码），无账号系统
- 上海地图（高德深色底图）展示标记，按分类着色；搜索地点名或地图吸附选点（自动匹配附近地点）
- ◎ 当前位置与附近地点：地图显示当前位置，并按直线距离列出最近 5 个收藏地点
- 🎲 随机抽取：从当前地图全部地点中随机抽一个，支持重抽和直接查看详情
- 🔗 高德导入：粘贴高德 App 分享的文本/链接一键导入（支持「位置：经度,纬度」坐标、uri.amap.com/marker 链接、【地点名】搜索）
- 🗺️ 详情一键跳转高德：桌面打开网页版，手机拉起高德 App 看位置、直接导航
- 每个地点：名称、描述、分类（景点/美食/展馆/购物/娱乐/其他）、**人均价格/营业时间/标签**（详情徽章展示）、添加人昵称、时间
- 地点详情：照片（客户端压缩上传，最多 9 张，带上传时间）与留言（280 字内）
- **🚶 行程单**：勾选地点串成一条路线，上下移排序，显示相邻距离与步行时间（haversine + 4.5km/h），一键生成高德多点步行导航、复制行程文本
- 「我也想去」♥ 投票：按昵称去重，悬停看谁想去了
- 📷 回忆时间线：已打卡地点按时间倒序串成足迹流
- 🖼 分享海报：一键生成深色霓虹统计卡（含邀请码），保存后发群拉新
- **🔔 推送通知**（Web Push）：侧栏 🔔 订阅后，地图有新地点/照片/留言时浏览器推送提醒（需服务端配置 VAPID 密钥，见准备工作）
- "已去过"圆圈打卡、分类筛选 + 排序（最新/名称/最想去）、列表计数、列表悬停与地图标记联动
- 地点深链：详情页「🔗 分享」复制 `?map=码&place=id`，同学打开直达该地点
- 自定义确认/昵称弹窗（无原生 confirm/prompt）、操作忙碌态、搜索支持 ↑↓ + Enter 键盘导航
- 移动端底部抽屉可收起；对话框动效、骨架屏加载、图标化 toast
- PWA：可安装到主屏幕，静态资源离线缓存
- 六套配色 + 跟随系统：☀️ 浅色 / 🌫️ 雾灰 / 🌃 东京夜 / 🌌 墨蓝 / 🍷 微醺，**地图底图随主题联动**（深色主题用高德官方 dark/darkblue/wine 深色底图），移动端适配

### 📱 微信小程序（体验版）

`miniprogram/` 目录是功能对齐网页版的微信小程序：原生 `<map>` 组件（腾讯底图同为 GCJ-02 坐标，数据零转换）、微信原生选点添加（`wx.chooseLocation`，无需位置服务 key）、高德分享导入、详情（照片/留言/想去/打卡）、回忆时间线、行程单、分享海报（canvas 生成存相册）、深浅双主题跟随系统、地图全屏。**登录署名**：所有写操作要求登录（静默 `wx.login` + 首次昵称确认，服务端按登录昵称盖章署名），需在后端配置 `MINIPROGRAM_APPID/MINIPROGRAM_SECRET/AUTH_SECRET`。

本地预览：微信开发者工具导入 `miniprogram/` 目录（AppID 已配置为正式号）。后端通道二选一：`utils/config.js` 填 `CLOUD_ENV_ID`（微信云托管，正式版通道，免域名备案，见 [docs/微信云托管部署指引.md](docs/微信云托管部署指引.md)）；留空则回落 `BASE_URL` 直连 Render（体验版需勾选「不校验合法域名」）。

## 技术栈

- 前端：原生 HTML/CSS/JS + 高德地图 JS API 2.0（无构建，克隆即用），PWA（manifest + Service Worker）
- 后端：Node.js + Express，`pg` 连接池，所有 SQL 静态字面量 + 参数绑定；gzip 压缩、照片内存缓存与 DB 索引
- 数据库：Neon 免费托管 Postgres（数据持久保存）
- 部署：双通道同一份代码——网页走 Render 免费 Web Service（后端同时托管前端静态页），小程序正式版走微信云托管（根目录 `Dockerfile`，`wx.cloud.callContainer` 调用，免域名备案），两端共用同一个 Neon

## 本地开发

前置：Node.js ≥ 20；地图和数据库的 key 见下方"准备工作"（不配置也能启动：数据库用内存模式、地图显示占位卡片）。

```bash
git clone <仓库地址> && cd shanghai-map
cp .env.example .env   # 编辑 .env 填入真实值
npm --prefix server install
npm --prefix server run dev
# 打开 http://localhost:3000
```

> 没配 `DATABASE_URL` 时服务以内存数据库启动（重启数据清空，仅限本地体验）；没配 `AMAP_KEY` 时地图区域显示占位说明，列表和增删改功能照常。

### 准备工作（一次性，约 10 分钟）

1. **数据库**：注册 [Neon](https://console.neon.tech)（免费、无需信用卡）→ 创建项目 → 复制 Connection string 填入 `.env` 的 `DATABASE_URL`
2. **地图 key**：注册 [高德开放平台](https://console.amap.com)（需阿里云/淘宝账号）→ 创建应用 → 添加 Key，服务平台选 **Web端(JS API)** → 得到 key 与安全密钥，填入 `.env` 的 `AMAP_KEY`、`AMAP_SECURITY_CODE`
3. **图床（推荐）**：注册 [Cloudinary](https://console.cloudinary.com)（免费、无需信用卡）→ Dashboard 的 API Keys 复制 `CLOUDINARY_URL` 填入 `.env`。配置后照片存 CDN、数据库只存链接（不占 Neon 存储）；不配置则照片存数据库。存量照片迁移：`cd server && node scripts/migrate-photos.mjs`
4. **推送通知（可选）**：生成 VAPID 密钥对 `npx web-push generate-vapid-keys`，填入 `.env` 的 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`（另加 `VAPID_SUBJECT=mailto:你的邮箱`）。不配置则 🔔 推送功能静默停用，其余功能不受影响
5. **小程序登录（可选）**：在 [mp.weixin.qq.com](https://mp.weixin.qq.com) → 开发管理 → 开发设置 复制 AppID / AppSecret，填入 `MINIPROGRAM_APPID`、`MINIPROGRAM_SECRET`；再用 `openssl rand -base64 32` 生成 `AUTH_SECRET`。配置后小程序所有写操作要求登录（静默 `wx.login` + 首次确认昵称），地点/留言/想去/照片的署名由服务端按登录昵称盖章，不可冒名。不配置则小程序登录停用、内容安全检测停用，写接口退回客户端昵称。配置后服务端会在写入地点/留言/昵称前调用微信 `security.msgSecCheck` 做文本检测（命中违规返回 400 且不入库；微信接口异常时放行不阻断，可用 `CONTENT_SECURITY=off` 临时整体关闭）

## 和同学协作

- 把邀请码或邀请链接发给同学，他们在欢迎页输入即加入同一张地图
- 修改代码：clone 仓库 → 本地跑起来 → 改 → push；小改动也可以直接在 GitHub 网页上编辑
- 数据存在云端数据库，所有人共享同一份；代码仓库里没有数据

## API 一览

| 方法 | 路径 | 说明 | 邀请码 |
|---|---|---|---|
| POST | /api/auth/login | 小程序登录：wx.login 的 code 换 token + 昵称状态 | — |
| POST | /api/auth/profile | 设置/更新昵称（需 `Authorization: Bearer token`） | — |
| POST | /api/maps | 创建地图，返回邀请码 | — |
| PUT | /api/maps/:code | 地图改名 | — |
| POST | /api/maps/:code/rekey | 换邀请码（旧码失效，地点随迁） | — |
| DELETE | /api/maps/:code | 删除地图（级联清理） | — |
| GET | /api/maps/:code | 校验邀请码 | — |
| GET | /api/places?map=码 | 地点列表（含照片/留言计数） | query 传入 |
| POST | /api/places | 新增地点 | body `map_code` |
| PUT | /api/places/:id | 编辑地点 | 头 `x-map-code` |
| DELETE | /api/places/:id | 删除地点（软删除，进回收站 30 天） | 头 `x-map-code` |
| POST | /api/places/:id/restore | 从回收站恢复地点 | body `map_code` |
| GET | /api/places?map=码&view=trash | 回收站列表（顺带清理超期项） | query 传入 |
| GET | /api/maps/:code/export | 全量导出 JSON（地点/照片链接/留言/想去/行程） | — |
| GET | /api/itinerary?map=码 | 行程单（按序返回站点） | query 传入 |
| PUT | /api/itinerary | 保存行程（place_ids 数组顺序即行程顺序） | body `map_code` |
| GET | /api/push/key | Web Push 公钥（未配置 VAPID 时 503） | — |
| POST | /api/push/subscribe | 订阅推送通知 | body `map_code` |
| DELETE | /api/push/subscribe | 退订推送 | 头 `x-map-code` |
| GET | /api/places/:id/photos?map=码 | 照片列表（含缩略图） | query 传入 |
| GET | /api/upload-config | 上传口径：`{cdn, maxFullBytes, maxThumbBytes}`（客户端据此压缩与决定是否传 thumb） | — |
| POST | /api/places/:id/photos | 上传照片（base64，≤9 张/地点；配了图床时只传 `full`，否则需带 `thumb`≤64KB） | body `map_code` |
| GET | /api/photos/:id?map=码 | 照片原图（二进制） | query 传入 |
| DELETE | /api/photos/:id | 删除照片 | 头 `x-map-code` |
| GET | /api/places/:id/comments?map=码 | 留言列表 | query 传入 |
| POST | /api/places/:id/comments | 发表留言（≤280 字） | body `map_code` |
| DELETE | /api/comments/:id | 删除留言 | 头 `x-map-code` |
| POST | /api/places/:id/wish | 「我也想去」投票（切换式） | body `map_code` |
| GET | /api/maps/:code/memories | 回忆时间线（已打卡+缩略图） | — |
| GET | /api/public/places | 公共广场（所有人可见的公开地点聚合，只读） | — |
| GET | /api/public/places/:id | 公共广场单个地点（只读，不含邀请码） | — |
| POST | /api/places/:id/public | 公开 / 取消公开到公共广场（切换式） | body `map_code` |

地点列表每项附带 `photo_count` / `comment_count` / `wishes`（想去的昵称数组）。

邀请码无效返回 404；前端已自动处理。

**登录与署名**：小程序端请求自动带 `Authorization: Bearer token`，服务端将 `added_by` / `author` / `who` / `createdBy` 一律盖章为登录昵称（客户端传值被忽略，防冒名）；网页端不带 token，行为不变（继续用请求里的昵称字段）。登录 token 过期时写操作返回 401，读操作不受影响。

## 部署手册

把网站发布到公网（免费），让同学直接用网址访问：

### 第 1 步：推送到 GitHub

```bash
git remote add origin git@github.com:<你的用户名>/shanghai-map.git
git push -u origin main
```

### 第 2 步：Render 部署后端

1. 注册/登录 [Render](https://render.com)（GitHub 账号即可，免费档无需信用卡），并在 GitHub 安装 Render App 时授权本仓库
2. New → **Web Service** → 连接上面的 GitHub 仓库
3. 配置：
   - Root Directory：`server`
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Instance Type：Free
4. Environment 中添加 3 个变量（与 `.env` 相同）：`DATABASE_URL`、`AMAP_KEY`、`AMAP_SECURITY_CODE`
5. 创建后等待部署完成，得到形如 `https://xxx.onrender.com` 的网址

> 免费档服务 15 分钟无访问会休眠，下次首访约需 30–60 秒唤醒，属正常现象。
> **消除冷启动（推荐）**：注册 [UptimeRobot](https://uptimerobot.com)（免费），添加一个 HTTP 监控，地址填 `https://你的域名/api/health`，间隔 10 分钟——服务将保持常驻，同学随点随开。
> 若推送后网站没自动更新，控制台 Manual Deploy → Deploy latest commit。

### 第 3 步：分享

把 `https://xxx.onrender.com` 发给同学，让他们创建/加入地图即可。

### 第 4 步（可选）：微信云托管——小程序正式版通道

小程序正式发布要求 `request` 域名 HTTPS + ICP 备案，Render 域名无法满足。把同一份后端打成 Docker 镜像部署到**微信云托管**，小程序改走 `wx.cloud.callContainer` 官方通道即可免备案直接提审；网页端 Render 不动，两端共用数据库。前 3 个月免费，之后每月几毛钱。

完整步骤（开通环境 → 绑定 GitHub 自动构建 → 配环境变量 → 回填环境 ID → 提审发布）见 **[docs/微信云托管部署指引.md](docs/微信云托管部署指引.md)**，代码侧已全部就绪。

## 项目结构

```
server/   Express 后端（API + 静态托管）
  app.js        应用装配
  store.js      数据层（静态 SQL + 参数绑定、邀请码生成、生产连接池）
  auth.js       小程序登录（code2Session + HMAC token；未配置时停用）
  pusher.js     Web Push 发送器（VAPID 未配置时停用）
  env.js        dotenv 引导
  routes/       auth / maps / places / photos / comments / itinerary / push 路由
  test/         接口测试（node:test + pg-mem，99 个用例，含安全头/上传契约/数据一致性/限流/内容安全/进程健壮性）
public/   前端（index.html / css / js，js 含照片客户端压缩）
miniprogram/  微信小程序（原生 map 组件，功能对齐网页版 + 登录署名；云托管 callContainer 通道，CLOUD_ENV_ID 留空回落 Render 直连）
docs/     设计文档 + 微信云托管部署指引
render.yaml  Render 部署蓝图（网页端）
Dockerfile / container.config.json / .dockerignore  微信云托管镜像构建（小程序端）
```
