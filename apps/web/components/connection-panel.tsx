"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, BellSimpleRinging, CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import type { ServiceHealth } from "@/src/server/health";

interface HealthResponse {
  mode: "demo" | "connected";
  services: ServiceHealth[];
  checkedAt: string;
}

const serviceLabels = {
  postgresql: "PostgreSQL",
  redis: "Redis / BullMQ",
  "xianyu-collector": "闲鱼只读采集器",
  wecom: "企业微信机器人",
  typesafe: "JEV 主评分",
};

export function ConnectionPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingWeCom, setTestingWeCom] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) throw new Error("系统状态接口返回异常。");
      setHealth(await response.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取系统状态。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/health", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("系统状态接口返回异常。");
        return response.json() as Promise<HealthResponse>;
      })
      .then((payload) => {
        if (!cancelled) setHealth(payload);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "无法读取系统状态。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function testWeCom() {
    setTestingWeCom(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/notifications/wecom/test", { method: "POST" });
      const result = (await response.json()) as { message?: string; error?: string };
      setTestResult(result.message ?? result.error ?? "测试请求已完成。");
    } catch {
      setTestResult("测试失败，请检查本机网络与 Webhook 配置。");
    } finally {
      setTestingWeCom(false);
    }
  }

  return (
    <section className="connection-panel">
      <div className="section-heading">
        <div>
          <h2>本地服务连接</h2>
          <p>只显示连接状态，不回显密码、Webhook 或 Cookie。</p>
        </div>
        <button className="button button-secondary button-small" type="button" onClick={loadHealth} disabled={loading}>
          <ArrowClockwise className={loading ? "spin" : ""} size={16} aria-hidden="true" />
          重新检查
        </button>
      </div>

      {loading && !health ? (
        <div className="connection-skeleton" aria-label="正在检查服务">
          <span /><span /><span />
        </div>
      ) : error ? (
        <div className="error-state" role="alert"><WarningCircle size={20} weight="fill" />{error}</div>
      ) : (
        <div className="connection-list">
          {health?.services.map((service) => (
            <div className="connection-row" key={service.name}>
              <span className={`connection-icon connection-${service.state}`} aria-hidden="true">
                {service.state === "ready" ? <CheckCircle size={21} weight="fill" /> : <WarningCircle size={21} weight="fill" />}
              </span>
              <div>
                <strong>{serviceLabels[service.name]}</strong>
                <p>{service.detail}</p>
              </div>
              <div className="connection-state">
                <b>{service.state === "ready" ? "已连接" : service.state === "not-configured" ? "待配置" : "不可用"}</b>
                {service.latencyMs !== undefined && <small>{service.latencyMs} ms</small>}
              </div>
              {service.name === "wecom" && (
                <button className="button button-ghost button-small" type="button" onClick={testWeCom} disabled={testingWeCom || service.state !== "ready"}>
                  {testingWeCom ? <CircleNotch className="spin" size={16} /> : <BellSimpleRinging size={16} />}
                  发送测试
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {testResult && <div className="inline-notice" role="status">{testResult}</div>}
    </section>
  );
}
