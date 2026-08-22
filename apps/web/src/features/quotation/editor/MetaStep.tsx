import {
  STANDARD_GOODS_QUOTE_BASIS_DATE,
  STANDARD_GOODS_QUOTE_TEMPLATE_VERSION,
} from "@opentrad/document-core";
import { useId } from "react";
import type { QuotationFormState } from "./draftConversion";
import { PartyFields } from "./PartyFields";

export function MetaStep({
  form,
  errors,
  onChange,
}: {
  form: QuotationFormState;
  errors: Record<string, string>;
  onChange: (form: QuotationFormState) => void;
}) {
  const errorIdPrefix = useId();
  const numberErrorId = `${errorIdPrefix}-number-error`;
  const issueDateErrorId = `${errorIdPrefix}-issue-date-error`;
  const validUntilErrorId = `${errorIdPrefix}-valid-until-error`;
  const metaField = <K extends keyof QuotationFormState["meta"]>(
    key: K,
    value: QuotationFormState["meta"][K],
  ) => onChange({ ...form, meta: { ...form.meta, [key]: value } });
  const errorProps = (path: string, id: string) => ({
    "aria-invalid": errors[path] ? ("true" as const) : undefined,
    "aria-describedby": errors[path] ? id : undefined,
  });
  return (
    <>
      <div className="field-grid meta-fields">
        <label>
          <span>报价编号 *</span>
          <input
            aria-label="报价编号"
            value={form.meta.number}
            {...errorProps("meta.number", numberErrorId)}
            onChange={(event) => metaField("number", event.target.value)}
          />
          {errors["meta.number"] && (
            <small className="field-error" id={numberErrorId}>
              {errors["meta.number"]}
            </small>
          )}
        </label>
        <label>
          <span>报价日期 *</span>
          <input
            type="date"
            value={form.meta.issueDate}
            {...errorProps("meta.issueDate", issueDateErrorId)}
            onChange={(event) => metaField("issueDate", event.target.value)}
          />
          {errors["meta.issueDate"] && (
            <small className="field-error" id={issueDateErrorId}>
              {errors["meta.issueDate"]}
            </small>
          )}
        </label>
        <label>
          <span>有效期至 *</span>
          <input
            type="date"
            value={form.meta.validUntil}
            {...errorProps("meta.validUntil", validUntilErrorId)}
            onChange={(event) => metaField("validUntil", event.target.value)}
          />
          {errors["meta.validUntil"] && (
            <small className="field-error" id={validUntilErrorId}>
              {errors["meta.validUntil"]}
            </small>
          )}
        </label>
        <label>
          <span>币种</span>
          <select
            value={form.meta.currency}
            onChange={(event) =>
              metaField("currency", event.target.value as QuotationFormState["meta"]["currency"])
            }
          >
            <option value="CNY">CNY · 人民币</option>
            <option value="USD">USD · 美元</option>
            <option value="EUR">EUR · 欧元</option>
          </select>
        </label>
        <label>
          <span>税制</span>
          <select
            value={form.meta.taxMode}
            onChange={(event) => {
              const taxMode = event.target.value as QuotationFormState["meta"]["taxMode"];
              onChange({
                ...form,
                meta: { ...form.meta, taxMode },
                lineItems:
                  taxMode === "tax-exempt"
                    ? form.lineItems.map((line) => ({ ...line, taxRatePercent: "0" }))
                    : form.lineItems,
              });
            }}
          >
            <option value="tax-excluded">未税报价</option>
            <option value="tax-included">含税报价</option>
            <option value="tax-exempt">免税报价</option>
          </select>
        </label>
        <label>
          <span>报价性质</span>
          <select
            value={form.meta.quoteNature}
            onChange={(event) =>
              metaField(
                "quoteNature",
                event.target.value as QuotationFormState["meta"]["quoteNature"],
              )
            }
          >
            <option value="invitation">要约邀请</option>
            <option value="binding-offer">约束性要约</option>
          </select>
        </label>
      </div>
      <PartyFields
        partyRole="seller"
        party={form.seller}
        errors={errors}
        onChange={(seller) => onChange({ ...form, seller })}
      />
      <p className="template-disclosure">
        模板 v{STANDARD_GOODS_QUOTE_TEMPLATE_VERSION} · 依据日 {STANDARD_GOODS_QUOTE_BASIS_DATE} ·
        中文经典版式 · 仅本机处理
      </p>
    </>
  );
}
