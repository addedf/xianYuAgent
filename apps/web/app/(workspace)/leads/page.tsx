import type { Metadata } from "next";
import { LeadWorkbench } from "@/components/lead-workbench";
import { assessedDemoListings } from "@/src/data/demo";

export const metadata: Metadata = { title: "线索审阅" };

export default function LeadsPage() {
  return (
    <div className="page-stack page-stack-wide">
      <header className="page-header">
        <p className="context-line">证据优先 · 人工最终确认</p>
        <h1>线索审阅</h1>
        <p>把商品、卖家、风险依据和经验反馈放在同一视图中，避免只看一个总分。</p>
      </header>
      <LeadWorkbench items={assessedDemoListings} />
    </div>
  );
}

