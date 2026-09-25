# 闲鱼二奢机会雷达：本地架构

## 目标

这是一个优先运行在个人电脑上的 Web 工作台。它把“采集闲鱼候选商品、证据化评估、人工复核、企业微信提醒、经验沉淀”连成一条可追溯链路。首期不追求自动成交，也不把模型判断包装成确定事实。

## 本地拓扑

```text
浏览器
  │
  ▼
Next.js Web / API（127.0.0.1:3000）
  ├─ PostgreSQL 16（业务事实、评估、知识版本、审计记录）
  ├─ Redis（BullMQ 任务队列、重试与短期状态）
  └─ 企业微信机器人 Webhook（高价值机会通知）

独立 Worker
  └─ 消费 outbox 队列，发送通知并记录投递结果

独立本地只读采集器（127.0.0.1:8000）
  ├─ 仅接受持有共享服务令牌的 Web 服务端请求
  ├─ 用户本人在 Web 内扫码，并在闲鱼 App 完成确认或正常核身
  ├─ 搜索结果写入本机 PostgreSQL 的 xianyu_products 暂存表
  └─ 对本次新增记录补抓商品详情，对新卖家补抓主页快照（限频、冷却、可关闭），
     详情原文与卖家平台用户 ID 落 xianyu_products，主页统计落 xianyu_seller_profiles
```

项目不包含 Docker 配置。未配置 PostgreSQL、Redis 或企业微信时，Web 仍可以演示数据启动；健康检查会明确显示哪些正式能力尚未连接。

## 核心模块

- `src/domain`：纯领域模型：事实构建（facts）、前置过滤（pre-filters）、评分收敛（finalize）；区分“结构化事实”“前置过滤”和“JEV 主评分”的职责。
- `src/server/db`：Drizzle schema 与 PostgreSQL 连接；所有重要判断、规则、知识和投递都保留版本或审计记录。
- `src/server/notifications`：企业微信消息格式、Webhook 白名单、超时和错误归一化。
- `src/server/sources`：本地采集器契约、回环地址限制、商品规范化与去重入库。
- `src/server/queue.ts`：Redis / BullMQ 队列连接；通知通过 outbox 思路异步发送，支持重试和幂等扩展。
- `scripts/worker.ts`：独立通知 Worker，和 Web 进程解耦。
- `src/components`：证据优先的工作台界面，不承担核心业务判断。

## 评估链路与一条商品的生命周期

商品评估是一条单向四段流水线；规则引擎不再打分，只提供事实与过滤，JEV 是唯一裁判。

```text
采集适配器 → 标准化商品 → 内容指纹 upsert
  │
  ├─ Stage 0 前置过滤 runPreFilters（版本化配置，读 rule_definitions 失败回退默认值）
  │    listing-counterfeit-terms（高仿词硬阻断，high）
  │    listing-extreme-price-gap（价格 < 参考价 18%，medium）
  │    seller-non-personal-thresholds（同品类/已售观察信号达阈值，medium）
  │    命中 → 写过滤评估记录（filter_code + skip + 原因证据），不调用 JEV；
  │           线索默认隐藏，可在「已过滤」视图人工纠正
  │
  ├─ Stage 1 事实构建 buildRuleFacts（纯事实，不打分）
  │    issues / positives / missing / suggestedQuestions / hardFacts
  │    （品类匹配、利润空间、时效等客观计算保留为硬事实）
  │
  ├─ Stage 2 JEV 评分 evaluateListing（唯一裁判；state 由 facts 构建，不传规则分）
  │    不可用/失败/限频 → 不写评估记录，线索保持「待模型评分」，
  │    恢复后的下一次扫描经 inputFingerprint 自动补评
  │
  └─ Stage 3 收敛 finalizeAssessment（守护栏唯一一份）
       JEV 三维分数直接采用，无混合公式；总分 = JEV 三维 70%（0.30/0.30/0.10）
       + 硬事实 30%（品类 0.10 / 利润 0.15 / 时效 0.05）
       模型置信度 < TYPESAFE_CONFIDENCE_THRESHOLD 时 notify/skip 封顶为 review
       │
       ├─ 达标：进入通知 outbox
       └─ 纠正：生成经验候选
```

自动采集对同一评分指纹只评估一次：新商品或内容、规则、知识、关联参考价版本变化时追加一条 `assessments` 历史（唯一键 `listing_id + input_fingerprint`）；指纹不变且已有模型评分时跳过，页面读取直接查每条商品最新评估，不在渲染时调用评分或模型。用户明确发起手动重评时可再次调用 JEV，每次运行另存 `assessment_runs` 供审计。`filter_code` 非空的记录表示前置过滤拦截，其指纹还包含过滤器配置本身，配置版本变化会自动重过滤。JEV 不可用时商品照常入库，评分挂起并在健康面板、扫描结果、手动重评接口（503）三处明确提示，不做任何规则兜底评分。

JEV state 只包含公开商品文本（URL/邮箱/号码/联系方式凭据脱敏后）、价格信号、结构化事实、卖家观察统计与人工维护阈值，不包含卖家身份、Cookie、Token、聊天内容、原帖 URL 或图片 URL。问题与选项来自版本化的本地问题集：三组五档 Score rubric、卖家类型 Choice 和两个 Noul 判断；五档概率分布按期望值归一化为 0-100 分（原始档位保留在 raw 中审计）。个人卖家、疑假风险和信息充分度由 JEV 唯一裁决；facts 证据行固定为“参考信号”（scoreImpact=0），不再参与分数合成。完整结构化回答和 state 指纹随评估落库，便于人工复盘。

评估结果必须能回答三个问题：为什么入选、哪些信息缺失、哪些风险会阻止提醒。人工纠正只生成候选，不会直接改写生产规则。

## 知识与经验治理

知识沉淀不是一个无边界的聊天记忆，而是一套可审核的版本化资产：

1. 人工在商品评估中标记“判断正确”“需要纠正”或补充证据。
2. 系统创建 `feedback_events`，并可生成 `knowledgeCandidate`。
3. 候选在知识台中经过人工编辑和批准。
4. 知识录入先创建待复核版本，批准动作再追加审批版本；可执行规则修改也追加 `rule_versions`。
5. 后续评估记录引用所用版本，便于复盘某次判断为什么发生。

知识条目可表达品牌识别要点、品类成色标准、价格区间、常见话术风险和回收经验；规则条目负责机器可执行的阈值与阻断条件。两者分开，避免把经验文字直接当作硬规则。

知识页按阶段展示生效规则总账，包括数据库规则版本、代码固定阈值、JEV 版本及收敛权重。数据库规则的版本历史展示条件、原因与内容来源；AI 辅助拟定的规则须由管理员确认保存。人工或 AI 辅助录入的知识都先进入待复核；只有 active、已批准且属于 JEV 上下文通道的条目才按品类、品牌和型号注入，评估保存所用知识版本。参考价另存结构化来源与审批版本，仅人工关联、准入合格的参考价用于前置价格过滤。

## 外部项目参考边界

GitHub 调研中的项目只作为架构模式参考，未直接复制代码：

- `xianyu-pilot`：参考采集、筛选、通知的模块分层。
- `xianyu_spider`：参考把平台采集实现隔离在适配器之后，避免业务层依赖页面细节。
- `XianyuCodexAgent`：参考 inbox/outbox、幂等、未知状态和总开关等可靠性思路。

平台适配器必须遵守平台规则和本地法律；首期保留人工复核，不实现自动私聊、议价、下单或付款。

## 安全与故障边界

- 密钥只从本地环境变量读取，不写入仓库、日志或页面响应。
- Web 管理页面与 API 使用 HttpOnly、SameSite=Strict 的签名管理员会话；修改请求校验同源 Origin。
- 浏览器只能获取二维码 PNG 和脱敏状态，不能获取闲鱼 Cookie、Token、手机号、验证码或验证链接。
- Web 到采集器的 `/auth/*` 与 `/search/` 请求必须携带独立服务令牌。
- 企业微信 Webhook 只允许官方 `qyapi.weixin.qq.com` HTTPS 地址，减少 SSRF 风险。
- 数据库和 Redis 失败时健康检查返回脱敏状态；演示 UI 仍可用。
- 高假货风险是通知阻断项，信息缺失只降低置信度，不被误写成“假货”。
- 通知与未来的平台动作应使用幂等键；超时只标记未知或待重试，不假定成功。
- `system_controls` 为监控、通知及未来自动化能力预留独立总开关。

## 运行方式

开发入口为仓库根目录的 `scripts/dev.ps1`。配置 `apps/web/.env.local` 后，分别运行 Web 与 Worker：

```powershell
.\scripts\dev.ps1
pnpm --dir apps/web worker
```

首次连接本地 PostgreSQL 时，先创建数据库，再在 `apps/web` 目录运行 `pnpm db:migrate` 执行版本化迁移。Redis 需要在 `REDIS_URL` 中提供密码。
