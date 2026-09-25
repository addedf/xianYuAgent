#!/usr/bin/env bash
# macOS 一键启动/查看/停止本机服务：PostgreSQL、Redis、Web、worker、闲鱼采集器。
# 用法：scripts/dev-mac.sh [start|status|stop]，默认 start。
# 令牌与连接串在运行时从 Git 忽略的 .env.local / .local 读取，本脚本不保存任何凭据。

set -u

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$PROJECT_ROOT/.local/runtime"
SPIDER_DIR="$PROJECT_ROOT/.local/xianyu_spider"
WEB_DIR="$PROJECT_ROOT/apps/web"

cd "$PROJECT_ROOT"

port_pid() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | sort -u
}

worker_pids() {
  pgrep -f "scripts/worker\.ts" 2>/dev/null
}

start_postgres() {
  if [ -n "$(port_pid 5432)" ]; then
    echo "PostgreSQL 已在运行（端口 5432）"
    return 0
  fi
  echo "启动 PostgreSQL…"
  "$PROJECT_ROOT/.local/services/postgres/bin/pg_ctl" \
    -D "$PROJECT_ROOT/.local/services/data/postgres" \
    -l "$RUNTIME_DIR/postgres.log" \
    -o "-p 5432 -h 127.0.0.1" start
}

start_redis() {
  if [ -n "$(port_pid 6379)" ]; then
    echo "Redis 已在运行（端口 6379）"
    return 0
  fi
  echo "启动 Redis…"
  "$PROJECT_ROOT/.local/services/redis/bin/redis-server" \
    "$RUNTIME_DIR/redis.conf" --daemonize yes
}

start_collector() {
  if [ -n "$(port_pid 8000)" ]; then
    echo "闲鱼采集器已在运行（端口 8000）"
    return 0
  fi
  if [ ! -x "$SPIDER_DIR/.venv/bin/python" ]; then
    echo "未找到采集器虚拟环境：$SPIDER_DIR/.venv，请先按 docs/XIANYU_COLLECTOR.md 准备。"
    return 1
  fi
  local token
  token="$(sed -n 's/^XIANYU_COLLECTOR_API_TOKEN=//p' "$WEB_DIR/.env.local")"
  if [ -z "$token" ]; then
    echo "apps/web/.env.local 中没有 XIANYU_COLLECTOR_API_TOKEN，无法启动采集器。"
    return 1
  fi
  echo "启动闲鱼采集器（端口 8000）…"
  (cd "$SPIDER_DIR" && \
    DATABASE_URL='postgresql://xianyu@127.0.0.1:5432/xianyu_agent' \
    XIANYU_COLLECTOR_API_TOKEN="$token" \
    nohup .venv/bin/python spider.py serve --host 127.0.0.1 --port 8000 \
      >> "$RUNTIME_DIR/collector.log" 2>&1 &)
}

start_worker() {
  if [ -n "$(worker_pids)" ]; then
    echo "后台 worker 已在运行"
    return 0
  fi
  echo "启动后台 worker…"
  nohup pnpm --dir "$WEB_DIR" worker >> "$RUNTIME_DIR/web-worker.log" 2>&1 &
}

start_web() {
  if [ -n "$(port_pid 3000)" ]; then
    echo "Web 管理端已在运行（端口 3000）"
    return 0
  fi
  echo "启动 Web 管理端（端口 3000）…"
  nohup pnpm --dir "$WEB_DIR" dev >> "$RUNTIME_DIR/web-dev.log" 2>&1 &
}

cmd_start() {
  start_postgres || return 1
  start_redis || return 1
  echo "应用数据库迁移…"
  pnpm --dir "$WEB_DIR" db:migrate >/dev/null 2>&1 || echo "警告：db:migrate 失败，详情请手动运行查看。"
  start_collector
  start_worker
  start_web
  sleep 2
  cmd_status
}

cmd_status() {
  echo "---- 服务状态 ----"
  check "PostgreSQL" 5432
  check "Redis" 6379
  check "Web 管理端" 3000
  check "闲鱼采集器" 8000
  if [ -n "$(worker_pids)" ]; then
    echo "后台 worker      : 运行中"
  else
    echo "后台 worker      : 未运行"
  fi
  echo "Web 地址: http://127.0.0.1:3000/login"
}

check() {
  if [ -n "$(port_pid "$2")" ]; then
    echo "$1: 运行中（端口 $2）"
  else
    echo "$1: 未运行"
  fi
}

cmd_stop() {
  local pid
  for pid in $(port_pid 8000); do kill "$pid" && echo "已停止闲鱼采集器（PID $pid）"; done
  for pid in $(worker_pids); do kill "$pid" && echo "已停止后台 worker（PID $pid）"; done
  for pid in $(port_pid 3000); do kill "$pid" && echo "已停止 Web 管理端（PID $pid）"; done
  echo "PostgreSQL/Redis 保持运行；如需停止请按 docs/STARTUP.md 的停止命令执行。"
}

case "${1:-start}" in
  start) cmd_start ;;
  status) cmd_status ;;
  stop) cmd_stop ;;
  *) echo "用法：$0 [start|status|stop]"; exit 1 ;;
esac
