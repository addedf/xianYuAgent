# 闲鱼只读采集器接入

## 采用的边界

Web 项目不直接保存闲鱼 Cookie，也不在 Next.js 进程中实现扫码、核身或反爬逻辑。独立本地采集器只负责用户本人登录后的低频搜索；Web 只调用本机 API，并从本机 PostgreSQL 读取新增记录。

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
```

## 3. 由用户本人登录

优先打开官方页面，由用户本人扫码并完成可能出现的核身：

```powershell
python spider.py login --browser
```

登录态保存在采集器自己的 `data/session.json`。不要把该文件复制到 Web 项目，也不要把 Cookie 粘贴到 Web 设置页。

## 4. 只监听本机地址

```powershell
python spider.py --host 127.0.0.1 --port 8000
```

访问 `http://127.0.0.1:8000/docs` 可检查采集器接口。Web 的“连接与控制”页面应显示“闲鱼只读采集器”已连接。

## 5. 导入真实商品

打开 Web 的“连接”页面，在“闲鱼真实数据入口”填写关键词、品类、城市和价格范围，点击“搜索并导入”。流程为：

```text
Web → 本机 /search/ → 采集器写 xianyu_products
    → Web 按 new_record_ids 读取 → 规范化与去重
    → marketplace_listings + assessments → 线索审阅
```

上游当前只提供卖家昵称，没有主页统计、商品描述、票据或序列信息，因此初次导入会保守地标记为“信息不足”，不会自动通知或联系卖家。

## 故障定位

- “只读采集器尚未启用”：检查 `XIANYU_COLLECTOR_ENABLED=true` 并重启 Web。
- “无法连接本机 8000 端口”：确认采集器使用 `127.0.0.1:8000` 启动。
- “无法读取 xianyu_products”：确认采集器安装了 `asyncpg`，并且两个进程指向同一个数据库；或填写 `XIANYU_COLLECTOR_DATABASE_URL`。
- 搜索成功但新增为 0：该链接已经被采集器去重，不会重复导入。
- 登录已过期：回到采集器目录重新执行 `python spider.py login --browser`，不要尝试绕过验证。
