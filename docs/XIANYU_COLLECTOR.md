# 闲鱼只读采集器接入

## 采用的边界

Web 项目不保存闲鱼 Cookie，也不实现核身或反爬逻辑。管理员从 Web 发起登录后，独立本地采集器打开一个可见的闲鱼官方登录窗口；用户只在该官方页面选择短信验证码或扫码，并由本人完成滑块、人脸等平台验证。采集器检测到完整且有效的登录 Cookie 后在自己的私有目录持久化，Web 只轮询不含 Cookie、手机号和验证码的脱敏状态。登录成功后，采集器才执行低频搜索，Web 再从本机 PostgreSQL 读取新增记录。

当前适配器参考 `superboyyy/xianyu_spider` 的数据契约：

- `POST /search/`：触发关键词、价格、地区和最新排序搜索，返回 `new_record_ids`，以及详情/主页补抓审计计数（`enriched_details`、`seller_profiles`）。
- `xianyu_products` 表：按新增 ID 读取标题、价格、地区、卖家昵称、链接、图片、发布时间，以及详情补抓列 `detail_json`（详情原始 JSON）、`detail_fetched_at`、`seller_user_id`（卖家平台用户 ID）。
- `xianyu_seller_profiles` 表：按 `seller_user_id` 关联卖家主页快照，`profile_json` 汇总卖出件数、在售件数、信用等级、注册时长与在售分类分布，`head_json`/`items_json` 保留原始响应。

### 详情与主页补抓（2026-09 新增，2026-09-26 收紧）

搜索保存后，采集器对**库里还没有可用详情的记录**补抓商品详情页，对新卖家补抓卖家主页（头部 + 在售第一页），使 Web 端能够以稳定卖家 ID 和主页统计执行“非个人卖家”判定。限频与暂停边界：

- **导入层硬筛 v2（2026-09-26 重构，列表观察积累方案）**：搜索结果在入库与详情补抓**之前**执行统一流程——①「卖家已排除」拦截：命中统一排除记录 `xianyu_seller_exclusions` 的卖家商品全部拦截，只更新 `hit_count` 命中计数；②「商品忽略」拦截：命中 `xianyu_listing_handling`（ignored）的商品不再处理，同一卖家其他新货继续筛选；③**观察索引累计**：其余结果全部 upsert 到 `xianyu_listing_observations`（按平台商品唯一 ID 去重，跨关键词/跨轮次只计一件，`first_seen_at` 不重置）；④**跨轮自动排除**：按观察索引统计卖家「不同商品数」，达到共享规则 `seller-observation-frequency`（当前 v1，阈值 3；读不到回退 `XIANYU_COLLECTOR_SELLER_BLOCK_THRESHOLD`）即写入排除记录（source=auto-rule，含证据摘要与规则版本），**并在本批次立即生效**；⑤高仿词商品逐条留痕 `xianyu_import_skips` 不导入（词表读 `listing-counterfeit-terms` 规则）。
- **统一排除记录（`xianyu_seller_exclusions`）**：人工拉黑与自动排除的唯一权威状态，采集器与 Web 共用。`source` 区分 manual/auto-rule（分别留痕，模型不产生排除）；`identity_type` 区分 stable / nickname-area / anonymous——搜索列表层只有「昵称+地区」弱身份，**匿名占位永不自动排除**；详情补到平台稳定 ID 后自动补建稳定身份排除（改昵称后黑名单仍生效）。撤销=记录事件（status=revoked + `userRevoked` 标记），自动规则不会原样复活用户撤销过的行；Web「排除管理」页可撤销。**排除服务不可用时本轮整体暂停导入（fail-closed），不做静默放行。**
- **已售数硬筛（第二道闸）**：详情补抓**之后**，解析详情卖家卡片的已售件数（`sellerDO.hasSoldNumInteger`），**超过 30 件**（`XIANYU_COLLECTOR_SELLER_SOLD_MAX`）的整条剔除并写统一排除记录（reason=sold-count），不进 Web。没有详情数据的候选本轮不判，等下轮补抓后再判。注意：详情接口被 RGV587 风控拦截时拿不到已售数，该闸失效——此时可在 Web「线索审阅」页人工拉黑，或立查 `xianyu_seller_exclusions` 插行（source=manual）。
- **重复标题硬筛（第三道闸）**：入库前检测**跨卖家重复标题**——同一归一化标题（去空白/尾部括号注记/结尾标点，取前 24 字）出现 ≥2 个「昵称+地区」，或与库内其他卖家的标题前缀相同 → 整簇剔除并写排除记录（reason=dup-title）。这是同行矩阵号（盗图/转发/多账号）的强信号，纯搜索层数据，**详情被风控拦截时依然有效**。同卖家重复挂不同链接不算矩阵。
- **被拦记录不进 Web**；存量迁移与回填：`migrate_legacy_exclusions.py` 把旧 `xianyu_blocked_sellers`（已冻结只读）与 `xianyu_products` 一次性迁入统一排除/观察表；`backfill_sold_filter.py` 解封后照常可用（改写统一排除记录，删除商品行前先补录观察索引）。整体开关：`XIANYU_COLLECTOR_IMPORT_FILTER_ENABLED=false`。`/search/` 响应 `import_filter` 审计摘要：kept / excluded_seller_items / ignored_items / observed_items / new_excluded_sellers / skipped_counterfeit_items / frequency_threshold / frequency_rule_version / sold_filter / dup_title_filter。
- 详情补抓：每次搜索最多 **20 条**（原 40），请求间 **3–6s** 随机抖动（原 0.8–2s），搜索页由并发改为**串行 + 页间 1–2s 抖动**；`XIANYU_COLLECTOR_ENRICH_ENABLED=false` 可整体关闭；已有详情的记录不重复消耗请求。被硬筛跳过的记录不进入详情候选。
- 主页补抓：每卖家 7 天冷却期，单次搜索最多 10 个卖家，卖家间 1–2.5s 抖动，`XIANYU_COLLECTOR_PROFILE_ENABLED=false` 可整体关闭。
- **风控惩罚（RGV587/滑块）处理**：详情或主页请求命中 `FAIL_SYS_USER_VALIDATE` 惩罚响应时，不重试、不把惩罚页当数据入库；详情连续 3 次被拦截即熔断本轮，主页立即停止本轮剩余抓取。被拦截的记录下轮搜索会自动重试，通常等待数十分钟后风控自行解除。
- **登录态保护**：`probe_login` 只在平台明确返回会话过期时才清除登录 Cookie；风控惩罚、网络抖动等暂时性失败仅标记 `probe_failed` 并保留登录态。会话清除时自动留有 `data/session.backup.json` 备份，误清除可人工恢复。
- **字段来源（2026-09 实测）**：主页头部 `mtop.idle.web.user.page.head` 提供在售数（`module.tabs.item.number`）、信用等级（`module.shop.level`）、好评率、粉丝数、昵称、属地、简介；**「已卖出件数」不在 PC 头部**，改从商品详情响应的 `data.sellerDO.hasSoldNumInteger` 提取（详情页卖家卡片公开展示），随详情入库写入卖家画像，驱动「已核验卖出>100 件」判定。卖家在售列表接口名尚未确认（现名返回 `API_NOT_FOUNDED`，进程内自动停用），确认后更新 `xianyu/mtop.py` 的 `USER_PAGE_ITEMS_API` 即可。
- **「疑似非个人卖家」阈值规则**共三条：同品类已采集 ≥6 条、**主页在售 ≥50 件**、已核验卖出 >100 件（`seller-non-personal-thresholds`，阈值在经验知识库页可调；数据库中的旧版本规则行缺 `onSaleMinCount` 时自动回填默认 50）。主页在售数与详情卖家已售取数优先级：主页统计 → 本商品详情卖家卡片 → 既有卖家画像。
- 全部只读、不重试轰炸、失败不阻断搜索主流程；原始 JSON 落库，线上字段名变化时只需调整解析，不重复请求平台。`POST /search/` 响应带 `enriched_details` / `blocked_details` 计数。
- 主页接口名（`mtop.idle.web.user.page.head` / `mtop.idle.web.user.page.items`）来自 goofish PC 端流量，如平台调整接口名，在 `xianyu/mtop.py` 常量处更新。
- 调试命令：`python spider.py user <卖家ID>` 抓取单个卖家主页并输出脱敏摘要。
- Web 端导入调用采集器的超时为 300s（详情+主页补抓串行执行，一轮完整搜索可能超过两分钟）。

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

打开 Web 的“连接”页面，在“闲鱼真实数据入口”按行输入最多 5 个关键词，选择全国、省份或该省下的城市，再填写价格范围并点击“搜索并导入”。每个关键词独立、依次触发一次只读搜索；重复商品按平台商品 ID 入库去重。商品品类从标题、详情和搜索词推断，无法确认时标记为“其他”，不会把“其他”用于同品类卖家集中度判断。缺席次数只在关键词、地点、价格、时间和页数均相同的后续扫描中累计。当前采集器仅接收单个省市条件，区县和距离筛选尚未接入。流程为：

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
