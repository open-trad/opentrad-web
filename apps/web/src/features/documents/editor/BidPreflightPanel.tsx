import { v2 } from "@opentrad/document-core";
import { useId } from "react";
import type { DocumentRevisionSnapshot } from "./useDocumentWorkspace";

export function resolveBidExportDecision(
  snapshot: DocumentRevisionSnapshot,
  trustedAsOf?: string,
): v2.BidExportDecisionV1 {
  if (snapshot.model.documentKind !== "bid") {
    throw new Error("只有投标文书具有投标导出决策");
  }
  return v2.decideBidExport({
    draft: v2.projectBidBaseDraft(snapshot.draft as v2.BidDraftBaseV1),
    findings: snapshot.findings,
    ...(trustedAsOf === undefined ? {} : { asOf: trustedAsOf }),
  });
}

const MODE_LABELS: Readonly<Record<v2.BidExportModeV1, string>> = {
  "internal-draft": "内部投标底稿",
  "review-copy": "投标审核稿",
  "submission-ready": "可提交投标文件",
};

const IMPACT_LABELS: Readonly<Record<v2.ExportImpactV2, string>> = {
  advisory: "提示",
  watermark: "需要水印",
  blockSubmission: "阻止提交版导出",
};

const FINDING_MESSAGE_LABELS: Readonly<Record<string, string>> = {
  BID_REQUIRED_CONTENT_PLACEHOLDER: "必填内容仍为占位信息，请补充真实内容。",
  BID_PRICE_UNCONFIRMED: "投标价格尚未由用户确认。",
  BID_DEADLINE_NOT_EVALUATED: "缺少可信的核验时间，暂不能确认是否超过投标截止时间。",
};

function findingMessage(finding: DocumentRevisionSnapshot["findings"][number]): string {
  const translated = FINDING_MESSAGE_LABELS[finding.code];
  if (translated) return translated;
  if (/\p{Script=Han}/u.test(finding.message)) return finding.message;
  return "此风险项需要人工复核，请按代码和字段路径核对。";
}

export function BidPreflightPanel({
  snapshot,
  decision,
}: {
  readonly snapshot: DocumentRevisionSnapshot;
  readonly decision: v2.BidExportDecisionV1;
}) {
  const titleId = useId();
  return (
    <section className="document-editor-v2__preflight" aria-labelledby={titleId}>
      <div className="document-editor-v2__preflight-heading">
        <div>
          <span>投标导出边界</span>
          <h2 id={titleId}>{MODE_LABELS[decision.mode]}</h2>
        </div>
        <span data-mode={decision.mode}>
          {decision.canExportSubmission ? "提交版已开放" : "提交版未开放"}
        </span>
      </div>
      {decision.mode === "internal-draft" ? (
        <p className="document-editor-v2__boundary-note">
          未绑定完整招标文件版本；当前内容固定为内部投标底稿，不得提交。
        </p>
      ) : null}
      {decision.mode === "review-copy" ? (
        <p className="document-editor-v2__boundary-note">当前为审核稿并带有“不得提交”水印。</p>
      ) : null}
      {decision.submissionChecks.includes("BID_DEADLINE_NOT_EVALUATED") ? (
        <p className="document-editor-v2__boundary-note">
          未提供可信的依据时间，系统不会使用浏览器时钟冒充截止时间核验。
        </p>
      ) : null}
      <ul className="document-editor-v2__findings" aria-label="风险与核验事项">
        {snapshot.findings.map((finding) => (
          <li key={`${finding.code}-${finding.path?.join(".") ?? "global"}`}>
            <div>
              <code>{finding.code}</code>
              <span data-severity={finding.severity}>{finding.severity}</span>
            </div>
            <p>{findingMessage(finding)}</p>
            <dl>
              <div>
                <dt>字段路径</dt>
                <dd>{finding.path?.join(".") ?? "全局"}</dd>
              </div>
              <div>
                <dt>导出影响</dt>
                <dd>
                  <code>{finding.impact}</code> · {IMPACT_LABELS[finding.impact]}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
