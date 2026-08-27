# 魔都·Explore — 设计文档

日期：2026-08-27
状态：已上线（https://shanghai-wish-map.onrender.com，邀请码多地图模型；2026-08-27 二次迭代：品牌更名「魔都·Explore」+ 霓虹夜行视觉 + 地点照片/留言）

## 1. 背景与目标

一个供同学协作维护的网站：在一张上海地图上标记大家想去的地点，附简短描述与分类，支持"已去过"打卡。任何人可浏览，持有共享口令的同学可增删改。

**成功标准**：

- 打开网页即见上海地图与全部已标记地点
- 通过搜索（如"武康路"）或在地图上点选即可添加地点，填写名称/描述/分类/昵称后保存生效
- 同学在各自设备上打开同一网址，看到同一份数据
- 数据持久保存在云端数据库，服务重启或休眠不丢失

## 2. 架构

```
浏览器（高德地图 JS API 2.0 + 原生 JS 单页，无构建）
        │  fetch /api/*（同源）
        ▼
Express 后端（Node 20+, ESM）
  ├─ REST API：地点 CRUD；写操作需共享口令
  ├─ GET /api/map-config：从环境变量下发高德 key（key 不进 git）
  └─ 托管 public/ 静态文件
        │  pg 连接池（所有 SQL 参数化绑定）
        ▼
Neon 免费托管 Postgres（持久存储）
```

**关键决策与理由**：

| 决策 | 理由 |
|---|---|
| 原生 JS，无框架无打包器 | 项目小、维护者多为学生，仓库干净、克隆即用 |
| Express 同时托管前端 | 单一服务部署，天然同源免 CORS |
| Neon Postgres 而非服务器上的 SQLite | 免费托管平台文件系统不持久；Neon 免费档数据持久、无需信用卡 |
| 高德地图而非 Leaflet+OSM | 国内加载快；GCJ-02 坐标与微信/高德一致；自带 POI 搜索 |
| 高德 key 经后端接口下发 | key 不入库、不进前端仓库；换环境只改环境变量 |
| 共享口令而非账号系统 | 防公网涂改的最小方案；同学间分发口令即可 |

## 3. 数据模型

表 `places`：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | SERIAL PRIMARY KEY | |
| name | TEXT NOT NULL | 地点名 |
| description | TEXT NOT NULL DEFAULT '' | 简短描述 |
| category | TEXT NOT NULL | 枚举：景点/美食/展馆/购物/娱乐/其他 |
| lng | DOUBLE PRECISION NOT NULL | GCJ-02 经度 |
| lat | DOUBLE PRECISION NOT NULL | GCJ-02 纬度 |
| address | TEXT NOT NULL DEFAULT '' | 地址文本 |
| added_by | TEXT NOT NULL DEFAULT '' | 添加人昵称 |
| visited | BOOLEAN NOT NULL DEFAULT FALSE | 已去过打卡 |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

约束：lng ∈ [-180,180]，lat ∈ [-90,90]，由应用层校验；category 由应用层枚举校验。

二次迭代新增（同一 init() 幂等建表，无迁移工具）：

表 `place_photos`：id、place_id、map_code、mime（webp/jpeg/png）、full_b64（展示图 ≤1.5MB）、thumb_b64（缩略图 ≤150KB）、added_by、created_at。每地点最多 9 张；照片在浏览器端 canvas 压缩（长边 1200px/240px，WebP 优先）后以 data URL 上传，Postgres 直接存 base64，不引入对象存储。

表 `place_comments`：id、place_id、map_code、author（≤30 字）、body（1–280 字）、created_at。

删除地点时级联清理其照片与留言；地点列表附带 photo_count / comment_count。

## 4. API

所有 JSON（照片原图接口除外，返回二进制）。鉴权为邀请码模型：读操作通过 query `?map=码`，写操作通过 body `map_code` 或请求头 `x-map-code`，码无效或不匹配一律 404。

- `POST /api/maps` → 201 + `{ code, name, created_by }`
- `GET /api/maps/:code` → 校验邀请码，不存在 404
- `GET /api/places?map=码` → `{ places: [...] }`（含 photo_count / comment_count），按 created_at 降序
- `POST /api/places` → 201 + 新建记录；校验 name 必填、category 枚举、坐标范围
- `PUT /api/places/:id` → 200 + 更新后记录；`PATCH` 语义（未传字段不变）
- `DELETE /api/places/:id` → 204；级联删除照片与留言；不存在 404
- `GET /api/places/:id/photos?map=码` → `{ photos: [{ id, thumb, added_by, created_at }] }`
- `POST /api/places/:id/photos` → 201 + `{ id }`；校验 data URL 格式、体积、每地点 ≤9 张
- `GET /api/photos/:id?map=码` → 照片原图二进制，`Cache-Control: immutable`
- `DELETE /api/photos/:id` → 204
- `GET /api/places/:id/comments?map=码` → `{ comments: [...] }`
- `POST /api/places/:id/comments` → 201 + 留言记录；body 1–280 字
- `DELETE /api/comments/:id` → 204
- `GET /api/map-config` → `{ key, securityJsCode }`
- `GET /api/health` → `{ ok: true }`

错误统一 `{ error: "信息" }`；非法输入 400，未授权/码无效 404，数据库错误 500（不泄露细节）。

## 5. 前端

文件：`public/index.html`、`public/css/style.css`、`public/js/{api,map,app}.js`（ES modules）。

功能：

1. 启动：拉取 map-config → 动态注入高德脚本 → 初始化地图（上海市区视野）→ 拉取地点列表渲染
2. 地图：按分类着色的标记；点击开信息窗（名称/分类/描述/添加人/时间）
3. 侧栏列表 ↔ 地图联动；分类筛选；显示已去过状态
4. 添加：搜索框（AMap PlaceSearch）定位，或"点选模式"直接在地图上取点 → 表单（名称/描述/分类/昵称）→ POST
5. 编辑 / 删除（confirm 确认）/ 打卡切换
6. 口令首次写操作时询问，存 localStorage，可清除重设
7. 移动端：侧栏折叠为可切换面板

## 6. 测试

- 后端：`node:test` + supertest 风格自封装 http 请求，覆盖 CRUD、口令 401、输入校验 400、404；使用独立测试 schema，跑完清理
- 前端：浏览器手动验证核心流程（加载、搜索打标、增删改、移动端布局）

## 7. 部署（概要）

1. Neon 建项目 → `DATABASE_URL`
2. 仓库推 GitHub → Render 建 Web Service（Node，build: `npm install --prefix server`，start 按 Render 文档）→ 配置环境变量 `DATABASE_URL` `ACCESS_CODE` `AMAP_KEY` `AMAP_SECURITY_CODE`
3. 高德控制台把 Render 域名加入 key 白名单（本地开发加 `localhost`）

详细分步操作见 README 部署手册。

## 8. 里程碑

1. 仓库与文档（本文件）→ 提交
2. 后端 API + 测试
3. 前端地图与列表联动
4. 添加/编辑/删除/打卡/筛选
5. 样式打磨、移动端、示例数据
6. 部署手册补全与实际部署（需用户账号）
