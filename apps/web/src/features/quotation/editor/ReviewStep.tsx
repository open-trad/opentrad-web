import type { QuotationFormState } from "./draftConversion";
import type { QuotationExportFormat } from "./exportQuotation";

export function ReviewStep({
  form,
  busy,
  disabled,
  exportStatus,
  onExport,
}: {
  form: QuotationFormState;
  busy: QuotationExportFormat | null;
  disabled: boolean;
  exportStatus: string;
  onExport: (format: QuotationExportFormat) => void;
}) {
  return (
    <div className="review-step">
      <dl className="review-summary">
        <div>
          <dt>报价编号</dt>
          <dd>{form.meta.number}</dd>
        </div>
        <div>
          <dt>报价方</dt>
          <dd>{form.seller.name}</dd>
        </div>
        <div>
          <dt>采购方</dt>
          <dd>{form.buyer.name}</dd>
        </div>
        <div>
          <dt>商品行数</dt>
          <dd>{form.lineItems.length}</dd>
        </div>
      </dl>
      <div className="local-data-banner">
        <strong>所有数据留在本机</strong>
        <p>草稿、公司档案与导出文件均在浏览器本地处理，不会自动上传。</p>
      </div>
      <div className="legal-notices">
        <p>请在发出前核对价格、税率、付款和交货条件。</p>
        <p>本工具不替代专业法律、税务或会计意见。</p>
        <p>DOCX 与 PDF 版式会因阅读软件和字体环境略有差异。</p>
      </div>
      <fieldset className="export-actions">
        <legend className="sr-only">导出报价单</legend>
        {(["docx", "pdf", "json", "opentrad"] as const).map((format) => (
          <button
            type="button"
            className={
              format === "docx" || format === "pdf" ? "primary-button" : "secondary-button"
            }
            disabled={disabled || busy !== null}
            onClick={() => onExport(format)}
            key={format}
          >
            {busy === format ? "正在生成…" : `导出 ${format.toUpperCase()}`}
          </button>
        ))}
      </fieldset>
      <p className="export-status" aria-live="polite">
        {exportStatus}
      </p>
    </div>
  );
}
