import { calculateQuoteTotals, type StandardGoodsQuoteDraft } from "@opentrad/document-core";
import { Plus, Trash2 } from "lucide-react";
import type { FormLineItem, QuotationFormState } from "./draftConversion";

function formatMoney(minor: string, currency: string) {
  const padded = minor.padStart(3, "0");
  const whole = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${currency} ${whole}.${padded.slice(-2)}`;
}

export function LineItemsStep({
  form,
  errors,
  validDraft,
  createLineId,
  onChange,
}: {
  form: QuotationFormState;
  errors: Record<string, string>;
  validDraft: StandardGoodsQuoteDraft;
  createLineId: () => string;
  onChange: (form: QuotationFormState) => void;
}) {
  const calculation = calculateQuoteTotals(validDraft);
  const amounts = new Map(calculation.lines.map((line) => [line.lineId, line]));
  const updateLine = (index: number, line: FormLineItem) =>
    onChange({
      ...form,
      lineItems: form.lineItems.map((current, currentIndex) =>
        currentIndex === index ? line : current,
      ),
    });
  const addLine = () =>
    onChange({
      ...form,
      lineItems: [
        ...form.lineItems,
        {
          id: createLineId(),
          name: "商品",
          sku: "",
          specification: "",
          description: "",
          unit: "件",
          quantity: "1",
          unitPriceMajor: "0",
          discountPercent: "0",
          taxRatePercent: "0",
        },
      ],
    });
  return (
    <>
      <div className="line-items-list">
        {form.lineItems.map((line, index) => {
          const lineNumber = index + 1;
          const lineAmounts = amounts.get(line.id);
          const field = (key: keyof FormLineItem, label: string, disabled = false) => {
            const path = `lineItems.${index}.${key}`;
            const error = errors[path];
            const errorId = `line-${lineNumber}-${key}-error`;
            return (
              <label className={key === "description" ? "wide-field" : undefined}>
                <span>
                  第 {lineNumber} 行{label}
                </span>
                <input
                  value={line[key]}
                  disabled={disabled}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={error ? errorId : undefined}
                  onChange={(event) => updateLine(index, { ...line, [key]: event.target.value })}
                />
                {error && (
                  <small className="field-error" id={errorId}>
                    {error}
                  </small>
                )}
              </label>
            );
          };
          return (
            <fieldset className="line-item-editor" key={line.id}>
              <legend>商品 {lineNumber}</legend>
              <button
                type="button"
                className="icon-text-button danger-button"
                aria-label={`删除第 ${lineNumber} 行商品`}
                disabled={form.lineItems.length === 1}
                onClick={() =>
                  onChange({
                    ...form,
                    lineItems: form.lineItems.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <Trash2 size={15} /> 删除
              </button>
              <div className="field-grid line-field-grid">
                {field("name", "商品名称")}
                {field("sku", "SKU")}
                {field("specification", "规格")}
                {field("description", "描述")}
                {field("unit", "单位")}
                {field("quantity", "数量")}
                {field("unitPriceMajor", "单价")}
                {field("discountPercent", "折扣百分比")}
                {field("taxRatePercent", "税率百分比", form.meta.taxMode === "tax-exempt")}
              </div>
              {lineAmounts && (
                <div className="line-calculation">
                  <span>未税 {formatMoney(lineAmounts.subtotalMinor, form.meta.currency)}</span>
                  <span>税额 {formatMoney(lineAmounts.taxMinor, form.meta.currency)}</span>
                  <strong>{formatMoney(lineAmounts.totalMinor, form.meta.currency)}</strong>
                </div>
              )}
            </fieldset>
          );
        })}
      </div>
      <button
        type="button"
        className="secondary-button add-line-button"
        onClick={addLine}
        disabled={form.lineItems.length >= 100}
      >
        <Plus size={16} /> 添加商品
      </button>
      <section aria-label="报价金额汇总">
        <dl className="calculation-summary">
          <div>
            <dt>商品金额</dt>
            <dd>{formatMoney(calculation.summary.grossMinor, form.meta.currency)}</dd>
          </div>
          <div>
            <dt>折扣金额</dt>
            <dd>{formatMoney(calculation.summary.discountMinor, form.meta.currency)}</dd>
          </div>
          <div>
            <dt>税额</dt>
            <dd>{formatMoney(calculation.summary.taxMinor, form.meta.currency)}</dd>
          </div>
          <div className="grand-total">
            <dt>价税合计</dt>
            <dd>{formatMoney(calculation.summary.totalMinor, form.meta.currency)}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
