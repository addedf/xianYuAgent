import type { RiskLevel } from "@/src/domain/listing";

const riskLabels: Record<RiskLevel, string> = {
  low: "低风险候选",
  insufficient: "信息不足",
  medium: "中风险",
  high: "高风险",
};

export function RiskChip({ level }: { level: RiskLevel }) {
  return (
    <span className={`status-chip status-${level}`}>
      <span className="status-symbol" aria-hidden="true" />
      {riskLabels[level]}
    </span>
  );
}

export function ConfidenceChip({ value }: { value: "draft" | "reviewed" | "verified" }) {
  const labels = { draft: "草稿", reviewed: "已复核", verified: "已验证" };
  return <span className={`confidence-chip confidence-${value}`}>{labels[value]}</span>;
}

