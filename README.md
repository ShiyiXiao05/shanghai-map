# 上海地点收藏地图 🗺️

和同学一起在地图上标记想去的上海地点：搜索定位、添加描述、分类管理、去过后打卡。

## 功能

- 上海地图（高德）展示所有标记地点，按分类着色
- 搜索地点名（如"武康路"）直接定位打标，或在地图上点选取点
- 每个地点：名称、描述、分类（景点/美食/展馆/购物/娱乐/其他）、添加人昵称、时间
- "已去过"打卡、分类筛选、地点列表与地图联动
- 浏览无需口令；添加/编辑/删除需共享口令（防止公网上被乱改）

## 技术栈

- 前端：原生 HTML/CSS/JS + 高德地图 JS API 2.0（无构建，克隆即用）
- 后端：Node.js + Express，`pg` 连接池，所有 SQL 参数化查询
- 数据库：Neon 免费托管 Postgres（数据持久保存）
- 部署：Render 免费 Web Service（后端同时托管前端静态页）

## 本地开发

前置：Node.js ≥ 20，并准备两个免费账号的 key（见下方"准备工作"）。

```bash
git clone <仓库地址> && cd Shanghai
cp .env.example .env   # 编辑 .env 填入真实值
npm --prefix server install
npm --prefix server run dev
# 打开 http://localhost:3000
```

### 准备工作（一次性，约 10 分钟）

1. **数据库**：注册 [Neon](https://console.neon.tech)（免费、无需信用卡）→ 创建项目 → 复制 Connection string 填入 `.env` 的 `DATABASE_URL`
2. **地图 key**：注册 [高德开放平台](https://console.amap.com)（需阿里云/淘宝账号）→ 创建应用 → 添加 Key，服务平台选 **Web端(JS API)** → 得到 key 与安全密钥，填入 `.env` 的 `AMAP_KEY`、`AMAP_SECURITY_CODE`；在 key 的域名白名单里加上 `localhost`
3. **共享口令**：自定一个口令填入 `ACCESS_CODE`，告诉同学们

## 和同学协作

- 使用网站：打开网址，输入共享口令即可添加地点
- 修改代码：clone 仓库 → 本地跑起来 → 改 → push；小改动也可以直接在 GitHub 网页上编辑
- 数据存在云端数据库，所有人共享同一份；代码仓库里没有数据

## API 一览

| 方法 | 路径 | 说明 | 口令 |
|---|---|---|---|
| GET | /api/places | 地点列表 | 不需要 |
| POST | /api/places | 新增地点 | 需要 |
| PUT | /api/places/:id | 编辑地点 | 需要 |
| DELETE | /api/places/:id | 删除地点 | 需要 |

写操作在请求头携带 `X-Access-Code: <口令>`。前端已自动处理。

## 部署手册

把网站发布到公网（免费），让同学直接用网址访问：

### 第 1 步：推送到 GitHub

```bash
git remote add origin git@github.com:<你的用户名>/shanghai-map.git
git push -u origin main
```

### 第 2 步：Render 部署后端

1. 注册/登录 [Render](https://render.com)（GitHub 账号即可，免费档无需信用卡）
2. New → **Web Service** → 连接上面的 GitHub 仓库
3. 配置：
   - Root Directory：`server`
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Instance Type：Free
4. Environment 中添加 4 个变量（与 `.env` 相同）：`DATABASE_URL`、`ACCESS_CODE`、`AMAP_KEY`、`AMAP_SECURITY_CODE`
5. 创建后等待部署完成，得到形如 `https://xxx.onrender.com` 的网址

> 免费档服务 15 分钟无访问会休眠，下次首访约需 30–60 秒唤醒，属正常现象。

### 第 3 步：高德 key 域名白名单

到高德控制台，编辑你的 Key，把 Render 域名（如 `xxx.onrender.com`）加入白名单，保存。本地开发用的 `localhost` 保留即可。

### 第 4 步：分享

把 `https://xxx.onrender.com` 和共享口令发给同学即可。

## 项目结构

```
server/   Express 后端（API + 静态托管）
public/   前端（index.html / css / js）
docs/     设计文档
```
