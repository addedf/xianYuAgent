import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/src/server/db/client";
import { xianyuScanRuns } from "@/src/server/db/schema";

/**
 * 探查运行记录（方案 7）：进度按「关键词、地区、价格等任务范围」维护，页数是预算不是范围。
 * - fresh（追踪最新）：日常默认，含时间窗；expand（扩大覆盖）：不带时间窗、从上次覆盖边界
 *   回退一页重叠后继续推进深度，跨轮累积同一范围。
 * - 重复点击复用进行中的运行，避免同一任务并发多轮；超时的运行标记失败后允许重新发起。
 * - 运行只在采集器成功返回（观察索引已持久化）后才提交进度；失败页不标记为成功覆盖。
 */

export type ScanMode = "fresh" | "expand";

export interface ScanTaskScope {
  keyword: string;
  province?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  publishDays?: number;
}

/** 运行无响应超时：采集器同步调用超时 300s，留出充分富余。 */
export const SCAN_RUN_STALE_MS = 30 * 60 * 1000;
/** 扩大覆盖与前次覆盖边界的重叠页数：降低排序抖动和延迟收录造成的遗漏。 */
export const EXPAND_OVERLAP_PAGES = 1;

export class ScanRunInProgressError extends Error {
  constructor(public readonly run: Pick<ScanRunView, "id" | "mode" | "startPage" | "startedAt">) {
    super(`该扫描范围已有进行中的运行（${run.mode === "expand" ? "扩大覆盖" : "追踪最新"}，起始第 ${run.startPage} 页，${run.startedAt.toLocaleString("zh-CN", { hour12: false })} 发起）。请等待其完成，避免同一任务并发多轮。`);
    this.name = "ScanRunInProgressError";
  }
}

export interface ScanRunView {
  id: string;
  scopeHash: string;
  mode: ScanMode;
  status: "running" | "completed" | "partial" | "failed";
  startPage: number;
  requestedPages: number;
  completedPages: number;
  failedPages: number[];
  stopReason: string | null;
  coverageNote: string | null;
  resultCounts: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date | null;
}

function scopeDetailOf(input: ScanTaskScope, mode: ScanMode): Record<string, unknown> {
  return {
    keyword: input.keyword,
    province: input.province ?? "",
    city: input.city ?? "",
    minPrice: input.minPrice ?? null,
    maxPrice: input.maxPrice ?? null,
    // 追踪最新的时间窗属于范围的一部分；扩大覆盖不带时间窗，跨轮累积同一范围。
    ...(mode === "fresh" ? { publishDays: input.publishDays ?? null } : {}),
  };
}

export function taskScopeHash(input: ScanTaskScope, mode: ScanMode): string {
  return createHash("sha256").update(JSON.stringify(scopeDetailOf(input, mode))).digest("hex").slice(0, 32);
}

function toView(record: typeof xianyuScanRuns.$inferSelect): ScanRunView {
  return {
    id: record.id,
    scopeHash: record.scopeHash,
    mode: record.mode as ScanMode,
    status: record.status as ScanRunView["status"],
    startPage: record.startPage,
    requestedPages: record.requestedPages,
    completedPages: record.completedPages,
    failedPages: Array.isArray(record.failedPages) ? record.failedPages.filter((value): value is number => typeof value === "number") : [],
    stopReason: record.stopReason,
    coverageNote: record.coverageNote,
    resultCounts: record.resultCounts && typeof record.resultCounts === "object" && !Array.isArray(record.resultCounts) ? record.resultCounts as Record<string, unknown> : {},
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
}

export function coverageNoteOf(run: Pick<ScanRunView, "startPage" | "requestedPages" | "completedPages" | "failedPages" | "stopReason">): string {
  const covered = run.completedPages > 0
    ? `第 ${run.startPage}～${run.startPage + run.completedPages - 1} 页`
    : "无页面成功覆盖";
  const failed = run.failedPages.length > 0 ? `；第 ${run.failedPages.join("、")} 页失败未覆盖` : "";
  const reason = run.stopReason === "all-pages-failed" ? "（全部页面失败）"
    : run.stopReason === "page-failed" ? "（部分页面失败，预算内已继续）"
    : run.stopReason === "stale-timeout" ? "（运行超时未回报，覆盖情况未知）"
    : "";
  return `覆盖有限，不宣称已扫完：本次预算 ${run.requestedPages} 页，实际完成 ${covered}${failed}${reason}。`;
}

export async function startScanRun(input: ScanTaskScope, mode: ScanMode, requestedPages: number): Promise<{ run: ScanRunView; reused: boolean; startPage: number }> {
  const { db } = getDatabase();
  const scopeHash = taskScopeHash(input, mode);
  const [running] = await db.select()
    .from(xianyuScanRuns)
    .where(and(eq(xianyuScanRuns.platform, "xianyu"), eq(xianyuScanRuns.scopeHash, scopeHash), eq(xianyuScanRuns.status, "running")))
    .orderBy(desc(xianyuScanRuns.startedAt))
    .limit(1);
  if (running) {
    if (Date.now() - running.startedAt.getTime() < SCAN_RUN_STALE_MS) {
      return { run: toView(running), reused: true, startPage: running.startPage };
    }
    // 超时的运行不再阻塞新任务：标记失败并如实记录覆盖未知。
    await db.update(xianyuScanRuns).set({
      status: "failed",
      stopReason: "stale-timeout",
      coverageNote: coverageNoteOf({ startPage: running.startPage, requestedPages: running.requestedPages, completedPages: running.completedPages, failedPages: [], stopReason: "stale-timeout" }),
      finishedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(xianyuScanRuns.id, running.id));
  }

  let startPage = 1;
  if (mode === "expand") {
    // 从上次覆盖边界回退一页重叠后继续推进（页码在动态结果中不稳定，需配合 ID 去重）。
    const [previous] = await db.select()
      .from(xianyuScanRuns)
      .where(and(
        eq(xianyuScanRuns.platform, "xianyu"),
        eq(xianyuScanRuns.scopeHash, scopeHash),
        inArray(xianyuScanRuns.status, ["completed", "partial"]),
      ))
      .orderBy(desc(xianyuScanRuns.startedAt))
      .limit(1);
    if (previous) {
      startPage = Math.max(1, previous.startPage + previous.completedPages - EXPAND_OVERLAP_PAGES);
    }
  }
  const [created] = await db.insert(xianyuScanRuns).values({
    platform: "xianyu",
    scopeHash,
    scopeDetail: scopeDetailOf(input, mode),
    mode,
    status: "running",
    startPage,
    requestedPages,
  }).returning();
  return { run: toView(created), reused: false, startPage };
}

export async function finishScanRun(
  runId: string,
  patch: {
    status: "completed" | "partial" | "failed";
    stopReason?: string | null;
    completedPages?: number;
    failedPages?: number[];
    resultCounts?: Record<string, unknown>;
  },
): Promise<ScanRunView | null> {
  const { db } = getDatabase();
  const [current] = await db.select().from(xianyuScanRuns).where(eq(xianyuScanRuns.id, runId)).limit(1);
  if (!current) return null;
  const merged: Pick<ScanRunView, "startPage" | "requestedPages" | "completedPages" | "failedPages" | "stopReason"> = {
    startPage: current.startPage,
    requestedPages: current.requestedPages,
    completedPages: patch.completedPages ?? current.completedPages,
    failedPages: patch.failedPages ?? (Array.isArray(current.failedPages) ? current.failedPages.filter((value): value is number => typeof value === "number") : []),
    stopReason: patch.stopReason ?? current.stopReason,
  };
  await db.update(xianyuScanRuns).set({
    status: patch.status,
    stopReason: merged.stopReason,
    completedPages: merged.completedPages,
    failedPages: merged.failedPages,
    resultCounts: patch.resultCounts ?? current.resultCounts,
    coverageNote: coverageNoteOf(merged),
    finishedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(xianyuScanRuns.id, runId));
  const [row] = await db.select().from(xianyuScanRuns).where(eq(xianyuScanRuns.id, runId)).limit(1);
  return row ? toView(row) : null;
}

/** 首页面板的最近运行摘要（跨范围）。 */
export async function loadRecentScanRuns(limit = 8): Promise<ScanRunView[]> {
  const rows = await getDatabase().db.select().from(xianyuScanRuns).orderBy(desc(xianyuScanRuns.startedAt)).limit(Math.min(Math.max(limit, 1), 50));
  return rows.map(toView);
}
