# Windows 本地启动指南

本文记录日常启动闲鱼采集器和 Web 管理端所需的命令。两个服务需要分别占用一个 PowerShell 窗口，并在使用期间保持运行。

## macOS 本机真实模式

本仓库在 macOS 上使用项目目录下的本地服务进程，真实模式不使用演示数据。

一键方式：`scripts/dev-mac.sh` 按下述顺序启动全部服务（已运行的自动跳过），并支持查看与停止：

```bash
scripts/dev-mac.sh start    # 启动 PostgreSQL、Redis、迁移、采集器、worker、Web
scripts/dev-mac.sh status   # 查看各服务状态
scripts/dev-mac.sh stop     # 停止采集器、worker、Web（PostgreSQL/Redis 保持运行）
```

以下为各步骤的手动命令，用于单独重启某个服务。

首次准备完成后，每次启动按下面顺序打开四个终端窗口；所有服务只监听回环地址。

### 1. 启动 PostgreSQL 与 Redis

```bash
cd /Users/ricardo/Documents/A-project/xianYuAgent

# PostgreSQL（首次准备时已 initdb；不要重复执行 initdb）
.local/services/postgres/bin/pg_ctl \
  -D .local/services/data/postgres \
  -l .local/runtime/postgres.log \
  -o "-p 5432 -h 127.0.0.1" start

# Redis（密码保存在 Git 忽略的 .local/runtime/redis-pass）
.local/services/redis/bin/redis-server .local/runtime/redis.conf --daemonize yes
```

如果服务已经运行，先用 `lsof -nP -iTCP:5432,6379 -sTCP:LISTEN` 检查，不要重复启动。

### 2. 迁移 Web 数据库

```bash
cd /Users/ricardo/Documents/A-project/xianYuAgent
pnpm --dir apps/web db:migrate
```

真实配置位于 Git 忽略的 `apps/web/.env.local`，其中应满足：

```dotenv
APP_DEMO_MODE=false
DATABASE_URL=postgresql://xianyu@127.0.0.1:5432/xianyu_agent
REDIS_URL=redis://:本机Redis密码@127.0.0.1:6379/0
XIANYU_COLLECTOR_ENABLED=true
XIANYU_COLLECTOR_URL=http://127.0.0.1:8000
XIANYU_COLLECTOR_DATABASE_URL=postgresql://xianyu@127.0.0.1:5432/xianyu_agent
OUTBOUND_MESSAGING_ENABLED=false
```

### 3. 启动闲鱼采集器

```bash
cd /Users/ricardo/Documents/A-project/xianYuAgent/.local/xianyu_spider
DATABASE_URL='postgresql://xianyu@127.0.0.1:5432/xianyu_agent' \
XIANYU_COLLECTOR_API_TOKEN="$(sed -n 's/^XIANYU_COLLECTOR_API_TOKEN=//p' ../../apps/web/.env.local)" \
.venv/bin/python spider.py serve --host 127.0.0.1 --port 8000
```

打开 `http://127.0.0.1:8000/docs` 可检查接口。采集器已启用 `x-xianyu-service-token` 校验，不能省略该请求头。

### 4. 启动 Web 与后台 worker

分别在两个终端执行：

```bash
cd /Users/ricardo/Documents/A-project/xianYuAgent
pnpm dev
```

```bash
cd /Users/ricardo/Documents/A-project/xianYuAgent
pnpm worker
```

浏览器访问 `http://127.0.0.1:3000/login`，管理员密码从 `apps/web/.env.local` 读取。登录后进入“连接与控制”，再在闲鱼官方窗口本人完成扫码、短信或平台要求的安全验证。

### 5. 停止服务

Web、worker 和采集器所在终端按 `Ctrl+C`；PostgreSQL 使用：

```bash
cd /Users/ricardo/Documents/A-project/xianYuAgent
.local/services/postgres/bin/pg_ctl -D .local/services/data/postgres stop
```

Redis 使用：

```bash
.local/services/redis/bin/redis-cli -h 127.0.0.1 -a "$(cat /Users/ricardo/Documents/A-project/xianYuAgent/.local/runtime/redis-pass)" shutdown
```

## 启动前确认

- 项目目录：`D:\A-projeck\xianYuAgent`
- 采集器目录：`D:\A-projeck\xianYuAgent\.local\xianyu_spider`
- 采集器配置：`.local\xianyu_spider\.env`
- Web 配置：`apps\web\.env.local`
- Web 与采集器的 `XIANYU_COLLECTOR_API_TOKEN` 必须一致。
- 本指南中的 `.local\xianyu_spider` 只用于当前电脑上的 PoC，不是已版本化、可公网部署的正式采集服务。

配置文件包含密码和服务令牌，不要提交到 Git，也不要复制到聊天或日志中。

## 第一步：启动闲鱼采集器

打开第一个 PowerShell 窗口，执行：

```powershell
Set-Location -LiteralPath 'D:\A-projeck\xianYuAgent\.local\xianyu_spider'

& '.\.venv\Scripts\python.exe' '.\spider.py' serve --host 127.0.0.1 --port 8000
```

出现以下内容表示启动成功：

```text
Uvicorn running on http://127.0.0.1:8000
```

采集器根地址 `http://127.0.0.1:8000/` 返回 `404 Not Found` 是正常现象，因为根路径没有网页。不要关闭这个 PowerShell 窗口。

必须保留 `--host 127.0.0.1`。不要改为 `0.0.0.0`，也不要通过端口转发、反向代理或公网隧道暴露采集器。服务令牌必须由采集器实际校验；如果当前 `.local` 副本还只是读取了配置、尚未校验请求头，则它仍是依赖回环地址隔离的未加固 PoC。

## 第二步：启动 Web 管理端

打开第二个 PowerShell 窗口，执行：

```powershell
Set-Location -LiteralPath 'D:\A-projeck\xianYuAgent'

powershell -NoProfile -ExecutionPolicy Bypass -File '.\scripts\dev.ps1'
```

出现 `Ready` 和以下地址表示启动成功：

```text
http://127.0.0.1:3000
```

## 第三步：登录和获取闲鱼商品

1. 浏览器打开 `http://127.0.0.1:3000/login`。
2. 管理员密码查看 `apps\web\.env.local` 中的 `ADMIN_PASSWORD`，不要把密码填写到闲鱼登录页。
3. 登录 Web 后进入“连接与控制”。
4. 如果闲鱼登录状态无效，点击“打开闲鱼官方登录窗口”。采集器会在本机启动可见 Chromium。
5. 只在弹出的闲鱼官方页面选择短信验证码或扫码，并由本人完成滑块、人脸等平台验证。手机号和验证码不填写到 Web，也不经过 Web 或采集器接口。
6. 保持 Web 页面打开；Web 会轮询脱敏状态。采集器检测并验证完整 Cookie 后在自己的 `data/session.json` 中保存登录态，Web 不保存或回显 Cookie。
7. 登录状态有效后，在真实数据入口填写关键词等条件并发起搜索；结果来自本机采集器的实时闲鱼请求，不使用演示数据代替。

登录过程中可在 Web 取消。取消或等待超时后，采集器应关闭官方窗口并清理临时登录状态；确认旧窗口关闭后，再从 Web 发起新会话，不要复用旧会话。

## 停止服务

分别切换到两个运行服务的 PowerShell 窗口，按 `Ctrl+C`。看到终止提示后即可关闭窗口。

## 常见问题

### 无法识别 Python 路径

虚拟环境位于采集器目录内部，正确路径是：

```text
D:\A-projeck\xianYuAgent\.local\xianyu_spider\.venv\Scripts\python.exe
```

进入采集器目录后应使用 `.\.venv\Scripts\python.exe`，不要使用 `..\.venv\Scripts\python.exe`。

### 8000 或 3000 端口已被占用

先确认是否已经启动过服务：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8000,3000 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

如果已经有正确的服务在监听，不要重复启动。需要停止旧进程时，优先回到原来的 PowerShell 窗口按 `Ctrl+C`。

### Web 能打开但采集器未连接

- 确认第一个 PowerShell 窗口仍在运行。
- 确认采集器监听的是 `127.0.0.1:8000`。
- 确认两个 `.env` 文件中的 `XIANYU_COLLECTOR_API_TOKEN` 完全一致。
- 确认采集器确实校验 Web 发送的服务令牌；令牌缺失或错误时应拒绝请求，而不是继续执行登录或搜索。
- 修改配置文件后，需要停止并重新启动对应服务。

### 点击登录但没有出现官方窗口

- 确认采集器运行在当前登录的 Windows 桌面会话，而不是无桌面的远程服务会话。
- 确认已经在采集器虚拟环境安装 Playwright，并执行过 `python -m playwright install chromium`。
- 如果上一次登录已取消或超时，先确认旧 Chromium 窗口已经关闭，再从 Web 发起新登录。

### 闲鱼搜索要求平台验证

这是闲鱼官方的账号验证流程。回到“连接与控制”重新打开官方登录窗口，在该窗口按页面提示选择短信验证码或扫码并完成人工验证；本项目不会代填验证码，也不会绕过滑块、人脸或平台风控。
