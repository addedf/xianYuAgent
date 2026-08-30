# 闲鱼二奢机会雷达

面向二奢回收商家的本地 Web 工作台。首期打通最新上新发现、可解释初筛、知识与案例沉淀、企业微信机器人提醒，并为后续受控主动询价保留平台适配器与审计边界。

## 当前能力

- 专业工作台：概览、线索审阅、知识库与系统连接状态。
- 可解释评分：个人卖家概率、疑假风险、信息充分度、利润与时效拆分计算。
- 经验沉淀模型：知识条目、规则版本、判断证据、人工反馈与最终结果分开存储。
- 企业微信机器人：Webhook 严格校验、超时、错误归一化与测试接口。
- PostgreSQL 数据模型和 Redis/BullMQ 后台任务基座。
- 演示模式：不配置数据库和 Redis 也能先查看界面与评分逻辑。

## 本机要求

- Windows 10/11
- Node.js 20.9 或更高版本，或本机可用的 pnpm 启动器
- PostgreSQL 16（当前机器已检测到 5432 端口）
- Redis（当前机器已检测到 6379 端口，且启用了认证）

## 启动

1. 复制 `apps/web/.env.example` 为 `apps/web/.env.local`。
2. 填写 `DATABASE_URL`、`REDIS_URL`；企业微信联调时再填写 `WECOM_WEBHOOK_URL`。
3. 首次建表：在 `apps/web` 目录运行 `pnpm db:migrate`，执行仓库内已生成的版本化迁移。
4. 在项目根目录运行 `powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1`。
5. 浏览器访问 `http://localhost:3000`。

不填写连接信息时，应用自动进入演示模式，便于先验收页面和规则。

## 常用命令

```powershell
cd D:\A-projeck\xianYuAgent\apps\web
pnpm dev
pnpm worker
pnpm test
pnpm lint
pnpm build
pnpm db:migrate
```

## 安全边界

- `.env.local` 已被 Git 忽略，严禁提交真实凭据。
- 企业微信 Webhook 只允许 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send`。
- 当前版本不会自动发送闲鱼私信；真实发送能力必须在独立 PoC 中通过规则阈值、去重、频率限制、账号健康检查和人工暂停后才能开启。
