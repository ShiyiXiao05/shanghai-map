# 魔都·Explore 微信小程序（体验版）

与网页版共用同一个后端（[项目根目录](../README.md)），数据实时互通。

## 当前状态

- ✅ 已完成：地图主页（原生 map 组件 + 分类圆点标记 + 底部列表/筛选/排序/下拉刷新）、创建/加入地图（邀请码大字展示与复制、多地图切换）、地点详情（照片九宫格/预览/上传/删除、留言、想去、打卡、公开、编辑、删除）、深浅双主题（跟随系统）、微信分享（携带地图邀请码直达）
- 🚧 下一迭代：搜索与吸附选点（腾讯位置服务）、回忆时间线、分享海报、高德链接导入、行程单
- 配置：`utils/config.js` 填 `TMAP_KEY`（lbs.qq.com，WebServiceAPI + 小程序授权）

## 如何预览

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版）
2. 导入本项目：选择 `miniprogram/` 目录；AppID 用「测试号」（注册正式 AppID 后替换 `project.config.json` 里的 `touristappid`）
3. 详情 → 本地设置 → 勾选**「不校验合法域名」**（体验版阶段直连 Render 后端必须勾）
4. 编译预览；真机调试扫预览二维码即可（同样需在手机端打开调试模式）
5. 给同学用：工具栏「预览」生成二维码 → 手机扫码为开发版；正式体验版需在 mp.weixin.qq.com 上传代码并设为体验版，添加同学为体验成员（≤90 人）

## 结构

```
app.js/json/wxss     全局会话（地图切换）、双主题令牌、页面注册
theme.json           darkmode 导航栏配色
utils/config.js      后端地址 / 腾讯位置 key / 分类元数据
utils/api.js         与网页版对齐的全部 API（wx.request）
utils/storage.js     与网页版同名的本地存储键
pages/index          地图主页
pages/entry          创建/加入/切换地图、邀请码分享
pages/detail         地点详情（照片/留言/想去/打卡/编辑/删除）
pages/search|memories|poster|import   占位，下一迭代补齐
```
