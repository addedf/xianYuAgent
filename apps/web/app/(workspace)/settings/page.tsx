import type { Metadata } from "next";
import { CheckCircle, LockKey, PauseCircle, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { ConnectionPanel } from "@/components/connection-panel";
import { XianyuSourcePanel } from "@/components/xianyu-source-panel";

export const metadata: Metadata = { title: "连接与控制" };

export default function SettingsPage() {
  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="context-line">本地优先 · 凭据隔离 · 可随时暂停</p>
        <h1>连接与控制</h1>
        <p>先完成本机 PostgreSQL、Redis 与企业微信通知，再进入闲鱼真实账号的隔离 PoC。</p>
      </header>

      <ConnectionPanel />
      <XianyuSourcePanel />

      <div className="settings-grid">
        <section className="panel settings-section">
          <div className="section-heading">
            <div>
              <h2>环境变量</h2>
              <p>配置文件仅保存在 `apps/web/.env.local`。</p>
            </div>
            <LockKey size={22} weight="fill" aria-hidden="true" />
          </div>
          <dl className="env-list">
            <div><dt>DATABASE_URL</dt><dd>PostgreSQL 用户、密码与数据库名</dd></div>
            <div><dt>REDIS_URL</dt><dd>包含本机 Redis 密码的连接串</dd></div>
            <div><dt>WECOM_WEBHOOK_URL</dt><dd>企业微信机器人通知地址</dd></div>
            <div><dt>XIANYU_COLLECTOR_ENABLED</dt><dd>本机只读闲鱼采集器开关</dd></div>
            <div><dt>XIANYU_COLLECTOR_URL</dt><dd>仅允许 localhost 或 127.0.0.1</dd></div>
            <div><dt>OUTBOUND_MESSAGING_ENABLED</dt><dd>闲鱼主动发送总开关，当前必须为 false</dd></div>
          </dl>
        </section>

        <section className="panel settings-section">
          <div className="section-heading">
            <div>
              <h2>自动化安全边界</h2>
              <p>这些检查必须全部通过才能考虑真实发送。</p>
            </div>
            <ShieldCheck size={22} weight="fill" aria-hidden="true" />
          </div>
          <ul className="safety-checklist">
            <li><CheckCircle size={18} weight="fill" /><span><strong>商品与卖家去重</strong><small>幂等键和历史联系记录</small></span></li>
            <li><CheckCircle size={18} weight="fill" /><span><strong>风险阈值</strong><small>疑假、同行或信息不足不自动联系</small></span></li>
            <li><CheckCircle size={18} weight="fill" /><span><strong>频率与静默时段</strong><small>单账号上限、失败退避</small></span></li>
            <li><PauseCircle size={18} weight="fill" /><span><strong>全局暂停</strong><small>当前处于强制暂停状态</small></span></li>
          </ul>
        </section>
      </div>

      <section className="next-step-panel">
        <div>
          <strong>下一步：创建本地数据库并填写连接串</strong>
          <p>完成后运行 `pnpm db:migrate`，再启动 Worker 验证企业微信通知重试链路。</p>
        </div>
        <code>pnpm db:migrate</code>
      </section>
    </div>
  );
}
