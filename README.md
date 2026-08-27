# 魔都·Explore 🌃

在魔都的夜色里，和同学一起标记想去的上海角落：搜索定位、吸附选点、添加描述、分类管理、去过后打卡，每个地点还能传照片、写留言。**邀请码共享多地图**：每张地图有独立邀请码，同码即可共建。

> **线上地址**：https://shanghai-wish-map.onrender.com
> 新访客在欢迎页「创建地图」拿邀请码，或输入同学的邀请码加入；邀请链接形如 `/?map=邀请码` 可直接打开。

## 功能

- 每张地图独立：创建即生成 6 位邀请码，侧栏切换器管理多张地图，地点互相隔离
- 邀请码即权限：知道码才能看和编（读 `?map=`、写请求带码），无账号系统
- 上海地图（高德深色底图）展示标记，按分类着色；搜索地点名或地图吸附选点（自动匹配附近地点）
- 每个地点：名称、描述、分类（景点/美食/展馆/购物/娱乐/其他）、添加人昵称、时间
- 地点详情：照片（客户端压缩上传，最多 9 张，带上传时间）与留言（280 字内）
- 「我也想去」♥ 投票：按昵称去重，悬停看谁想去了
- 📷 回忆时间线：已打卡地点按时间倒序串成足迹流
- 🖼 分享海报：一键生成深色霓虹统计卡（含邀请码），保存后发群拉新
- "已去过"圆圈打卡、分类筛选、地点列表与地图联动
- PWA：可安装到主屏幕，静态资源离线缓存
- 霓虹夜行主题：深夜蓝黑 + 品红→荧光青渐变，玻璃拟态浮层，移动端适配

## 技术栈

- 前端：原生 HTML/CSS/JS + 高德地图 JS API 2.0（无构建，克隆即用），PWA（manifest + Service Worker）
- 后端：Node.js + Express，`pg` 连接池，所有 SQL 静态字面量 + 参数绑定；gzip 压缩、照片内存缓存与 DB 索引
- 数据库：Neon 免费托管 Postgres（数据持久保存）
- 部署：Render 免费 Web Service（后端同时托管前端静态页）

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

## 和同学协作

- 把邀请码或邀请链接发给同学，他们在欢迎页输入即加入同一张地图
- 修改代码：clone 仓库 → 本地跑起来 → 改 → push；小改动也可以直接在 GitHub 网页上编辑
- 数据存在云端数据库，所有人共享同一份；代码仓库里没有数据

## API 一览

| 方法 | 路径 | 说明 | 邀请码 |
|---|---|---|---|
| POST | /api/maps | 创建地图，返回邀请码 | — |
| GET | /api/maps/:code | 校验邀请码 | — |
| GET | /api/places?map=码 | 地点列表（含照片/留言计数） | query 传入 |
| POST | /api/places | 新增地点 | body `map_code` |
| PUT | /api/places/:id | 编辑地点 | 头 `x-map-code` |
| DELETE | /api/places/:id | 删除地点（级联清理照片留言） | 头 `x-map-code` |
| GET | /api/places/:id/photos?map=码 | 照片列表（含缩略图） | query 传入 |
| POST | /api/places/:id/photos | 上传照片（base64，≤9 张/地点） | body `map_code` |
| GET | /api/photos/:id?map=码 | 照片原图（二进制） | query 传入 |
| DELETE | /api/photos/:id | 删除照片 | 头 `x-map-code` |
| GET | /api/places/:id/comments?map=码 | 留言列表 | query 传入 |
| POST | /api/places/:id/comments | 发表留言（≤280 字） | body `map_code` |
| DELETE | /api/comments/:id | 删除留言 | 头 `x-map-code` |
| POST | /api/places/:id/wish | 「我也想去」投票（切换式） | body `map_code` |
| GET | /api/maps/:code/memories | 回忆时间线（已打卡+缩略图） | — |

地点列表每项附带 `photo_count` / `comment_count` / `wishes`（想去的昵称数组）。

邀请码无效返回 404；前端已自动处理。

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

## 项目结构

```
server/   Express 后端（API + 静态托管）
  app.js        应用装配
  store.js      数据层（静态 SQL + 参数绑定、邀请码生成、生产连接池）
  env.js        dotenv 引导
  routes/       maps / places / photos / comments 路由
  test/         接口测试（node:test + pg-mem）
public/   前端（index.html / css / js，js 含照片客户端压缩）
docs/     设计文档
render.yaml  Render 部署蓝图
```
