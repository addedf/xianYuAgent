import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  identityTypeLabel,
  sellerIdentityCandidates,
  weakIdentityKey,
  type SellerIdentityCandidate,
  type SellerIdentityType,
} from "@/src/domain/seller-identity";
import { getDatabase } from "@/src/server/db/client";
import {
  marketplaceListings,
  sellers,
  xianyuListingHandling,
  xianyuListingObservations,
  xianyuSellerExclusions,
} from "@/src/server/db/schema";

/**
 * 统一排除服务（方案 6）：采集器自动排除与 Web 人工拉黑共用同一数据库中的
 * 唯一权威状态。撤销记录撤销事件而不是删除审计历史；模型不得覆盖人工排除。
 * 读取失败必须抛错：导入方按「排除服务不可用」暂停写入（fail-closed），
 * 不允许在黑名单不可知时静默放行。
 */

export type ExclusionSource = "manual" | "auto-rule";
export type ExclusionStatus = "active" | "revoked";
export type ListingHandling = "ignored" | "pending" | "watched";

export interface SellerExclusionRow {
  id: string;
  platform: string;
  identityKey: string;
  identityType: SellerIdentityType;
  nickname: string;
  area: string;
  source: ExclusionSource;
  reason: string;
  evidence: Record<string, unknown>;
  ruleVersion: string | null;
  status: ExclusionStatus;
  hitCount: number;
  events: ExclusionEvent[];
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
  revokeNote: string | null;
}

export interface ExclusionEvent {
  ts: string;
  action: "blacklist" | "revoke" | "reactivate" | "auto-exclude";
  source: ExclusionSource;
  reason: string;
  note?: string;
}

export class ExclusionServiceUnavailableError extends Error {
  constructor(cause: unknown) {
    super("卖家排除服务当前不可用，已暂停线索写入；请检查共享数据库连接后重试。");
    this.name = "ExclusionServiceUnavailableError";
    this.cause = cause;
  }
}

function parseJsonObject(value: string | null, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : fallback;
  } catch {
    return fallback;
  }
}

function parseEvents(value: string | null): ExclusionEvent[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is ExclusionEvent => item !== null && typeof item === "object" && typeof (item as ExclusionEvent).action === "string") : [];
  } catch {
    return [];
  }
}

function toRow(record: typeof xianyuSellerExclusions.$inferSelect): SellerExclusionRow {
  return {
    id: record.id,
    platform: record.platform,
    identityKey: record.identityKey,
    identityType: (record.identityType as SellerIdentityType) ?? "nickname-area",
    nickname: record.nickname,
    area: record.area,
    source: record.source as ExclusionSource,
    reason: record.reason,
    evidence: parseJsonObject(record.evidence, {}),
    ruleVersion: record.ruleVersion,
    status: record.status as ExclusionStatus,
    hitCount: record.hitCount,
    events: parseEvents(record.events),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
    revokeNote: record.revokeNote,
  };
}

/** 全量 active 排除映射：本地单机规模一次载入，导入前与页面渲染共用同一视图。 */
export async function loadActiveExclusionMap(platform = "xianyu"): Promise<Map<string, SellerExclusionRow>> {
  try {
    const rows = await getDatabase().db
      .select()
      .from(xianyuSellerExclusions)
      .where(and(eq(xianyuSellerExclusions.platform, platform), eq(xianyuSellerExclusions.status, "active")));
    return new Map(rows.map((row) => [row.identityKey, toRow(row)]));
  } catch (error) {
    throw new ExclusionServiceUnavailableError(error);
  }
}

/** 商品处理映射（忽略/待定/关注），供导入复检与工作台状态展示。 */
export async function loadHandlingMap(platform = "xianyu"): Promise<Map<string, ListingHandling>> {
  try {
    const rows = await getDatabase().db
      .select({ externalId: xianyuListingHandling.externalId, handling: xianyuListingHandling.handling })
      .from(xianyuListingHandling)
      .where(eq(xianyuListingHandling.platform, platform));
    return new Map(rows.map((row) => [row.externalId, row.handling as ListingHandling]));
  } catch (error) {
    throw new ExclusionServiceUnavailableError(error);
  }
}

export function matchExclusion(candidates: SellerIdentityCandidate[], exclusionMap: Map<string, SellerExclusionRow>): SellerExclusionRow | null {
  for (const candidate of candidates) {
    const hit = exclusionMap.get(candidate.key);
    if (hit) return hit;
  }
  return null;
}

async function appendEvent(id: string, event: ExclusionEvent, extra: Partial<typeof xianyuSellerExclusions.$inferInsert> = {}) {
  const [row] = await getDatabase().db.select({ events: xianyuSellerExclusions.events }).from(xianyuSellerExclusions).where(eq(xianyuSellerExclusions.id, id)).limit(1);
  const events = [...parseEvents(row?.events ?? null), event];
  await getDatabase().db.update(xianyuSellerExclusions).set({ events: JSON.stringify(events), updatedAt: new Date(), ...extra }).where(eq(xianyuSellerExclusions.id, id));
}

async function upsertExclusion(input: {
  identityKey: string;
  identityType: SellerIdentityType;
  nickname: string;
  area: string;
  source: ExclusionSource;
  reason: string;
  evidence: Record<string, unknown>;
  ruleVersion: string | null;
  event: ExclusionEvent;
  /** 人工拉黑可重新生效任意行；自动规则不得复活用户明确撤销过的行。 */
  reactivateRevoked: boolean;
}): Promise<{ row: SellerExclusionRow | null; created: boolean; reactivated: boolean; skippedUserRevoked: boolean }> {
  const { db } = getDatabase();
  const [existing] = await db.select().from(xianyuSellerExclusions)
    .where(and(eq(xianyuSellerExclusions.platform, "xianyu"), eq(xianyuSellerExclusions.identityKey, input.identityKey)))
    .limit(1);
  if (existing) {
    const wasActive = existing.status === "active";
    if (!wasActive && !input.reactivateRevoked) {
      return { row: toRow(existing), created: false, reactivated: false, skippedUserRevoked: true };
    }
    const evidence = { ...parseJsonObject(existing.evidence, {}), ...input.evidence };
    delete evidence.userRevoked;
    await appendEvent(existing.id, input.event, {
      status: "active",
      source: input.source,
      reason: input.reason,
      evidence: JSON.stringify(evidence),
      ruleVersion: input.ruleVersion,
      revokedAt: null,
      revokeNote: null,
    });
    const [fresh] = await db.select().from(xianyuSellerExclusions).where(eq(xianyuSellerExclusions.id, existing.id)).limit(1);
    return { row: toRow(fresh), created: false, reactivated: !wasActive, skippedUserRevoked: false };
  }
  const [inserted] = await db.insert(xianyuSellerExclusions).values({
    platform: "xianyu",
    identityKey: input.identityKey,
    identityType: input.identityType,
    nickname: input.nickname,
    area: input.area,
    source: input.source,
    reason: input.reason,
    evidence: JSON.stringify(input.evidence),
    ruleVersion: input.ruleVersion,
    status: "active",
    events: JSON.stringify([input.event]),
  }).returning();
  return { row: toRow(inserted), created: true, reactivated: false, skippedUserRevoked: false };
}

export interface BlacklistOutcome {
  exclusions: SellerExclusionRow[];
  /** 该卖家名下仍处 active 的线索数（存量回溯范围）。 */
  affectedActiveListings: number;
  identityType: SellerIdentityType;
  /** 弱身份（无稳定 ID）拉黑时的范围说明，界面必须展示。 */
  scopeNotice: string;
}

export async function blacklistSellerByRow(input: {
  displayName: string;
  region: string;
  stableExternalId?: string;
  reason: string;
  note?: string;
}): Promise<BlacklistOutcome> {
  const candidates = sellerIdentityCandidates({
    displayName: input.displayName,
    region: input.region,
    stableId: input.stableExternalId?.startsWith("xianyu-user-") ? input.stableExternalId.slice("xianyu-user-".length) : undefined,
  });
  const primary = candidates[0];
  if (candidates.every((candidate) => candidate.type === "anonymous")) {
    throw new Error("匿名占位背后可能是多个真实卖家，不能整组拉黑；请按单条商品忽略，或补齐卖家身份后再操作。");
  }
  const evidence = {
    ...(input.note ? { note: input.note } : {}),
    operatedFrom: "web-workbench",
  };
  const event: ExclusionEvent = { ts: new Date().toISOString(), action: "blacklist", source: "manual", reason: input.reason, note: input.note };
  const exclusions: SellerExclusionRow[] = [];
  for (const candidate of candidates) {
    const { row } = await upsertExclusion({
      identityKey: candidate.key,
      identityType: candidate.type,
      nickname: input.displayName,
      area: input.region,
      source: "manual",
      reason: input.reason,
      evidence,
      ruleVersion: null,
      event,
      reactivateRevoked: true,
    });
    if (row) exclusions.push(row);
  }
  const [sellerRow] = await dbCountListingsByIdentity(candidates);
  const scopeNotice = candidates.some((candidate) => candidate.type === "nickname-area")
    ? `当前只有「昵称+地区」弱身份（${identityTypeLabel("nickname-area")}）：同昵称同地区的卖家会被一并拦截，卖家改名后需要重新发现。`
    : `已按平台稳定 ID 拉黑，卖家改昵称后仍生效。`;
  return { exclusions, affectedActiveListings: sellerRow, identityType: primary?.type ?? "nickname-area", scopeNotice };
}

async function dbCountListingsByIdentity(candidates: SellerIdentityCandidate[]): Promise<[number]> {
  const keys = candidates.map((candidate) => candidate.key);
  const rows = await getDatabase().db
    .select({ count: sql<number>`count(*)::int` })
    .from(marketplaceListings)
    .innerJoin(sellers, eq(marketplaceListings.sellerId, sellers.id))
    .where(and(inArray(sellers.identityKey, keys), eq(marketplaceListings.status, "active")));
  return [rows[0]?.count ?? 0];
}

export async function revokeExclusion(exclusionId: string, note?: string): Promise<SellerExclusionRow> {
  const { db } = getDatabase();
  const [existing] = await db.select().from(xianyuSellerExclusions).where(eq(xianyuSellerExclusions.id, exclusionId)).limit(1);
  if (!existing) throw new Error("排除记录不存在，可能已被撤销。");
  if (existing.status === "revoked") return toRow(existing);
  // 撤销是记录事件而非删除历史；同时打上 userRevoked 标记，
  // 防止观察累计仍在阈值之上时自动规则下一轮原样复活。
  const evidence = { ...parseJsonObject(existing.evidence, {}), userRevoked: true };
  await appendEvent(existing.id, { ts: new Date().toISOString(), action: "revoke", source: existing.source as ExclusionSource, reason: existing.reason, note }, {
    status: "revoked",
    revokedAt: new Date(),
    revokeNote: note ?? null,
    evidence: JSON.stringify(evidence),
  });
  const [row] = await db.select().from(xianyuSellerExclusions).where(eq(xianyuSellerExclusions.id, exclusionId)).limit(1);
  return toRow(row);
}

/** 用户明确撤销过的身份键：自动规则不得据此重新排除；人工拉黑仍可重新生效。 */
export async function loadUserRevokedIdentityKeys(platform = "xianyu"): Promise<Set<string>> {
  try {
    const rows = await getDatabase().db
      .select({ identityKey: xianyuSellerExclusions.identityKey, evidence: xianyuSellerExclusions.evidence })
      .from(xianyuSellerExclusions)
      .where(and(eq(xianyuSellerExclusions.platform, platform), eq(xianyuSellerExclusions.status, "revoked")));
    return new Set(rows.filter((row) => parseJsonObject(row.evidence, {}).userRevoked === true).map((row) => row.identityKey));
  } catch (error) {
    throw new ExclusionServiceUnavailableError(error);
  }
}

export async function listExclusions(): Promise<SellerExclusionRow[]> {
  const rows = await getDatabase().db.select().from(xianyuSellerExclusions).orderBy(desc(xianyuSellerExclusions.updatedAt)).limit(200);
  return rows.map(toRow);
}

/** 存量回溯的辅助查询：按身份键查名下线索（撤销复核与排除管理展示用）。 */
export async function loadListingsByIdentityKeys(identityKeys: string[]) {
  if (identityKeys.length === 0) return [];
  return getDatabase().db
    .select({ id: marketplaceListings.id, externalId: marketplaceListings.externalId, title: marketplaceListings.title, status: marketplaceListings.status })
    .from(marketplaceListings)
    .innerJoin(sellers, eq(marketplaceListings.sellerId, sellers.id))
    .where(inArray(sellers.identityKey, identityKeys))
    .orderBy(desc(marketplaceListings.firstSeenAt))
    .limit(200);
}

export async function setListingHandling(input: { externalId: string; handling: ListingHandling | null; note?: string }): Promise<"set" | "cleared"> {
  const { db } = getDatabase();
  if (input.handling === null) {
    await db.delete(xianyuListingHandling).where(and(eq(xianyuListingHandling.platform, "xianyu"), eq(xianyuListingHandling.externalId, input.externalId)));
    return "cleared";
  }
  await db.insert(xianyuListingHandling).values({
    platform: "xianyu",
    externalId: input.externalId,
    handling: input.handling,
    note: input.note ?? "",
  }).onConflictDoUpdate({
    target: [xianyuListingHandling.platform, xianyuListingHandling.externalId],
    set: { handling: input.handling, note: input.note ?? "", updatedAt: new Date() },
  });
  return "set";
}

/** 供排除管理页展示的观察证据：按身份键聚合观察索引（不同商品数、样本标题）。 */
export async function loadObservationEvidence(identityKeys: string[]): Promise<Map<string, { distinctItemCount: number; firstSeenAt: Date | null; lastSeenAt: Date | null; sampleTitles: string[] }>> {
  const result = new Map<string, { distinctItemCount: number; firstSeenAt: Date | null; lastSeenAt: Date | null; sampleTitles: string[] }>();
  if (identityKeys.length === 0) return result;
  try {
    const rows = await getDatabase().db
      .select({
        identityKey: xianyuListingObservations.sellerIdentityKey,
        distinctItemCount: sql<number>`count(*)::int`,
        firstSeenAt: sql<Date | null>`min(first_seen_at)`,
        lastSeenAt: sql<Date | null>`max(last_seen_at)`,
      })
      .from(xianyuListingObservations)
      .where(inArray(xianyuListingObservations.sellerIdentityKey, identityKeys))
      .groupBy(xianyuListingObservations.sellerIdentityKey);
    const sampleRows = await getDatabase().db
      .select({ identityKey: xianyuListingObservations.sellerIdentityKey, title: xianyuListingObservations.title, lastSeenAt: xianyuListingObservations.lastSeenAt })
      .from(xianyuListingObservations)
      .where(inArray(xianyuListingObservations.sellerIdentityKey, identityKeys))
      .orderBy(desc(xianyuListingObservations.lastSeenAt))
      .limit(300);
    for (const row of rows) {
      result.set(row.identityKey, {
        distinctItemCount: row.distinctItemCount,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        sampleTitles: sampleRows.filter((sample) => sample.identityKey === row.identityKey && sample.title).slice(0, 3).map((sample) => sample.title),
      });
    }
  } catch (error) {
    throw new ExclusionServiceUnavailableError(error);
  }
  return result;
}

export { weakIdentityKey };
