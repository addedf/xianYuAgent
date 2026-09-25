import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const sellers = pgTable(
  "sellers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    region: text("region"),
    profileSnapshot: jsonb("profile_snapshot").notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns,
  },
  (table) => [uniqueIndex("sellers_platform_external_unique").on(table.platform, table.externalId)],
);

export const monitorTasks = pgTable("monitor_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  keywords: jsonb("keywords").notNull().default([]),
  regions: jsonb("regions").notNull().default([]),
  priceMin: numeric("price_min", { precision: 14, scale: 2 }),
  priceMax: numeric("price_max", { precision: 14, scale: 2 }),
  scanIntervalSeconds: integer("scan_interval_seconds").notNull().default(300),
  enabled: boolean("enabled").notNull().default(true),
  watermark: text("watermark"),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  ...auditColumns,
});

export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    sellerId: uuid("seller_id").references(() => sellers.id, { onDelete: "set null" }),
    monitorTaskId: uuid("monitor_task_id").references(() => monitorTasks.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    brand: text("brand"),
    model: text("model"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    price: numeric("price", { precision: 14, scale: 2 }).notNull(),
    marketReferencePrice: numeric("market_reference_price", { precision: 14, scale: 2 }),
    marketReferenceId: uuid("market_reference_id"),
    marketReferenceVersion: integer("market_reference_version"),
    marketReferenceExpiresAt: timestamp("market_reference_expires_at", { withTimezone: true }),
    region: text("region"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    sourceUrl: text("source_url"),
    imageRefs: jsonb("image_refs").notNull().default([]),
    rawPayload: jsonb("raw_payload").notNull().default({}),
    contentFingerprint: text("content_fingerprint"),
    status: text("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    absentScanCount: integer("absent_scan_count").notNull().default(0),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("listings_platform_external_unique").on(table.platform, table.externalId),
    index("listings_first_seen_idx").on(table.firstSeenAt),
    index("listings_seller_idx").on(table.sellerId),
  ],
);

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
    rulesetVersion: text("ruleset_version").notNull(),
    modelVersion: text("model_version"),
    modelConfidence: integer("model_confidence"),
    modelEvaluation: jsonb("model_evaluation"),
    inputFingerprint: text("input_fingerprint"),
    filterCode: text("filter_code"),
    knowledgeUsed: jsonb("knowledge_used").notNull().default([]),
    priceReferenceUsed: jsonb("price_reference_used"),
    riskLevel: text("risk_level").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    totalOpportunity: integer("total_opportunity").notNull(),
    scores: jsonb("scores").notNull(),
    evidence: jsonb("evidence").notNull(),
    missingInformation: jsonb("missing_information").notNull().default([]),
    summary: text("summary").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns,
  },
  (table) => [index("assessments_listing_idx").on(table.listingId), index("assessments_action_idx").on(table.recommendedAction), uniqueIndex("assessments_listing_input_unique").on(table.listingId, table.inputFingerprint)],
);

export const assessmentRuns = pgTable("assessment_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  listingId: uuid("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
  inputFingerprint: text("input_fingerprint").notNull(),
  trigger: text("trigger").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("assessment_runs_listing_idx").on(table.listingId, table.createdAt)]);

export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryType: text("entry_type").notNull(),
    category: text("category").notNull(),
    brand: text("brand"),
    model: text("model"),
    title: text("title").notNull(),
    currentSummary: text("current_summary").notNull(),
    effectChannel: text("effect_channel").notNull().default("manual-only"),
    confidence: text("confidence").notNull().default("draft"),
    reviewStatus: text("review_status").notNull().default("pending"),
    currentVersion: integer("current_version").notNull().default(1),
    sourceLabel: text("source_label").notNull(),
    active: boolean("active").notNull().default(true),
    ...auditColumns,
  },
  (table) => [index("knowledge_scope_idx").on(table.entryType, table.category, table.brand)],
);

export const knowledgeVersions = pgTable(
  "knowledge_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    knowledgeEntryId: uuid("knowledge_entry_id").notNull().references(() => knowledgeEntries.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: jsonb("content").notNull(),
    changeReason: text("change_reason").notNull(),
    sourceType: text("source_type").notNull(),
    sourceReference: text("source_reference"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("knowledge_version_unique").on(table.knowledgeEntryId, table.version)],
);

export const marketPriceReferences = pgTable(
  "market_price_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").references(() => marketplaceListings.id, { onDelete: "set null" }),
    scopeKey: text("scope_key").notNull(),
    category: text("category").notNull(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    version: integer("version").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("CNY"),
    priceType: text("price_type").notNull(),
    matchedModel: text("matched_model").notNull(),
    conditionGrade: text("condition_grade").notNull().default("unknown"),
    productionYear: integer("production_year"),
    accessories: jsonb("accessories").notNull().default([]),
    market: text("market").notNull().default("other"),
    marketRegion: text("market_region"),
    conditionNote: text("condition_note").notNull(),
    sourceLabel: text("source_label").notNull(),
    origin: text("origin").notNull().default("manual"),
    sourceUrl: text("source_url"),
    sampleCount: integer("sample_count").notNull().default(1),
    sampleEvidence: jsonb("sample_evidence").notNull().default([]),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    changeReason: text("change_reason").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("market_reference_scope_version_unique").on(table.scopeKey, table.version), index("market_reference_listing_idx").on(table.listingId)],
);

export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id").notNull().references(() => marketplaceListings.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").references(() => assessments.id, { onDelete: "set null" }),
    feedbackType: text("feedback_type").notNull(),
    finalLabel: text("final_label"),
    reason: text("reason"),
    actualAcquisitionPrice: numeric("actual_acquisition_price", { precision: 14, scale: 2 }),
    knowledgeCandidate: jsonb("knowledge_candidate"),
    promotionStatus: text("promotion_status").notNull().default("not-proposed"),
    createdBy: text("created_by").notNull().default("local-user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("feedback_listing_idx").on(table.listingId), index("feedback_promotion_idx").on(table.promotionStatus)],
);

export const ruleDefinitions = pgTable("rule_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  currentVersion: integer("current_version").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  ...auditColumns,
});

export const ruleVersions = pgTable(
  "rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id").notNull().references(() => ruleDefinitions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    conditions: jsonb("conditions").notNull(),
    scoreImpact: integer("score_impact").notNull(),
    explanationTemplate: text("explanation_template").notNull(),
    changeReason: text("change_reason").notNull(),
    sourceType: text("source_type").notNull().default("manual"),
    approvedBy: text("approved_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("rule_version_unique").on(table.ruleId, table.version)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [uniqueIndex("outbox_idempotency_unique").on(table.idempotencyKey), index("outbox_pending_idx").on(table.status, table.nextAttemptAt)],
);

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  outboxEventId: uuid("outbox_event_id").references(() => outboxEvents.id, { onDelete: "set null" }),
  channel: text("channel").notNull(),
  recipientRef: text("recipient_ref").notNull(),
  status: text("status").notNull(),
  providerMessageId: text("provider_message_id"),
  responseCode: text("response_code"),
  errorSummary: text("error_summary"),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

export const systemControls = pgTable("system_controls", {
  id: uuid("id").primaryKey().defaultRandom(),
  controlKey: text("control_key").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  reason: text("reason"),
  changedBy: text("changed_by").notNull().default("local-user"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});
