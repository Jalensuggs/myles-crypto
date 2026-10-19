# 接口服务（AI 分析和 Yahoo 转发）。静态页面不在这里，由 Caddy 直接托管。
#
# 基础镜像由 scripts/deploy-server.sh 先从 docker.m.daocloud.io 拉下来再打成这个名字
# ——这台服务器连 Docker Hub 很慢。构建过程只有 COPY，不联网。
FROM node:22-bookworm-slim
WORKDIR /app
COPY server.mjs ./
ENV NODE_ENV=production
ENV PORT=3400
EXPOSE 3400
CMD ["node", "server.mjs"]
