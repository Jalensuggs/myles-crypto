#!/usr/bin/env bash
# 部署 / 更新自建服务器上的线上版本：bash scripts/deploy-server.sh
#
# 分工：静态页面交给 Caddy 直接托管（/var/www/crypto），
# 接口（AI 分析、Yahoo 转发）跑在一个很小的 Node 容器里（127.0.0.1:3400）。
#
# 这台服务器对外网很慢，所以一切都在本机编译好再传，服务器上不联网装任何东西。
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=~/.ssh/canvas-helper.pem
DOMAIN=crypto.canvas-myles.me
IP=$(dig +short canvas-myles.me @8.8.8.8 | tail -1)
[ -n "$IP" ] || { echo "查不到服务器 IP"; exit 1; }
REMOTE="root@$IP"
SSH_OPTS=(-i "$KEY" -o ServerAliveInterval=15 -o ServerAliveCountMax=8)
DIR=myles-crypto
WEB=/var/www/crypto
PORT=3400
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "▶ 本机编译页面和接口服务"
npm run build >/dev/null
npm run build:server >/dev/null

echo "▶ 打包"
cp dist-server/server.mjs "$TMP/server.mjs"
COPYFILE_DISABLE=1 tar czf "$TMP/app.tgz" --exclude .DS_Store \
  Dockerfile .dockerignore docker-compose.yml dist \
  -C "$TMP" server.mjs
ls -lh "$TMP/app.tgz" | awk '{print "  包大小:", $5}'

echo "▶ 上传到 $IP（线路不稳，切成小块逐块传）"
# 整包直接 scp 经常传到一半断开，256KB 一块、失败重试才稳
(cd "$TMP" && split -b 256k app.tgz part.)
ssh "${SSH_OPTS[@]}" "$REMOTE" 'rm -rf /tmp/mc-parts && mkdir -p /tmp/mc-parts'
for f in "$TMP"/part.*; do
  for try in 1 2 3 4 5; do
    if scp -q "${SSH_OPTS[@]}" -o ConnectTimeout=15 "$f" "$REMOTE:/tmp/mc-parts/"; then break; fi
    echo "  $(basename "$f") 第 $try 次失败，重试…"
    [ "$try" = 5 ] && { echo "上传失败"; exit 1; }
  done
  printf "."
done
echo
ssh "${SSH_OPTS[@]}" "$REMOTE" 'cat /tmp/mc-parts/part.* > /tmp/myles-crypto.tgz && rm -rf /tmp/mc-parts'
LOCAL_SUM=$(shasum -a 256 "$TMP/app.tgz" | cut -d" " -f1)
REMOTE_SUM=$(ssh "${SSH_OPTS[@]}" "$REMOTE" 'sha256sum /tmp/myles-crypto.tgz' | cut -d" " -f1)
[ "$LOCAL_SUM" = "$REMOTE_SUM" ] || { echo "校验失败，文件不完整"; exit 1; }

echo "▶ 服务器上展开并重启"
ssh "${SSH_OPTS[@]}" "$REMOTE" DIR="$DIR" WEB="$WEB" PORT="$PORT" bash -s <<'REMOTE_SCRIPT'
set -euo pipefail
mkdir -p ~/"$DIR" && cd ~/"$DIR"
rm -rf dist server.mjs
tar xzf /tmp/myles-crypto.tgz && rm /tmp/myles-crypto.tgz

if [ ! -f .env ]; then
  echo "！还没有 .env，接口会以「没配置网关」的状态运行"
fi

# 静态页面放到 Caddy 能读的地方（整个目录换掉，旧文件不留）
rm -rf "${WEB:?}"
mkdir -p "$WEB"
cp -r dist/. "$WEB"/
chmod -R a+rX "$WEB"

if ! docker image inspect node:22-bookworm-slim >/dev/null 2>&1; then
  echo "▶ 拉基础镜像（走 DaoCloud）"
  docker pull -q docker.m.daocloud.io/library/node:22-bookworm-slim
  docker tag docker.m.daocloud.io/library/node:22-bookworm-slim node:22-bookworm-slim
fi

docker compose up -d --build --pull never 2>&1 | tail -3
sleep 4
docker compose ps --format '{{.Name}}  {{.Status}}'
curl -s -o /dev/null -w "接口本机访问: %{http_code}\n" "http://127.0.0.1:$PORT/healthz"
REMOTE_SCRIPT

echo "▶ 验证（Caddy 还没配好时这几项会是 000）"
curl -s -m 20 -o /dev/null -w "  首页: %{http_code}\n" "https://$DOMAIN/" || true
curl -s -m 30 -o /dev/null -w "  模型清单: %{http_code}\n" "https://$DOMAIN/api/ai" || true
curl -s -m 30 -o /dev/null -w "  美股历史: %{http_code}\n" "https://$DOMAIN/yahoo/v8/finance/chart/AAPL?interval=1d&range=1mo" || true
echo "✅ 完成：https://$DOMAIN"
