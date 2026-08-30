# 闲鱼只读采集器接入

## 采用的边界

Web 项目不保存闲鱼 Cookie 或 Token，也不实现核身或反爬逻辑。独立本地采集器负责通过闲鱼官方页面完成二维码/短信登录和用户本人登录后的低频搜索；Web 只代理经过管理员鉴权的登录操作、调用本机 API，并从本机 PostgreSQL 读取新增记录。

当前适配器兼容 `superboyyy/xianyu_spider` 的两个公开契约：

- `POST /search/`：触发关键词、价格、地区和最新排序搜索，返回 `new_record_ids`。
- `xianyu_products` 表：按新增 ID 读取标题、价格、地区、卖家昵称、链接、图片与发布时间。

没有复制上游的签名、登录或抓取实现。

## 使用前注意

该仓库 README 声称 MIT，但当前根目录没有可核验的 `LICENSE` 文件，同时 README 写明抓取结果不得用于商业用途。二奢回收属于商业场景，因此该仓库只适合本机技术验证。正式使用前应取得作者许可，或换成闲鱼授权/允许的数据入口，并自行核对平台规则与适用法律。

不要配置代理池、验证码绕过、多账号轮换或高并发请求。本项目把单次页数限制为 1–3 页，默认只允许手动触发。

## 1. 准备 PostgreSQL

创建 `xianyu_agent` 数据库，并准备一个只能访问该数据库的本地账号。Web 和采集器可以使用同一个数据库，也可以使用同一台 PostgreSQL 上的两个数据库。

Web 的 `apps/web/.env.local`：

```dotenv
APP_DEMO_MODE=false
DATABASE_URL=postgresql://本地用户:本地密码@127.0.0.1:5432/xianyu_agent
XIANYU_COLLECTOR_ENABLED=true
XIANYU_COLLECTOR_URL=http://127.0.0.1:8000
XIANYU_COLLECTOR_API_TOKEN=请生成至少32位随机服务令牌
# 使用同一个数据库时保持为空
XIANYU_COLLECTOR_DATABASE_URL=
OUTBOUND_MESSAGING_ENABLED=false
```

然后在 `apps/web` 运行：

```powershell
pnpm db:migrate
```

## 2. 独立准备采集器

当前电脑已检测到 Python 3.13。可以先尝试使用；如果上游依赖安装失败，再改用兼容性更稳妥的 Python 3.11 或 3.12。建议把采集器放在本项目已忽略的 `.local` 目录，避免会话文件进入仓库：

```powershell
git clone https://github.com/superboyyy/xianyu_spider.git D:\A-projeck\xianYuAgent\.local\xianyu_spider
cd D:\A-projeck\xianYuAgent\.local\xianyu_spider
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pip install asyncpg
python -m playwright install chromium
```

在采集器自己的 `.env` 中填写同一座本机 PostgreSQL。不要提交该文件：

```dotenv
DATABASE_URL=postgresql://本地用户:本地密码@127.0.0.1:5432/xianyu_agent
XIANYU_COLLECTOR_API_TOKEN=与Web端完全一致的随机服务令牌
```

## 3. 由用户本人登录

先启动 Web 和采集器，再打开 Web 的“连接与控制 → 闲鱼账号连接”。当前提供两种入口：

- 扫码登录：生成二维码后每 2 秒串行轮询状态；普通状态轮询不会再清空当前二维码。
- 验证码登录：填写中国大陆手机号并发送验证码，采集器会打开可见的闲鱼官方登录窗口；收到短信后在 Web 输入验证码。如官方页出现滑块、人脸或其它安全验证，必须由用户在该窗口正常完成。

手机号和验证码只在这次登录请求中转交给本机采集器，不写数据库、不写普通日志，也不会出现在接口响应。短信发送有 60 秒本机频率限制，登录会话 10 分钟过期。项目不会绕过闲鱼官方验证。

命令行官方页面登录仍可作为本机备用方式：

```powershell
python spider.py login --browser
```

登录态保存在采集器自己的 `data/session.json`。不要把该文件复制到 Web 项目，也不要把 Cookie 粘贴到 Web 设置页。

## 4. 只监听本机地址

```powershell
Set-Location -LiteralPath 'D:\A-projeck\xianYuAgent\.local\xianyu_spider'
& '.\.venv\Scripts\python.exe' '.\spider.py' serve --host 127.0.0.1 --port 8000
```

访问 `http://127.0.0.1:8000/docs` 可检查采集器接口。Web 的“连接与控制”页面应显示“闲鱼只读采集器”已连接。

## 5. 导入真实商品

打开 Web 的“连接”页面，在“闲鱼真实数据入口”填写关键词、品类、城市和价格范围，点击“搜索并导入”。流程为：

```text
管理员浏览器 → Web 脱敏登录代理 → 本机 /auth/*（服务令牌）
Web → 本机 /search/（服务令牌）→ 采集器写 xianyu_products
    → Web 按 new_record_ids 读取 → 规范化与去重
    → marketplace_listings + assessments → 线索审阅
```

上游当前只提供卖家昵称，没有主页统计、商品描述、票据或序列信息，因此初次导入会保守地标记为“信息不足”，不会自动通知或联系卖家。

## 故障定位

- “只读采集器尚未启用”：检查 `XIANYU_COLLECTOR_ENABLED=true` 并重启 Web。
- “无法连接本机 8000 端口”：确认采集器使用 `127.0.0.1:8000` 启动。
- “无法读取 xianyu_products”：确认采集器安装了 `asyncpg`，并且两个进程指向同一个数据库；或填写 `XIANYU_COLLECTOR_DATABASE_URL`。
- 搜索成功但新增为 0：该链接已经被采集器去重，不会重复导入。
- 二维码闪现后空白：确认 Web 已重启到最新代码；当前实现会保留同一扫码会话的原二维码，并在过期、取消、成功或额外验证时正确清理/替换。
- 验证码收不到：等待 60 秒后重试，并检查弹出的闲鱼官方窗口是否要求先完成安全验证。
- 登录已过期：回到采集器目录重新执行 `python spider.py login --browser`，不要尝试绕过验证。
