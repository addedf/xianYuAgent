# 闲鱼只读采集器接入

## 采用的边界

Web 项目不保存闲鱼 Cookie，也不实现核身或反爬逻辑。管理员从 Web 发起登录后，独立本地采集器打开一个可见的闲鱼官方登录窗口；用户只在该官方页面选择短信验证码或扫码，并由本人完成滑块、人脸等平台验证。采集器检测到完整且有效的登录 Cookie 后在自己的私有目录持久化，Web 只轮询不含 Cookie、手机号和验证码的脱敏状态。登录成功后，采集器才执行低频搜索，Web 再从本机 PostgreSQL 读取新增记录。

当前适配器参考 `superboyyy/xianyu_spider` 的数据契约：

- `POST /search/`：触发关键词、价格、地区和最新排序搜索，返回 `new_record_ids`。
- `xianyu_products` 表：按新增 ID 读取标题、价格、地区、卖家昵称、链接、图片与发布时间。

没有复制上游的签名、登录或抓取实现。Web 发起官方窗口登录属于本项目平台适配器的本机能力，不把未实现的短信直连接口当作上游公开契约。

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

## 3. 由用户本人在官方窗口登录

先启动 Web 和采集器，再打开 Web 的“连接与控制 → 闲鱼账号连接”。第一版统一采用以下流程：

1. 管理员在 Web 点击“打开闲鱼官方登录窗口”。
2. Web 通过带服务令牌的本机请求让采集器启动一个可见的 Chromium 窗口。
3. 用户在闲鱼官方页面自行选择短信验证码或扫码。手机号、短信验证码只输入官方页面，不经过 Web，也不由本项目代发或代填。
4. 如果官方页面要求滑块、人脸或其它安全验证，用户在同一窗口按平台提示完成；项目不会自动处理或绕过风控。
5. 采集器在后台检查官方登录 Cookie 是否完整，并再次验证账号登录态。验证成功后，采集器持久化登录态并关闭临时窗口；Web 只轮询“正在打开、等待用户、已登录、已取消、已超时或失败”等脱敏状态。

同一时间只应存在一个登录会话。Web 必须提供取消操作；用户取消或等待超时后，采集器应关闭浏览器上下文、清理临时 profile 和未完成的会话状态，不能把半套 Cookie 当作成功结果。重新登录时从 Web 发起一个新会话即可。

命令行官方页面登录仍可作为本机备用方式：

```powershell
python spider.py login --browser
```

登录态保存在采集器自己的 `data/session.json`。该文件与 Cookie 都不得复制到 Web 项目、日志、测试夹具或聊天中，也不要在 Web 设置页提供粘贴 Cookie 的入口。

## 4. 只监听本机地址

```powershell
Set-Location -LiteralPath 'D:\A-projeck\xianYuAgent\.local\xianyu_spider'
& '.\.venv\Scripts\python.exe' '.\spider.py' serve --host 127.0.0.1 --port 8000
```

访问 `http://127.0.0.1:8000/docs` 可检查采集器接口。Web 的“连接与控制”页面应显示“闲鱼只读采集器”已连接。

不要把监听地址改为 `0.0.0.0`，也不要通过端口转发、反向代理或公网隧道暴露采集器。Web 发往登录、状态、取消、退出和搜索接口的请求都必须携带 `XIANYU_COLLECTOR_API_TOKEN`，采集器必须实际校验该令牌并对缺失或错误的请求拒绝访问；仅在两份 `.env` 中填写相同值并不等于已经完成鉴权。

`.local/xianyu_spider` 被主仓库忽略，只是单机技术验证目录，其中的本地改动不会随主仓库提交、部署或审计。若当前本机副本尚未实现服务令牌校验，必须把 `127.0.0.1` 视为临时且唯一的隔离边界。正式使用前应把官方窗口登录、令牌校验、取消/超时、审计和测试迁移到自有且经过许可证与安全审计的平台适配器中。

## 5. 导入真实商品

打开 Web 的“连接”页面，在“闲鱼真实数据入口”填写关键词、品类、城市和价格范围，点击“搜索并导入”。流程为：

```text
管理员浏览器 → Web 发起登录（服务令牌）→ 本机采集器打开闲鱼官方窗口
    → 用户在官方页选择短信/扫码并完成人工风控
    → 采集器校验并持久化 Cookie → Web 轮询脱敏登录状态
Web → 本机 /search/（服务令牌）→ 采集器写 xianyu_products
    → Web 按 new_record_ids 读取 → 规范化与去重
    → marketplace_listings + assessments → 线索审阅
```

上游当前只提供卖家昵称，没有稳定的卖家主页 ID、主页完整商品列表或已售件数，也没有商品描述、票据或序列信息。系统只能按本地已采集且仍在架的记录统计同一卖家的品类数量：观察到同品类商品至少 6 条时标记“疑似非个人卖家”并下调个人卖家分；该数量受关键词与采集范围影响，不代表其完整主页。只有将来取得可信且明确的已售件数字段时，才会按超过 100 件触发该规则；未知不会当作 0。缺少商品证据时评分仍会提示信息不足，不会自动通知或联系卖家。

## 故障定位

- “只读采集器尚未启用”：检查 `XIANYU_COLLECTOR_ENABLED=true` 并重启 Web。
- “无法连接本机 8000 端口”：确认采集器使用 `127.0.0.1:8000` 启动。
- “无法读取 xianyu_products”：确认采集器安装了 `asyncpg`，并且两个进程指向同一个数据库；或填写 `XIANYU_COLLECTOR_DATABASE_URL`。
- 搜索成功但新增为 0：该链接已经被采集器去重，不会重复导入。
- 点击登录但没有弹出窗口：确认采集器运行在当前有桌面会话的电脑上，并已安装 Playwright Chromium；不要把采集器放到无桌面的远程主机上执行此流程。
- 验证码收不到：手机号和发送按钮都在闲鱼官方窗口内操作；按官方页面提示重试，并检查是否需要先完成人工安全验证，Web 不负责发送验证码。
- Web 显示“已取消”或“已超时”：确认旧窗口已经关闭，再从 Web 新建登录会话；不要复用旧会话或残留 Cookie。
- 登录已过期：优先从 Web 重新打开官方登录窗口；命令行备用方式为 `python spider.py login --browser`，不要尝试绕过验证。
