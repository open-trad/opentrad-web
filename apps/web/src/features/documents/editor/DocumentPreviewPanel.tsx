import type { Ref } from "react";
import { DocumentHtml } from "../render/html/DocumentHtml";
import type { DocumentRevisionSnapshot } from "./useDocumentWorkspace";

export function DocumentPreviewPanel({
  snapshot,
  stale = false,
  panelRef,
}: {
  readonly snapshot: DocumentRevisionSnapshot;
  readonly stale?: boolean;
  readonly panelRef?: Ref<HTMLElement>;
}) {
  const isContract = snapshot.model.documentKind === "contract";
  return (
    <section
      ref={panelRef}
      className="document-editor-v2__preview"
      aria-label="A4 文书预览"
      tabIndex={-1}
    >
      {stale ? <output className="document-editor-v2__stale">预览显示上一次有效内容</output> : null}
      <div className="document-editor-v2__preview-scroll">
        <DocumentHtml
          model={snapshot.model}
          layoutStyleId={snapshot.envelope.presentation.layoutStyleId}
          languageView={snapshot.envelope.presentation.languageView}
        />
        {isContract ? (
          <article
            aria-label="合同生成说明预览页"
            className="document-editor-v2__contract-instructions"
            data-preview-page="generation-instructions"
          >
            <p className="document-editor-v2__contract-instructions-kicker">合同生成边界</p>
            <h2>生成说明</h2>
            <p>本页是独立的生成说明，不属于合同正文，也不构成合同条款。</p>
            <ul>
              <li>生成内容来自当前本机草稿与所选版式。</li>
              <li>风险提示用于协助复核，不代表法律、税务或合规结论。</li>
              <li>签署或对外使用前，请由相关专业人员完成审核。</li>
            </ul>
          </article>
        ) : null}
      </div>
    </section>
  );
}
