"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowClockwise, CircleNotch } from "@phosphor-icons/react";

interface RescoreState {
  running: boolean;
  done: number;
  total: number;
  jevCalls: number;
  message?: string;
}

export function RescoreAllButton({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<RescoreState>({ running: false, done: 0, total: 0, jevCalls: 0 });

  async function rescoreAll() {
    if (demoMode || state.running) return;
    setState({ running: true, done: 0, total: 0, jevCalls: 0 });
    try {
      const inventoryResponse = await fetch("/api/assessments/rescore-all", { cache: "no-store" });
      const inventory = await inventoryResponse.json().catch(() => ({})) as { error?: string; listingIds?: string[]; total?: number };
      if (!inventoryResponse.ok) throw new Error(inventory.error ?? "读取待评分商品失败。");
      const listingIds = inventory.listingIds ?? [];
      let completed = 0;
      let jevCalls = 0;
      setState({ running: true, done: 0, total: listingIds.length, jevCalls: 0 });
      for (const listingId of listingIds) {
        const response = await fetch("/api/assessments/rescore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ listingId }),
        });
        const result = await response.json().catch(() => ({})) as { error?: string; jevEvaluated?: boolean };
        if (!response.ok) throw new Error(result.error ?? `第 ${completed + 1} 条重评分失败。`);
        if (result.jevEvaluated) jevCalls += 1;
        completed += 1;
        setState({ running: true, done: completed, total: listingIds.length, jevCalls });
      }
      router.refresh();
      setState({ running: false, done: completed, total: listingIds.length, jevCalls, message: `已完成 ${completed} 条（JEV ${jevCalls} 条，规则结果 ${completed - jevCalls} 条）。` });
    } catch (error) {
      router.refresh();
      setState((current) => ({
        ...current,
        running: false,
        message: `已完成 ${current.done} 条后中断：${error instanceof Error ? error.message : "请求失败。"}`,
      }));
    }
  }

  return (
    <div className="rescore-all-control">
      <button className="button button-primary" type="button" disabled={demoMode || state.running} onClick={rescoreAll} title={demoMode ? "演示数据不能写入评分结果" : "使用当前规则与 JEV 对数据库全部商品重新评分"}>
        {state.running ? <CircleNotch size={17} className="spin" aria-hidden="true" /> : <ArrowClockwise size={17} aria-hidden="true" />}
        {state.running ? `重评分 ${state.done}/${state.total}` : "重新评分全部入库商品"}
      </button>
      {state.message && <span role="status">{state.message}</span>}
    </div>
  );
}
