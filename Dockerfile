# 微信云托管镜像：构建上下文为仓库根目录（GitHub 绑定构建默认根上下文）
# Render 不使用本文件（render.yaml 指定 rootDir: server + runtime: node）
FROM node:20-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
# index.js 以 ../public 相对路径服务静态网页，保持仓库目录结构
COPY public/ /app/public/
USER node
EXPOSE 3000
CMD ["node", "index.js"]
